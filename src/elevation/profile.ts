import type { LatLng, Route } from '../types';
import { haversine, resample } from '../geometry';
import { fetchElevations } from './api';
import { fetchRunoutLevels, type RunoutLevel } from './runout';

const RESAMPLE_INTERVAL_M = 20;
const MIN_SEGMENT_LENGTH_M = 50;
const ASCENT_THRESHOLD_M = 3;
// Half-distance (m) between paired neighbor samples used to estimate the
// terrain gradient at each route point. The Kartverket DTM is on a 10 m
// grid, so anything <= ~10 m gets lost to quantization. 30 m spans several
// cells in each direction and gives a stable slope estimate while still
// being local enough to match the Bratthet overlay visually.
const SLOPE_SAMPLE_OFFSET_M = 30;

export interface ProfilePoint {
  distance: number; // cumulative distance from route start, meters
  elevation: number; // meters above sea level
  lat: number;
  lng: number;
  slopeDeg: number; // terrain slope at this point (degrees), NaN if unknown
  runoutLevel: RunoutLevel; // 0=none, 1=long, 2=medium, 3=short runout
}

export interface ProfileStats {
  distance: number;
  ascent: number;
  descent: number;
  minElevation: number;
  maxElevation: number;
}

export interface ProfileData {
  segments: ProfilePoint[][];
  stats: ProfileStats;
}

// Compute the elevation profile of a route: resample each segment at 20 m,
// fetch elevations from Kartverket, return per-segment point arrays plus
// aggregate stats. Segments shorter than MIN_SEGMENT_LENGTH_M are skipped.
export async function computeProfile(
  route: Route,
  signal?: AbortSignal,
): Promise<ProfileData> {
  // Resample each segment.
  const resampled = route
    .map((seg) => resample(seg, RESAMPLE_INTERVAL_M))
    .filter((seg) => seg.length >= 2 && totalLength(seg) >= MIN_SEGMENT_LENGTH_M);

  // Flatten for a single batched elevation fetch.
  const flat: LatLng[] = [];
  const segLens: number[] = [];
  for (const seg of resampled) {
    segLens.push(seg.length);
    for (const p of seg) flat.push(p);
  }

  if (flat.length === 0) {
    return {
      segments: [],
      stats: {
        distance: 0,
        ascent: 0,
        descent: 0,
        minElevation: 0,
        maxElevation: 0,
      },
    };
  }

  // Build neighbor points (N/S/E/W) for each route point so we can compute
  // the terrain gradient via central differences. Layout in `neighbors`:
  // [p0_N, p0_S, p0_E, p0_W, p1_N, p1_S, p1_E, p1_W, ...].
  const neighbors: LatLng[] = [];
  for (const [lat, lng] of flat) {
    const dLat = SLOPE_SAMPLE_OFFSET_M / 111320;
    const dLng =
      SLOPE_SAMPLE_OFFSET_M / (111320 * Math.cos((lat * Math.PI) / 180));
    neighbors.push([lat + dLat, lng]); // N
    neighbors.push([lat - dLat, lng]); // S
    neighbors.push([lat, lng + dLng]); // E
    neighbors.push([lat, lng - dLng]); // W
  }

  const [elevations, neighborElev, runoutLevels] = await Promise.all([
    fetchElevations(flat, signal),
    fetchElevations(neighbors, signal),
    fetchRunoutLevels(flat, signal),
  ]);

  // Rebuild per-segment profile points with cumulative distance.
  const segments: ProfilePoint[][] = [];
  let cumDist = 0;
  let flatIdx = 0;
  const twoD = 2 * SLOPE_SAMPLE_OFFSET_M;
  for (let s = 0; s < resampled.length; s++) {
    const seg = resampled[s];
    const segPoints: ProfilePoint[] = [];
    for (let i = 0; i < seg.length; i++) {
      if (i > 0) cumDist += haversine(seg[i - 1], seg[i]);
      const zN = neighborElev[flatIdx * 4];
      const zS = neighborElev[flatIdx * 4 + 1];
      const zE = neighborElev[flatIdx * 4 + 2];
      const zW = neighborElev[flatIdx * 4 + 3];
      let slopeDeg = NaN;
      if (
        Number.isFinite(zN) &&
        Number.isFinite(zS) &&
        Number.isFinite(zE) &&
        Number.isFinite(zW)
      ) {
        const dzdy = (zN - zS) / twoD;
        const dzdx = (zE - zW) / twoD;
        slopeDeg =
          (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      }
      segPoints.push({
        distance: cumDist,
        elevation: elevations[flatIdx],
        lat: seg[i][0],
        lng: seg[i][1],
        slopeDeg,
        runoutLevel: runoutLevels[flatIdx],
      });
      flatIdx++;
    }
    segments.push(segPoints);
  }

  return { segments, stats: computeStats(segments) };
}

function totalLength(seg: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < seg.length; i++) total += haversine(seg[i - 1], seg[i]);
  return total;
}

function computeStats(segments: ProfilePoint[][]): ProfileStats {
  let distance = 0;
  let ascent = 0;
  let descent = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const seg of segments) {
    if (seg.length === 0) continue;
    distance = Math.max(distance, seg[seg.length - 1].distance);
    // Hysteresis-smoothed elevation accumulation: only count moves > threshold.
    let ref = seg[0].elevation;
    for (const p of seg) {
      if (Number.isFinite(p.elevation)) {
        if (p.elevation < min) min = p.elevation;
        if (p.elevation > max) max = p.elevation;
        const diff = p.elevation - ref;
        if (Math.abs(diff) >= ASCENT_THRESHOLD_M) {
          if (diff > 0) ascent += diff;
          else descent += -diff;
          ref = p.elevation;
        }
      }
    }
  }

  return {
    distance,
    ascent: Math.round(ascent),
    descent: Math.round(descent),
    minElevation: Number.isFinite(min) ? Math.round(min) : 0,
    maxElevation: Number.isFinite(max) ? Math.round(max) : 0,
  };
}
