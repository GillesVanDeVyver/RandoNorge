import { useEffect, useRef } from 'react';
import type { Route } from '../types';
import { RouteIcon } from './icons';
import styles from './RouteThumbnail.module.css';

// Same tile sources as the planner map (Map.tsx). The steepness overlay is
// drawn at the same 0.6 opacity so the thumbnail reads like a miniature of
// the planner with the "Bratthet" layer on.
const BASE_URL = (z: number, x: number, y: number) =>
  `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/${z}/${y}/${x}.png`;
const STEEPNESS_URL = (z: number, x: number, y: number) =>
  `https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/tile/${z}/${y}/${x}`;
const STEEPNESS_OPACITY = 0.6;
const STEEPNESS_MAX_ZOOM = 16; // maxNativeZoom of the NVE WMTS cache
const MIN_ZOOM = 3;

// Route styling: the app's accent teal (DrawingHandler's ROUTE_COLOR) over
// a white halo so the line stays readable on the red/orange steepness ramps.
const ROUTE_COLOR = '#2dd4bf';
const ROUTE_WEIGHT = 2.5;
const HALO_WEIGHT = 5;

// Fraction of the thumbnail kept clear around the route on each side.
const PADDING = 0.12;

const TILE_SIZE = 256;

/** Web Mercator projection to global pixel coordinates at zoom `z`. */
function project(lat: number, lng: number, z: number): [number, number] {
  const scale = TILE_SIZE * 2 ** z;
  const x = ((lng + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y =
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return [x, y];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // No crossOrigin: we only draw the tiles (never read pixels back), so a
    // tainted canvas is fine and we avoid failing on strict CORS setups.
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Tile failed: ${url}`));
    img.src = url;
  });
}

/**
 * Renders the route onto the 2D steepness map (Kartverket topo base + NVE
 * "bratthet med utløp" overlay), fitted to the route's bounds. Web Mercator
 * tiles are north-up by construction, so the preview is always oriented to
 * the north — a compact overview of the tour's shape and the steep terrain
 * it crosses.
 */
async function draw(
  canvas: HTMLCanvasElement,
  route: Route,
  cancelled: () => boolean,
) {
  const cssW = canvas.clientWidth || 64;
  const cssH = canvas.clientHeight || 64;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  // Route bounds in lat/lng.
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const seg of route) {
    for (const [lat, lng] of seg) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }

  // Pick the highest zoom at which the route (plus padding) fits.
  const availW = cssW * (1 - 2 * PADDING);
  const availH = cssH * (1 - 2 * PADDING);
  let zoom = STEEPNESS_MAX_ZOOM;
  for (; zoom > MIN_ZOOM; zoom--) {
    const [x0, y0] = project(maxLat, minLng, zoom);
    const [x1, y1] = project(minLat, maxLng, zoom);
    if (x1 - x0 <= availW && y1 - y0 <= availH) break;
  }

  // Global-pixel frame of the thumbnail, centred on the route.
  const [x0, y0] = project(maxLat, minLng, zoom);
  const [x1, y1] = project(minLat, maxLng, zoom);
  const left = (x0 + x1) / 2 - cssW / 2;
  const top = (y0 + y1) / 2 - cssH / 2;

  // Fetch every tile intersecting the frame, for both layers.
  const maxTile = 2 ** zoom - 1;
  const txMin = Math.floor(left / TILE_SIZE);
  const txMax = Math.floor((left + cssW) / TILE_SIZE);
  const tyMin = Math.max(0, Math.floor(top / TILE_SIZE));
  const tyMax = Math.min(maxTile, Math.floor((top + cssH) / TILE_SIZE));

  type Tile = { img: HTMLImageElement; dx: number; dy: number };
  const base: Promise<Tile>[] = [];
  const steep: Promise<Tile>[] = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      const dx = tx * TILE_SIZE - left;
      const dy = ty * TILE_SIZE - top;
      base.push(loadImage(BASE_URL(zoom, tx, ty)).then((img) => ({ img, dx, dy })));
      steep.push(
        loadImage(STEEPNESS_URL(zoom, tx, ty)).then((img) => ({ img, dx, dy })),
      );
    }
  }

  // Missing tiles (e.g. steepness has no coverage outside Norway) just stay
  // blank; everything else still renders.
  const [baseTiles, steepTiles] = await Promise.all([
    Promise.allSettled(base),
    Promise.allSettled(steep),
  ]);
  if (cancelled()) return;

  ctx.fillStyle = '#e8edf2';
  ctx.fillRect(0, 0, cssW, cssH);
  for (const t of baseTiles) {
    if (t.status === 'fulfilled') {
      ctx.drawImage(t.value.img, t.value.dx, t.value.dy, TILE_SIZE, TILE_SIZE);
    }
  }
  ctx.globalAlpha = STEEPNESS_OPACITY;
  for (const t of steepTiles) {
    if (t.status === 'fulfilled') {
      ctx.drawImage(t.value.img, t.value.dx, t.value.dy, TILE_SIZE, TILE_SIZE);
    }
  }
  ctx.globalAlpha = 1;

  // Route on top: white halo, then the planner's pink.
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
  ctx.lineWidth = HALO_WEIGHT;
  trace();
  ctx.strokeStyle = ROUTE_COLOR;
  ctx.lineWidth = ROUTE_WEIGHT;
  trace();
}

type Props = {
  /** The saved route's geometry; falls back to the generic icon if absent. */
  route?: Route;
};

/**
 * North-up mini-map of a route on the steepness overlay, used as the row
 * "icon" in the route library lists. Falls back to the generic route icon
 * while there is no drawable geometry (unparseable row, single point, …).
 */
export function RouteThumbnail({ route }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const points = route ? route.reduce((n, seg) => n + seg.length, 0) : 0;
  const drawable = Boolean(route && points >= 2);

  useEffect(() => {
    if (!drawable || !route || !canvasRef.current) return;
    let cancelled = false;
    void draw(canvasRef.current, route, () => cancelled).catch(() => {
      // Network hiccup: the placeholder background simply stays.
    });
    return () => {
      cancelled = true;
    };
  }, [drawable, route]);

  if (!drawable) {
    return (
      <span className={styles.fallback} aria-hidden="true">
        <RouteIcon />
      </span>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      className={styles.thumb}
      role="img"
      aria-label="Route overview on steepness map, north up"
    />
  );
}
