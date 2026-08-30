// North-up static map renderer: stitches the planner's own tile layers onto a
// canvas and traces the route over them.
//
// This is the shared engine behind two very different pictures:
//   - the tiny route thumbnails in the library lists (RouteThumbnail), and
//   - the large map on the printable tour briefing (BriefingSheet).
// Both want "the planner map, fitted to this route, north up", just at wildly
// different sizes, so the only differences are parameters.
//
// The briefing additionally lets its reader move and close in on that framing,
// which is the `framing` option: an offset from the fit rather than a zoom and
// a centre of its own, so that leaving it out — as the thumbnails do — gives
// back exactly the fitted map this file has always drawn. What that offset
// means, and what bounds it, is in mapFraming.ts.
//
// Tiles come from the same sources as Map.tsx via OFFLINE_LAYERS, which keeps
// the URL scheme (and its licensing notes) in exactly one place. Web-Mercator
// tiles are north-up by construction, so the result is always oriented north.
//
// IMPORTANT — why we never read pixels back: tiles are drawn with a plain
// <img> and no crossOrigin attribute, which taints the canvas. That is
// deliberate. Tainting costs us nothing here because the canvas is only ever
// *displayed* (on screen, and by the browser's print renderer) — never
// exported via toDataURL/getImageData. Requiring CORS instead would make the
// map fail outright on strict tile-server setups. Anyone adding an "export as
// PNG" button must revisit this decision, not just call toDataURL.

import type { LatLng, Overlay, Route } from '@fjellrute/core/types';
import { OFFLINE_LAYERS } from '@fjellrute/core/offline/layers';
import { routeConnectors, routeEnds } from '@fjellrute/core/geometry';
import { clampZoom, FIT, type Framing } from './mapFraming';
import { drawParkingSign } from '../parking/sign';
import { plainParkingSigns } from '../parking/signs';
import {
  ROUTE_COLOR,
  ROUTE_WEIGHT,
  HALO_WEIGHT,
  START_COLOR,
  FINISH_COLOR,
  CONNECTOR_COLOR,
  connectorWeight,
  connectorDash,
} from '@fjellrute/core/routes/style';

const TILE_SIZE = 256;
const MIN_ZOOM = 3;

// The overlays are drawn at the planner's own opacities so a rendered map
// reads like a miniature of the map the user was just looking at. Snow sits
// heavier than steepness for the same reason it does on screen: a 1 km grid of
// flat colour has no detail of its own to show through, and at 0.6 it reads as
// a wash over the contours rather than as a depth.
const STEEPNESS_OPACITY = 0.6;
const SNOW_OPACITY = 0.75;

// ...and under snow the base map is drained of colour, exactly as Map.tsx's
// `.grayscaleBase` does it. Snow depth is a colour ramp, and a full-colour topo
// sheet underneath competes with it — greens and blues of their own arguing
// with the ramp's. The planner greys the map so the only colour on it is the
// one carrying the number; the printed sheet had better do the same, or the two
// pictures of the same tour will not look like each other.
const SNOW_BASE_FILTER = 'grayscale(100%) contrast(0.9) brightness(1.05)';

// Route styling — colour, widths and endpoint dots — comes from routeStyle.ts,
// the same module the planner's Leaflet layer reads. Re-exported here because
// this file is the map's public face for its two callers.
export { ROUTE_COLOR };

// Neutral fill behind the tiles, so gaps (no coverage, failed fetch) read as
// "blank map" rather than transparent black.
const BACKDROP = '#e8edf2';

/** Web Mercator projection to global pixel coordinates at zoom `z`. */
function project(lat: number, lng: number, z: number): [number, number] {
  const scale = TILE_SIZE * 2 ** z;
  const x = ((lng + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return [x, y];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // No crossOrigin — see the tainting note at the top of this file.
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Tile failed: ${url}`));
    img.src = url;
  });
}

export interface StaticMapOptions {
  /** Route geometry to frame and trace. */
  route: Route;
  /** Logical (CSS pixel) width of the drawing. */
  width: number;
  /** Logical (CSS pixel) height of the drawing. */
  height: number;
  /**
   * Backing-store multiplier. Screen use passes the device pixel ratio; print
   * use passes a fixed oversample (print renders at far more than 96 dpi, and
   * an under-sampled canvas prints visibly soft).
   */
  scale: number;
  /** Fraction of each side kept clear around the route. */
  padding?: number;
  /**
   * How close to draw, and where to point — as an offset from the fit-to-route
   * framing this renderer works out for itself. Omitting it, which is what the
   * thumbnails do and what a briefing nobody has touched does, gives exactly
   * the fit: the whole route, centred.
   *
   * See mapFraming.ts for what the two numbers mean and what bounds them.
   */
  framing?: Framing;
  /**
   * What to drape over the topo base: NVE's steepness shading, seNorge's snow
   * depth, or nothing. The planner's three states, drawn the planner's way.
   * Defaults to steepness, which is the map the route thumbnails have always
   * been pictures of.
   */
  overlay?: Overlay;
  /**
   * Which day's snow to draw, as YYYY-MM-DD. Only read when `overlay` is
   * 'snowdepth'; without it seNorge serves its latest grid, which is the right
   * fallback for a caller that has no particular day in mind.
   */
  snowDate?: string;
  /** Route line width, in logical pixels. Defaults to the planner's own, which
   *  is what makes a full-size render read as the map on screen; the tiny
   *  thumbnails override it, because proportion is what carries across sizes,
   *  not the number. */
  routeWeight?: number;
  /** Halo width under the route line, in logical pixels. */
  haloWeight?: number;
  /**
   * Width of the dotted legs bridging gaps between segments, in logical pixels.
   * Defaults to a fixed fraction of `routeWeight`, so the thumbnails get a
   * connector in proportion to their own thinner line without having to know
   * this feature exists — the same reasoning as routeWeight's own default.
   */
  connectorWeight?: number;
  /** Mark the first and last point of the route (start green, finish red). */
  endpoints?: boolean;
  /**
   * Parking lots to plant numbered signs on, in the order the caller lists
   * them — which for the briefing is the order of the numbered rows in its
   * Parking section, so sign 3 on the map and row 3 in the list are the same
   * lot. The numbering is not this file's to invent; see parking/signs.ts.
   *
   * Empty by default, which is what the thumbnails want: a 160 px tile has no
   * room for a 22 px sign, and the lots are not part of what a thumbnail is a
   * picture of.
   */
  parking?: readonly LatLng[];
  /** Draw a metric scale bar in the bottom-left corner. */
  scaleBar?: boolean;
  /** Abort check, polled after the (async) tile fetches settle. */
  cancelled?: () => boolean;
}

/** Route bounds as [minLat, maxLat, minLng, maxLng]; null when empty. */
function bounds(
  route: Route,
): [number, number, number, number] | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let seen = 0;
  for (const seg of route) {
    for (const [lat, lng] of seg) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      seen++;
    }
  }
  return seen > 0 ? [minLat, maxLat, minLng, maxLng] : null;
}

/**
 * Render `route` on the planner's map layers into `canvas`, fitted to the
 * route's bounds and oriented north-up. Resolves once everything is painted;
 * tiles that fail (no coverage, offline, server hiccup) are simply skipped, so
 * a partial map still renders rather than nothing at all.
 */
export async function renderStaticMap(
  canvas: HTMLCanvasElement,
  opts: StaticMapOptions,
): Promise<void> {
  const {
    route,
    width,
    height,
    scale,
    padding = 0.12,
    framing = FIT,
    overlay = 'steepness',
    snowDate,
    routeWeight = ROUTE_WEIGHT,
    haloWeight = HALO_WEIGHT,
    connectorWeight: gapWeight = connectorWeight(routeWeight),
    endpoints = false,
    parking = [],
    scaleBar = false,
    cancelled = () => false,
  } = opts;

  const box = bounds(route);
  if (!box) return;
  const [minLat, maxLat, minLng, maxLng] = box;

  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Work in logical pixels; the backing store absorbs the oversampling.
  ctx.scale(scale, scale);

  // Pick the highest zoom at which the route (plus padding) still fits. The
  // ceiling is the deepest zoom BOTH layers actually publish when the
  // steepness overlay is on, so the overlay never runs out from under the
  // base map (NVE's cache stops at z16, Kartverket's at z18).
  //
  // Snow is not treated that way, and must not be: seNorge stops at z9, and
  // holding a whole map to that ceiling to keep the overlay native would print
  // a country where a valley was asked for. It is a 1 km grid — there is no
  // detail past z9 to lose — so it is fetched on its own grid and stretched,
  // which is exactly what the planner's Leaflet layer does with the same
  // maxNativeZoom. Steepness has real detail at 16 and is worth a ceiling;
  // snow has none at 9 and is worth a stretch.
  const maxZoom =
    overlay === 'steepness'
      ? Math.min(
          OFFLINE_LAYERS.topo.maxNativeZoom,
          OFFLINE_LAYERS.steepness.maxNativeZoom,
        )
      : OFFLINE_LAYERS.topo.maxNativeZoom;
  const availW = width * (1 - 2 * padding);
  const availH = height * (1 - 2 * padding);
  let fitZoom = maxZoom;
  for (; fitZoom > MIN_ZOOM; fitZoom--) {
    const [x0, y0] = project(maxLat, minLng, fitZoom);
    const [x1, y1] = project(minLat, maxLng, fitZoom);
    if (x1 - x0 <= availW && y1 - y0 <= availH) break;
  }

  // What was asked for on top of that fit. Fractional, because the wheel that
  // asks for it is.
  const wanted = fitZoom + clampZoom(framing.zoom);
  // Tiles exist only at whole zooms, so one is picked and the drawing scaled to
  // meet the fraction. The *nearest* whole zoom rather than the one below it:
  // half a step of shrinking a tile is sharper on paper than a full step of
  // enlarging one. Clamping at maxZoom is what lets a guide keep going past
  // the deepest zoom the servers publish — the planner's own map overzooms the
  // same way, off the same maxNativeZoom, so the two stay recognisable.
  const zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, Math.round(wanted)));
  const magnify = 2 ** (wanted - zoom);

  // Global-pixel frame of the drawing: centred on the route, then moved by the
  // pan. `magnify` is applied when drawing rather than baked in here, so the
  // frame covers fewer global pixels the further in the guide has gone while
  // the route line, the dots and the scale bar keep their printed widths.
  const spanX = width / magnify;
  const spanY = height / magnify;
  const [x0, y0] = project(maxLat, minLng, zoom);
  const [x1, y1] = project(minLat, maxLng, zoom);
  const left = (x0 + x1) / 2 + framing.pan.x * spanX - spanX / 2;
  const top = (y0 + y1) / 2 + framing.pan.y * spanY - spanY / 2;
  /** Global pixel to logical pixel in the drawing. */
  const px = (gx: number) => (gx - left) * magnify;
  const py = (gy: number) => (gy - top) * magnify;

  // Fetch every tile intersecting the frame, for each active layer.
  const maxTile = 2 ** zoom - 1;
  const txMin = Math.floor(left / TILE_SIZE);
  const txMax = Math.floor((left + spanX) / TILE_SIZE);
  const tyMin = Math.max(0, Math.floor(top / TILE_SIZE));
  const tyMax = Math.min(maxTile, Math.floor((top + spanY) / TILE_SIZE));

  interface Tile {
    img: HTMLImageElement;
    /** Where this tile goes, in logical pixels: left, top, width, height. */
    at: [number, number, number, number];
  }
  const base: Promise<Tile>[] = [];
  const overlayTiles: Promise<Tile>[] = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      // Both edges are rounded and the width taken as the difference, so a
      // tile ends exactly where its neighbour begins. Placing each tile at a
      // fractional offset with an exact width instead leaves hairline seams
      // once `magnify` is not 1 — white threads across the base map, and
      // double-darkened ones through the half-transparent steepness layer.
      const l = Math.round(px(tx * TILE_SIZE));
      const t = Math.round(py(ty * TILE_SIZE));
      const at: [number, number, number, number] = [
        l,
        t,
        Math.round(px((tx + 1) * TILE_SIZE)) - l,
        Math.round(py((ty + 1) * TILE_SIZE)) - t,
      ];
      // Wrap x so a frame straddling the antimeridian still addresses tiles.
      const wx = ((tx % (maxTile + 1)) + maxTile + 1) % (maxTile + 1);
      base.push(
        loadImage(OFFLINE_LAYERS.topo.tileUrl(zoom, wx, ty)).then((img) => ({
          img,
          at,
        })),
      );
      if (overlay === 'steepness') {
        overlayTiles.push(
          loadImage(OFFLINE_LAYERS.steepness.tileUrl(zoom, wx, ty)).then(
            (img) => ({ img, at }),
          ),
        );
      }
    }
  }

  // Snow rides its own grid, so it gets its own loop rather than a branch
  // inside the one above: at z14 a single seNorge tile covers 32 topo tiles,
  // and asking for it 32 times — even to the same URL — is 32 requests to an
  // un-cached WMS server for one picture.
  if (overlay === 'snowdepth') {
    const snowZoom = Math.min(zoom, OFFLINE_LAYERS.snowdepth.maxNativeZoom);
    // How many drawing-grid tiles one snow tile spans. 1 when the frame is
    // shallower than seNorge's ceiling, which is the ordinary case for a whole
    // country and never for a tour.
    const span = TILE_SIZE * 2 ** (zoom - snowZoom);
    const maxSnowTile = 2 ** snowZoom - 1;
    const sxMin = Math.floor(left / span);
    const sxMax = Math.floor((left + spanX) / span);
    const syMin = Math.max(0, Math.floor(top / span));
    const syMax = Math.min(maxSnowTile, Math.floor((top + spanY) / span));
    for (let sx = sxMin; sx <= sxMax; sx++) {
      for (let sy = syMin; sy <= syMax; sy++) {
        // Same shared-edge rounding as the base tiles, on the wider grid.
        const l = Math.round(px(sx * span));
        const t = Math.round(py(sy * span));
        const at: [number, number, number, number] = [
          l,
          t,
          Math.round(px((sx + 1) * span)) - l,
          Math.round(py((sy + 1) * span)) - t,
        ];
        const wx = ((sx % (maxSnowTile + 1)) + maxSnowTile + 1) % (maxSnowTile + 1);
        overlayTiles.push(
          loadImage(
            OFFLINE_LAYERS.snowdepth.tileUrl(snowZoom, wx, sy, { snowDate }),
          ).then((img) => ({ img, at })),
        );
      }
    }
  }

  // Missing tiles (e.g. steepness has no coverage outside Norway) just stay
  // blank; everything else still renders.
  const [baseTiles, drapedTiles] = await Promise.all([
    Promise.allSettled(base),
    Promise.allSettled(overlayTiles),
  ]);
  if (cancelled()) return;

  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  // Only the base is greyed, and only under snow — the filter is set and
  // cleared around this loop so nothing drawn afterwards (the overlay, the
  // route, the dots, the scale bar) is caught by it.
  if (overlay === 'snowdepth') ctx.filter = SNOW_BASE_FILTER;
  for (const tile of baseTiles) {
    if (tile.status === 'fulfilled') {
      ctx.drawImage(tile.value.img, ...tile.value.at);
    }
  }
  ctx.filter = 'none';
  if (overlay !== 'none') {
    ctx.globalAlpha =
      overlay === 'snowdepth' ? SNOW_OPACITY : STEEPNESS_OPACITY;
    for (const tile of drapedTiles) {
      if (tile.status === 'fulfilled') {
        ctx.drawImage(tile.value.img, ...tile.value.at);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Route on top: white halo, then the planner's accent teal.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Gap connectors first, so the route and its halo cover them where the two
  // meet. Dashes are set and cleared around this block: leaving a dash pattern
  // on the context would dot the route line, the endpoint rings and the scale
  // bar as well.
  const gaps = routeConnectors(route);
  if (gaps.length > 0) {
    ctx.save();
    ctx.strokeStyle = CONNECTOR_COLOR;
    ctx.lineWidth = gapWeight;
    ctx.setLineDash(connectorDash(gapWeight));
    ctx.beginPath();
    for (const [from, to] of gaps) {
      const [ax, ay] = project(from[0], from[1], zoom);
      const [bx, by] = project(to[0], to[1], zoom);
      ctx.moveTo(px(ax), py(ay));
      ctx.lineTo(px(bx), py(by));
    }
    ctx.stroke();
    ctx.restore();
  }

  const trace = () => {
    ctx.beginPath();
    for (const seg of route) {
      seg.forEach(([lat, lng], i) => {
        const [gx, gy] = project(lat, lng, zoom);
        if (i === 0) ctx.moveTo(px(gx), py(gy));
        else ctx.lineTo(px(gx), py(gy));
      });
    }
    ctx.stroke();
  };
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = haloWeight;
  trace();
  ctx.strokeStyle = ROUTE_COLOR;
  ctx.lineWidth = routeWeight;
  trace();

  if (endpoints) {
    // Same rule as the planner's dots and the 3D view's, from geometry/
    // routeEnds: first point of the first drawn segment, last of the last, and
    // no finish at all until there is a second point to finish at.
    const ends = routeEnds(route);
    if (ends) {
      const dot = (p: LatLng, fill: string) => {
        const [gx, gy] = project(p[0], p[1], zoom);
        const r = Math.max(4, routeWeight * 1.6);
        ctx.beginPath();
        ctx.arc(px(gx), py(gy), r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, r * 0.4);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      };
      dot(ends.start, START_COLOR);
      if (ends.end) dot(ends.end, FINISH_COLOR);
    }
  }

  // Parking signs above the route and its endpoints. A sign covering a few
  // metres of line is the right trade: the line is continuous and reads through
  // a 22 px interruption, whereas a sign with a route drawn across its badge
  // has lost the number that ties it to the list. The same order the planner's
  // Leaflet layer keeps with its zIndexOffset.
  //
  // Drawn at their own logical size, not multiplied by `magnify` — the signs are
  // furniture, like the endpoint dots and the scale bar, so closing in on the
  // map brings the lots closer together without swelling their plates.
  for (const sign of plainParkingSigns(parking)) {
    const [gx, gy] = project(sign.point[0], sign.point[1], zoom);
    drawParkingSign(ctx, px(gx), py(gy), sign.n, sign.state);
  }

  if (scaleBar) {
    // Metres per *drawn* pixel, at the latitude in the middle of the frame.
    // Both corrections matter once the frame can be moved and closed in: the
    // drawing is magnified relative to its tiles, and a panned frame need not
    // be centred on the route it was fitted to — and Mercator's scale is a
    // function of where you are looking, not of what you were framing.
    const centreLat = unprojectLat(top + spanY / 2, zoom);
    drawScaleBar(ctx, width, height, metresPerPixel(centreLat, zoom) / magnify);
  }
}

// Ground resolution (metres per pixel) at a given latitude and zoom.
function metresPerPixel(lat: number, zoom: number): number {
  return (
    (156543.03392804097 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
  );
}

/** The inverse of `project`'s y: global pixel back to latitude. */
function unprojectLat(y: number, z: number): number {
  const scale = TILE_SIZE * 2 ** z;
  const n = Math.PI * (1 - (2 * y) / scale);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

// A "nice" round distance at or below `max` metres: 1/2/5 x 10^n.
function niceDistance(max: number): number {
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const mult of [5, 2, 1]) {
    if (pow * mult <= max) return pow * mult;
  }
  return pow;
}

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  /** Ground resolution of the drawing, in metres per logical pixel. */
  mpp: number,
): void {
  // Aim for a bar about a fifth of the map width, rounded to a nice number.
  const metres = niceDistance(width * 0.2 * mpp);
  const barPx = metres / mpp;
  const label = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;

  const pad = 10;
  const y = height - pad;
  const x = pad;
  const tick = 5;

  ctx.save();
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  const textW = ctx.measureText(label).width;

  // Legibility plate — the bar sits over arbitrary map colours.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.fillRect(x - 5, y - 22, Math.max(barPx, textW) + 10, 27);

  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x, y - tick);
  ctx.lineTo(x, y);
  ctx.lineTo(x + barPx, y);
  ctx.lineTo(x + barPx, y - tick);
  ctx.stroke();

  ctx.fillStyle = '#1f2937';
  ctx.fillText(label, x, y - tick - 3);
  ctx.restore();
}
