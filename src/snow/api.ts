import type { LatLng } from '../types';

// Snow depth lookups against NVE's seNorge GridTimeSeries service. The grid
// is 1×1 km in UTM zone 33N, so route points are first projected to UTM33N
// and quantized to the cell origin before hitting the network. A single hike
// of ~20 km typically reduces to a few dozen unique cells, which we fetch in
// parallel and cache for the (cell, date) pair.

// NVE's GTS endpoint does not send CORS headers, so in the browser we go
// through the Vite dev proxy (see vite.config.ts). The proxy rewrites the
// `/gts-api` prefix to `https://gts.nve.no/api`.
const ENDPOINT = '/gts-api/GridTimeSeries';
const CELL_SIZE_M = 1000;

// WGS84 → UTM zone 33N forward projection (central meridian 15°E). The
// ellipsoidal formulas below match Snyder / EPSG 9807 to sub-meter accuracy
// across mainland Norway, which is more than enough for a 1 km grid lookup.
function latLngToUtm33(lat: number, lng: number): [number, number] {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;
  const lon0 = (15 * Math.PI) / 180;
  const FE = 500000;
  const FN = 0;

  const phi = (lat * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = ep2 * cosPhi * cosPhi;
  const A = cosPhi * (lam - lon0);

  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) *
        Math.sin(2 * phi) +
      ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * phi));

  const A2 = A * A;
  const A3 = A2 * A;
  const A4 = A2 * A2;
  const A5 = A4 * A;
  const A6 = A4 * A2;

  const x =
    FE +
    k0 *
      N *
      (A +
        ((1 - T + C) * A3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5) / 120);
  const y =
    FN +
    k0 *
      (M +
        N *
          tanPhi *
          (A2 / 2 +
            ((5 - T + 9 * C + 4 * C * C) * A4) / 24 +
            ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6) / 720));
  return [x, y];
}

// (cellKey + date) → snow depth in cm. NaN means "fetched, no data here".
// Entries expire after CACHE_TTL_MS: seNorge's grid for "today" is updated
// during the day, so a session-long cache could keep showing this morning's
// snow depth all day. Historical dates rarely change, but a uniform 1 h TTL
// keeps the logic simple and the service load negligible.
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; v: number }>();
const cellKey = (cx: number, cy: number) => `${cx},${cy}`;
const fullKey = (k: string, date: string) => `${k}@${date}`;

interface GtsResponse {
  Theme: string;
  Unit: string;
  NoDataValue?: number;
  Data: (number | null)[];
}

async function fetchCell(
  x: number,
  y: number,
  date: string,
  signal?: AbortSignal,
): Promise<number> {
  const url = `${ENDPOINT}/${x}/${y}/${date}/${date}/sd.json`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Snow API ${res.status}`);
  const data = (await res.json()) as GtsResponse;
  const noData = data.NoDataValue;
  const v = data.Data?.[0];
  if (typeof v !== 'number') return NaN;
  if (typeof noData === 'number' && v === noData) return NaN;
  if (v < 0) return NaN;
  return v;
}

// Fetch snow depth (cm) for each input point on the given date. Returns an
// array of numbers in input order; NaN where the cell has no data (sea,
// outside the seNorge grid, or date out of range).
export async function fetchSnowDepths(
  points: LatLng[],
  date: string,
  signal?: AbortSignal,
): Promise<number[]> {
  if (points.length === 0) return [];

  const cells: { key: string; cx: number; cy: number; x: number; y: number }[] = [];
  const pointKeys: string[] = new Array(points.length);
  const seen = new Set<string>();
  for (let i = 0; i < points.length; i++) {
    const [lat, lng] = points[i];
    const [x, y] = latLngToUtm33(lat, lng);
    const cx = Math.floor(x / CELL_SIZE_M);
    const cy = Math.floor(y / CELL_SIZE_M);
    const k = cellKey(cx, cy);
    pointKeys[i] = k;
    if (!seen.has(k)) {
      seen.add(k);
      cells.push({ key: k, cx, cy, x: Math.round(x), y: Math.round(y) });
    }
  }

  await Promise.all(
    cells.map(async (c) => {
      const fk = fullKey(c.key, date);
      const hit = cache.get(fk);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) return;
      try {
        const v = await fetchCell(c.x, c.y, date, signal);
        cache.set(fk, { at: Date.now(), v });
      } catch {
        // Leave uncached (or stale) so a later retry can fill it in.
      }
    }),
  );

  return pointKeys.map((k) => {
    const hit = cache.get(fullKey(k, date));
    return hit ? hit.v : NaN;
  });
}
