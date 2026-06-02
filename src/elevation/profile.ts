import type { LatLng, Route } from '../types';
import { haversine, resample } from '../geometry';
import { fetchElevations } from './api';

const RESAMPLE_INTERVAL_M = 20;
const MIN_SEGMENT_LENGTH_M = 50;
const ASCENT_THRESHOLD_M = 3;

export interface ProfilePoint {
  distance: number; // cumulative distance from route start, meters
  elevation: number; // meters above sea level
  lat: number;
  lng: number;
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

  const elevations = await fetchElevations(flat, signal);

  // Rebuild per-segment profile points with cumulative distance.
  const segments: ProfilePoint[][] = [];
  let cumDist = 0;
  let flatIdx = 0;
  for (let s = 0; s < resampled.length; s++) {
    const seg = resampled[s];
    const segPoints: ProfilePoint[] = [];
    for (let i = 0; i < seg.length; i++) {
      if (i > 0) cumDist += haversine(seg[i - 1], seg[i]);
      segPoints.push({
        distance: cumDist,
        elevation: elevations[flatIdx],
        lat: seg[i][0],
        lng: seg[i][1],
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
