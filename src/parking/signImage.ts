// The parking sign as a MapLibre icon, and the symbol layer that plants it on
// the terrain.
//
// Both 3D views — the planner's and the one the briefing prints — are MapLibre,
// and MapLibre draws a point marker from a bitmap in its sprite atlas. So the
// sign is baked: drawParkingSign over an offscreen canvas, once per list number,
// handed to the map as an image. The geometry is the same module the flat maps
// draw from, so a lot that is marked 40 m up the road in 3D is a bug in one
// file rather than a discrepancy between two.
//
// WHY THE SIGNS DRAPE. A symbol layer's anchor is elevated onto the terrain
// mesh by MapLibre itself, the same way the route line and the endpoint dots
// are, so a sign planted at a trailhead 900 m up stands on the hillside rather
// than at sea level under it. That is the whole reason this is a symbol layer
// and not an HTML marker overlaid on the canvas: a marker would float, and on a
// tilted view a floating sign points at the wrong valley. It is also the reason
// it works in the export at all — the printed 3D map is a copy of MapLibre's own
// WebGL frame, so anything not drawn by MapLibre is not on the paper.
//
// WHY THE ICONS ARE BAKED ON DEMAND. MapLibre asks for an image the first time
// it needs one and cannot find it ('styleimagemissing'), which is the one moment
// that is guaranteed to be after the style exists and before the layer draws.
// Adding them up-front instead means either declaring the layer late or logging
// a missing-image warning on every map that opens without any parking — and the
// planner opens that way every time, since the lots arrive from the network
// several seconds later.

import type maplibregl from 'maplibre-gl';
import type {
  SymbolLayerSpecification,
  ExpressionSpecification,
} from 'maplibre-gl';
import {
  DIM,
  drawParkingSign,
  GROW,
  IMAGE_H,
  IMAGE_W,
  POST_OUTLINE_W,
} from './sign';
import type { ParkingSign, ParkingSignFor } from './signs';

/** How many device pixels of bitmap are baked per logical pixel of sign.
 *
 *  Higher than any screen because one of the two maps drawing these is a print
 *  export: it renders at twice the logical size and is then shrunk onto 96 mm of
 *  paper, so an icon baked at the screen's ratio prints as a soft blue smudge
 *  where a route line stays a crisp hairline. Four is chosen for the same reason
 *  the sheet oversamples its canvas — see MAP_SCALE in BriefingSheet — with a
 *  step of headroom on top, and it costs a 144 × 168 bitmap per list number. */
const BAKE_RATIO = 4;

/** The sprite id for the sign carrying list number `n`. */
export function parkingSignIcon(n: number): string {
  return `parking-sign-${n}`;
}

/** The ids this module knows how to bake, as a pattern. Exported for the layer
 *  spec's sake and to keep the parsing in one place. */
const ICON_ID = /^parking-sign-(\d+)$/;

/**
 * Paint the sign for list number `n` into an ImageData, at BAKE_RATIO.
 *
 * Anchored so that the foot of the post lands on the middle of the bitmap's
 * bottom edge, less the pixel of post outline that hangs below it — which is
 * what makes 'bottom' plus the layer's one-pixel offset put the sign on its lot.
 * See IMAGE_W / IMAGE_H in sign.ts.
 */
function bakeParkingSign(n: number): ImageData | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(IMAGE_W * BAKE_RATIO);
  canvas.height = Math.round(IMAGE_H * BAKE_RATIO);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Work in the sign's own logical pixels; the backing store absorbs the ratio,
  // exactly as the flat renderers do it.
  ctx.scale(BAKE_RATIO, BAKE_RATIO);
  drawParkingSign(ctx, IMAGE_W / 2, IMAGE_H - POST_OUTLINE_W, n);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Bake parking sign icons for `map` on demand, for as long as the returned
 * function is not called.
 *
 * Idempotent per id: MapLibre only asks for an image it does not have, and an
 * image added here stays in the style until the map is torn down.
 */
export function serveParkingSignIcons(map: maplibregl.Map): () => void {
  const serve = (e: { id: string }) => {
    const match = ICON_ID.exec(e.id);
    if (!match || map.hasImage(e.id)) return;
    const image = bakeParkingSign(Number(match[1]));
    // No canvas context means no icon, and MapLibre draws nothing rather than
    // throwing. A 3D view missing its parking signs still shows the route,
    // which is the same bargain the flat renderer strikes with a failed tile.
    if (image) map.addImage(e.id, image, { pixelRatio: BAKE_RATIO });
  };
  map.on('styleimagemissing', serve);
  return () => map.off('styleimagemissing', serve);
}

/**
 * The signs as GeoJSON point features, ready for the symbol layer below.
 *
 * Empty is a valid FeatureCollection and the ordinary case — no route, or no
 * lot mapped within the radius — which saves every caller a null check on a
 * source it has already declared.
 */
export function parkingSignsGeoJSON(
  signs: readonly (ParkingSign | ParkingSignFor)[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: signs.map((s) => ({
      type: 'Feature',
      properties: {
        // The icon is chosen per feature rather than by an expression building
        // the id, so the id in the style and the id this module bakes are the
        // same string from the same function.
        icon: parkingSignIcon(s.n),
        state: s.state,
        n: s.n,
        // The lot this sign stands for, when the caller has one — the planner's
        // 3D view does, the printed maps were handed bare coordinates. Null
        // rather than absent so the property exists on every feature and a
        // reader can tell "no lot id" from "no such property". Reading it back
        // out is how a pointer over the MapLibre canvas becomes a lot; see the
        // planner's Map3DParkingSigns.
        id: 'id' in s ? s.id : null,
      },
      geometry: {
        type: 'Point',
        // Route and parking coordinates are [lat, lng]; GeoJSON wants [lng, lat].
        coordinates: [s.point[1], s.point[0]],
      },
    })),
  };
}

/** Layer id, so the two maps declaring this layer agree on what to call it. */
export const PARKING_SIGN_LAYER = 'parking-signs';

export const PARKING_SIGN_LAYOUT: SymbolLayerSpecification['layout'] = {
  'icon-image': ['get', 'icon'],
  // The foot of the post on the lot. 'bottom' is the middle of the bitmap's
  // bottom edge, and the bitmap carries a pixel of post outline below the foot,
  // so the icon is nudged down by that pixel — see IMAGE_H in sign.ts. The
  // offset is in the icon's own pixels and scales with icon-size, so it stays
  // right on a grown sign.
  'icon-anchor': 'bottom',
  'icon-offset': [0, POST_OUTLINE_W],
  // The lit sign grows, about that same anchor, which is what icon-anchor
  // buys: a highlight that moved the thing it highlights would read as the map
  // having jumped. There is no halo, unlike the flat maps' hover — MapLibre has
  // no box-shadow, and a second baked bitmap per state to get one is a lot of
  // sprite for an effect the growing and the fading already carry.
  'icon-size': [
    'case',
    ['==', ['get', 'state'], 'hovered'],
    GROW,
    1,
  ] as ExpressionSpecification,
  // Five lots at a trailhead are routinely within 50 m of each other, and
  // MapLibre's default is to drop a symbol that collides with one already
  // placed. Dropped signs would mean the map showing four of the five numbered
  // rows, with no hint which one is missing.
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
};

export const PARKING_SIGN_PAINT: SymbolLayerSpecification['paint'] = {
  'icon-opacity': [
    'case',
    ['==', ['get', 'state'], 'dimmed'],
    DIM,
    1,
  ] as ExpressionSpecification,
};
