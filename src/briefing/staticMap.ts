// North-up static map renderer: stitches the planner's own tile layers onto a
// canvas and traces the route over them.
//
// This is the shared engine behind two very different pictures:
//   - the tiny route thumbnails in the library lists (RouteThumbnail), and
//   - the large map on the printable tour briefing (BriefingSheet).
// Both want "the planner map, fitted to this route, north up", just at wildly
// different sizes, so the only differences are parameters.
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

import type { LatLng, Route } from '../types';
import { OFFLINE_LAYERS } from '../offline/layers';
import {
  ROUTE_COLOR,
  ROUTE_WEIGHT,
  HALO_WEIGHT,
  START_COLOR,
  FINISH_COLOR,
} from '../routeStyle';

const TILE_SIZE = 256;
const MIN_ZOOM = 3;

// The steepness overlay is drawn at the planner's own 0.6 opacity so a
// rendered map reads like a miniature of the map the user was just looking at.
const STEEPNESS_OPACITY = 0.6;

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
  /** Draw the NVE steepness overlay over the topo base. */
  steepness?: boolean;
  /** Route line width, in logical pixels. Defaults to the planner's own, which
   *  is what makes a full-size render read as the map on screen; the tiny
   *  thumbnails override it, because proportion is what carries across sizes,
   *  not the number. */
  routeWeight?: number;
  /** Halo width under the route line, in logical pixels. */
  haloWeight?: number;
  /** Mark the first and last point of the route (start green, finish red). */
  endpoints?: boolean;
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

/** First and last point of the route, following segment order. */
function endpointsOf(route: Route): { start: LatLng; end: LatLng } | null {
  const drawn = route.filter((seg) => seg.length > 0);
  if (drawn.length === 0) return null;
  const first = drawn[0];
  const last = drawn[drawn.length - 1];
  return { start: first[0], end: last[last.length - 1] };
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
    steepness = true,
    routeWeight = ROUTE_WEIGHT,
    haloWeight = HALO_WEIGHT,
    endpoints = false,
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
  const maxZoom = steepness
    ? Math.min(
        OFFLINE_LAYERS.topo.maxNativeZoom,
        OFFLINE_LAYERS.steepness.maxNativeZoom,
      )
    : OFFLINE_LAYERS.topo.maxNativeZoom;
  const availW = width * (1 - 2 * padding);
  const availH = height * (1 - 2 * padding);
  let zoom = maxZoom;
  for (; zoom > MIN_ZOOM; zoom--) {
    const [x0, y0] = project(maxLat, minLng, zoom);
    const [x1, y1] = project(minLat, maxLng, zoom);
    if (x1 - x0 <= availW && y1 - y0 <= availH) break;
  }

  // Global-pixel frame of the drawing, centred on the route.
  const [x0, y0] = project(maxLat, minLng, zoom);
  const [x1, y1] = project(minLat, maxLng, zoom);
  const left = (x0 + x1) / 2 - width / 2;
  const top = (y0 + y1) / 2 - height / 2;

  // Fetch every tile intersecting the frame, for each active layer.
  const maxTile = 2 ** zoom - 1;
  const txMin = Math.floor(left / TILE_SIZE);
  const txMax = Math.floor((left + width) / TILE_SIZE);
  const tyMin = Math.max(0, Math.floor(top / TILE_SIZE));
  const tyMax = Math.min(maxTile, Math.floor((top + height) / TILE_SIZE));

  interface Tile {
    img: HTMLImageElement;
    dx: number;
    dy: number;
  }
  const base: Promise<Tile>[] = [];
  const steep: Promise<Tile>[] = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      const dx = tx * TILE_SIZE - left;
      const dy = ty * TILE_SIZE - top;
      // Wrap x so a frame straddling the antimeridian still addresses tiles.
      const wx = ((tx % (maxTile + 1)) + maxTile + 1) % (maxTile + 1);
      base.push(
        loadImage(OFFLINE_LAYERS.topo.tileUrl(zoom, wx, ty)).then((img) => ({
          img,
          dx,
          dy,
        })),
      );
      if (steepness) {
        steep.push(
          loadImage(OFFLINE_LAYERS.steepness.tileUrl(zoom, wx, ty)).then(
            (img) => ({ img, dx, dy }),
          ),
        );
      }
    }
  }

  // Missing tiles (e.g. steepness has no coverage outside Norway) just stay
  // blank; everything else still renders.
  const [baseTiles, steepTiles] = await Promise.all([
    Promise.allSettled(base),
    Promise.allSettled(steep),
  ]);
  if (cancelled()) return;

  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  for (const tile of baseTiles) {
    if (tile.status === 'fulfilled') {
      ctx.drawImage(
        tile.value.img,
        tile.value.dx,
        tile.value.dy,
        TILE_SIZE,
        TILE_SIZE,
      );
    }
  }
  if (steepness) {
    ctx.globalAlpha = STEEPNESS_OPACITY;
    for (const tile of steepTiles) {
      if (tile.status === 'fulfilled') {
        ctx.drawImage(
          tile.value.img,
          tile.value.dx,
          tile.value.dy,
          TILE_SIZE,
          TILE_SIZE,
        );
      }
    }
    ctx.globalAlpha = 1;
  }

  // Route on top: white halo, then the planner's accent teal.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const trace = () => {
    ctx.beginPath();
    for (const seg of route) {
      seg.forEach(([lat, lng], i) => {
        const [gx, gy] = project(lat, lng, zoom);
        if (i === 0) ctx.moveTo(gx - left, gy - top);
        else ctx.lineTo(gx - left, gy - top);
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
    const ends = endpointsOf(route);
    if (ends) {
      const dot = (p: LatLng, fill: string) => {
        const [gx, gy] = project(p[0], p[1], zoom);
        const r = Math.max(4, routeWeight * 1.6);
        ctx.beginPath();
        ctx.arc(gx - left, gy - top, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, r * 0.4);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      };
      dot(ends.start, START_COLOR);
      dot(ends.end, FINISH_COLOR);
    }
  }

  if (scaleBar) drawScaleBar(ctx, width, height, zoom, (minLat + maxLat) / 2);
}

// Ground resolution (metres per pixel) at a given latitude and zoom.
function metresPerPixel(lat: number, zoom: number): number {
  return (
    (156543.03392804097 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
  );
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
  zoom: number,
  lat: number,
): void {
  const mpp = metresPerPixel(lat, zoom);
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
