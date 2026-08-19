// The 3D half of the printed map: one frame of the planner's terrain view,
// built off-screen, photographed, and drawn into the sheet's canvas.
//
// The flat map next door (staticMap.ts) stitches tiles by hand, because a
// north-up drawing of a route is a few dozen lines of canvas work. A draped,
// shaded, exaggerated mesh is not — the only thing that renders it is MapLibre,
// with WebGL, on screen. So this builds exactly the map Map3DView builds, waits
// for it to finish arriving, takes its picture, and throws it away. What is
// left is a still image in the same <canvas> the flat map would have used, so
// the sheet, the print CSS and the page's vertical budget do not know or care
// which of the two drew it.
//
// WHY A PHOTOGRAPH AND NOT THE LIVE MAP
//
// A WebGL canvas is not reliably reproduced by a browser's print renderer: the
// drawing buffer belongs to the compositor and is routinely cleared after each
// frame, so what prints is often black or blank. `preserveDrawingBuffer` keeps
// the last frame long enough to read it back, and once it has been read back
// there is no reason to keep a GL context, a tile pipeline and a render loop
// alive underneath a picture that will never move again. Capturing also gives
// us the one guarantee the sheet actually needs: by the time Print is enabled,
// the picture on the page is finished, not merely started.
//
// Note the difference from staticMap.ts, whose canvas is deliberately tainted:
// MapLibre fetches its tiles with CORS (it has to, to upload them as WebGL
// textures), so this canvas is clean and toDataURL is allowed. That is a
// property of MapLibre's loader, not a choice made here — if a tile source ever
// stops sending the header, the tile fails to load rather than quietly poisoning
// the export, and the capture below still produces a page.

import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Route } from '../types';
import {
  TERRAIN_BEARING,
  TERRAIN_ENDPOINT_PAINT,
  TERRAIN_EXAGGERATION,
  TERRAIN_FIT_PADDING,
  TERRAIN_PITCH,
  TERRAIN_ROUTE_PAINT,
  TERRAIN_SKY,
  routeEndpointsGeoJSON,
} from '../terrainView';

/** How long the capture waits for tiles, the DEM and the first paint before
 *  photographing whatever has arrived. Long enough for a cold cache on a slow
 *  connection; short enough that a source which is simply down cannot hold the
 *  Print button hostage. A partly-loaded terrain still prints the route over
 *  the right valley, which is the same bargain the flat renderer strikes when
 *  a tile 404s. */
const CAPTURE_TIMEOUT_MS = 20000;

export interface TerrainMapOptions {
  /** Route geometry to frame, drape and mark. */
  route: Route;
  /** Logical (CSS pixel) size of the drawing — the same frame the flat map
   *  fills, so the two are interchangeable on the page. */
  width: number;
  height: number;
  /** Backing-store multiplier, passed to MapLibre as its device pixel ratio so
   *  the mesh is *rendered* at print resolution rather than rendered small and
   *  enlarged afterwards. */
  scale: number;
  /** Drape NVE's steepness layer over the topo tiles, following the sheet's
   *  steepness switch exactly as the flat map does. */
  steepness?: boolean;
  /** Abort check, polled at each step that follows an await. */
  cancelled?: () => boolean;
}

/** The GeoJSON MapLibre draws the route from. Route points are [lat, lng];
 *  GeoJSON wants [lng, lat]. Segments shorter than two points are dropped —
 *  a LineString of one coordinate is not a line. */
function routeToGeoJSON(route: Route): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: route
      .filter((seg) => seg.length >= 2)
      .map((seg) => ({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: seg.map(([lat, lng]) => [lng, lat]),
        },
      })),
  };
}

/** Resolve when the map says it has nothing left to load or draw — or when the
 *  clock runs out, in which case whatever is on screen is what gets printed. */
function whenSettled(map: MapLibreMap): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, CAPTURE_TIMEOUT_MS);
    map.once('idle', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('captured frame failed to decode'));
    img.src = url;
  });
}

/**
 * Draw one frame of the planner's 3D terrain view of `route` into `canvas`.
 *
 * Rejects if the browser cannot give us a terrain view at all — no WebGL, a
 * lost context, a frame that cannot be read back. The caller is expected to
 * fall back to the flat map rather than print an empty frame: a north-up map of
 * the right tour beats a beautiful one of nothing.
 */
export async function renderTerrainMap(
  canvas: HTMLCanvasElement,
  opts: TerrainMapOptions,
): Promise<void> {
  const {
    route,
    width,
    height,
    scale,
    steepness = true,
    cancelled = () => false,
  } = opts;

  const points: [number, number][] = [];
  for (const seg of route) for (const [lat, lng] of seg) points.push([lng, lat]);
  if (points.length < 2) throw new Error('no route to frame');

  // Both modules are loaded on demand: MapLibre is around a megabyte, and a
  // guide exporting the flat map — which is the default and the common case —
  // should never pay for it. maplibreOffline pulls MapLibre in too, hence the
  // same treatment.
  const [{ default: maplibregl }, offline] = await Promise.all([
    import('maplibre-gl'),
    import('../offline/maplibreOffline'),
  ]);
  if (cancelled()) return;

  // The same protocol the planner's 3D view registers, so a downloaded region
  // exports without a network the way it draws without one. Idempotent.
  offline.registerOfflineMapProtocol();

  // MapLibre needs a laid-out container to size its drawing buffer from, and
  // this one must never be seen: it is parked off-screen rather than hidden,
  // because `display: none` gives it no size and `visibility: hidden` invites
  // a browser to skip painting the very frame we came for.
  const holder = document.createElement('div');
  holder.style.cssText = [
    'position: fixed',
    'left: -20000px',
    'top: 0',
    `width: ${width}px`,
    `height: ${height}px`,
    'pointer-events: none',
  ].join('; ');
  document.body.appendChild(holder);

  let map: MapLibreMap | null = null;
  try {
    const bounds = points.reduce(
      (b, p) => b.extend(p),
      new maplibregl.LngLatBounds(points[0], points[0]),
    );

    map = new maplibregl.Map({
      container: holder,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: [offline.offlineTileTemplate('topo')],
            tileSize: 256,
            maxzoom: 18,
          },
          terrain: {
            type: 'raster-dem',
            tiles: [offline.offlineTileTemplate('terrain')],
            tileSize: 256,
            encoding: 'terrarium',
            maxzoom: 15,
          },
          steepness: {
            type: 'raster',
            tiles: [offline.offlineTileTemplate('steepness')],
            tileSize: 256,
            maxzoom: 16,
          },
          route: { type: 'geojson', data: routeToGeoJSON(route) },
          ends: { type: 'geojson', data: routeEndpointsGeoJSON(route) },
        },
        layers: [
          { id: 'basemap', type: 'raster', source: 'basemap' },
          // Declared either way and switched with `visibility`, exactly as the
          // planner declares it: MapLibre fetches no tiles for a source whose
          // only layer is hidden, so a sheet without slope angles waits for
          // nothing it is not going to print.
          {
            id: 'steepness',
            type: 'raster',
            source: 'steepness',
            layout: { visibility: steepness ? 'visible' : 'none' },
            paint: { 'raster-opacity': 0.6 },
          },
          {
            id: 'route',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: TERRAIN_ROUTE_PAINT,
          },
          {
            id: 'ends',
            type: 'circle',
            source: 'ends',
            paint: TERRAIN_ENDPOINT_PAINT,
          },
        ],
        terrain: { source: 'terrain', exaggeration: TERRAIN_EXAGGERATION },
        sky: TERRAIN_SKY,
      },
      bounds,
      fitBoundsOptions: {
        padding: TERRAIN_FIT_PADDING,
        pitch: TERRAIN_PITCH,
        bearing: TERRAIN_BEARING,
      },
      // Nothing here is ever touched, seen, or credited in place: the sheet
      // prints its own attribution line, and the map is gone a second later.
      interactive: false,
      attributionControl: false,
      // Render at the sheet's oversample rather than the screen's, so the mesh
      // is drawn at print resolution instead of being enlarged into it.
      pixelRatio: scale,
      // Raster layers cross-fade in by default, which on a map captured the
      // instant it settles means photographing a half-faded tile.
      fadeDuration: 0,
      canvasContextAttributes: {
        // The whole reason this is a photograph: without it the frame we want
        // to read back has already been discarded by the time we ask for it.
        preserveDrawingBuffer: true,
        // Off by default, and worth the cost exactly once: this context renders
        // a single frame that then goes on paper, where a stair-stepped ridge
        // line has nowhere to hide.
        antialias: true,
      },
      maxPitch: 85,
    });

    await whenSettled(map);
    if (cancelled()) return;

    const frame = map.getCanvas().toDataURL('image/png');
    const image = await decode(frame);
    if (cancelled()) return;

    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context to draw the captured frame into');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    // Even on the failure path: a GL context left behind by an export nobody
    // completed is a context the browser will eventually take from a map the
    // user is still using.
    map?.remove();
    holder.remove();
  }
}
