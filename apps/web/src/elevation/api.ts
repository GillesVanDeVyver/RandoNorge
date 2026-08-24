import type { LatLng } from '../types';

const ENDPOINT = 'https://ws.geonorge.no/hoydedata/v1/punkt';
const BATCH_SIZE = 50;

// Quantize to ~1.1m precision so nearby resampled points hit the cache.
const cache = new Map<string, number>();
const keyOf = ([lat, lng]: LatLng) =>
  `${lat.toFixed(5)},${lng.toFixed(5)}`;

interface PunktResponse {
  punkter: { x: number; y: number; z: number | null }[];
}

async function fetchBatch(
  points: LatLng[],
  signal?: AbortSignal,
): Promise<number[]> {
  // API expects [ost, nord] = [lng, lat] order.
  const param = points.map(([lat, lng]) => [lng, lat]);
  const url = `${ENDPOINT}?koordsys=4326&punkter=${encodeURIComponent(JSON.stringify(param))}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Elevation API ${res.status}`);
  const data = (await res.json()) as PunktResponse;
  return data.punkter.map((p) => (typeof p.z === 'number' ? p.z : NaN));
}

// Fetch elevations for an arbitrary list of points. Returns an array of
// numbers (meters) in the same order as input. Uses an in-memory cache
// keyed by quantized lat/lng so repeated sampling (e.g. after eraser
// edits) avoids hitting the network.
export async function fetchElevations(
  points: LatLng[],
  signal?: AbortSignal,
): Promise<number[]> {
  const result = new Array<number>(points.length);
  const missingIdx: number[] = [];
  const missingPts: LatLng[] = [];
  for (let i = 0; i < points.length; i++) {
    const cached = cache.get(keyOf(points[i]));
    if (cached !== undefined) {
      result[i] = cached;
    } else {
      missingIdx.push(i);
      missingPts.push(points[i]);
    }
  }
  if (missingPts.length === 0) return result;

  // Split missing into batches of BATCH_SIZE and fire them all in parallel.
  const batches: { start: number; pts: LatLng[] }[] = [];
  for (let i = 0; i < missingPts.length; i += BATCH_SIZE) {
    batches.push({ start: i, pts: missingPts.slice(i, i + BATCH_SIZE) });
  }
  const responses = await Promise.all(
    batches.map((b) => fetchBatch(b.pts, signal)),
  );
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const elevations = responses[b];
    for (let j = 0; j < batch.pts.length; j++) {
      const z = elevations[j];
      const idx = missingIdx[batch.start + j];
      result[idx] = z;
      if (Number.isFinite(z)) cache.set(keyOf(batch.pts[j]), z);
    }
  }
  return result;
}
