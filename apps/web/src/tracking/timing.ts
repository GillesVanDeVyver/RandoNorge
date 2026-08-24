// Distance ↔ time mapping for a recorded track with per-fix timestamps.
//
// The review elevation profile is plotted over cumulative distance (the
// elevation pipeline resamples the track geometry), while the recorder
// stores one timestamp per accepted GPS fix. This module builds a
// monotonic (distance, time) curve from the raw fixes so any chart
// position can be translated into "when was I here" — plus a smoothed
// speed at every fix, so the chart can also answer "how fast was I moving
// here".
//
// Distance accumulation deliberately mirrors src/elevation/profile.ts:
// segments with fewer than 2 points or shorter than MIN_SEGMENT_LENGTH_M
// are skipped entirely, and the cumulative distance continues across kept
// segments without adding the gap between them. That keeps this curve's
// x-values aligned with the profile samples the chart actually renders.

import type { Route, TrackTimes } from '../types';
import { haversine } from '../geometry';

// Same threshold as the elevation profile (src/elevation/profile.ts).
const MIN_SEGMENT_LENGTH_M = 50;
// Half-width of the speed smoothing window. Raw fix-to-fix speeds are
// noisy (a 3 m step over 2 s quantizes badly); averaging displacement
// over ±10 s gives a stable, human-plausible reading.
const SPEED_WINDOW_MS = 10000;

export interface TrackTiming {
  /** Cumulative distance (m) at each kept fix, monotonic non-decreasing. */
  distances: number[];
  /** Fix timestamp (epoch ms) at each kept fix, monotonic non-decreasing. */
  timesMs: number[];
  /** Smoothed speed (m/s) at each kept fix; null where undeterminable. */
  speeds: (number | null)[];
}

/**
 * Builds the timing curve, or null when the track has no usable
 * timestamps (older saved tracks, or shape mismatch).
 */
export function buildTrackTiming(
  track: Route,
  times: TrackTimes | null | undefined,
): TrackTiming | null {
  if (!times || times.length !== track.length) return null;

  const distances: number[] = [];
  const timesMs: number[] = [];
  // Index ranges of each kept segment, so speed smoothing never averages
  // across a pause (the time gap between segments is not motion).
  const segRanges: [number, number][] = [];

  let cumDist = 0;
  for (let s = 0; s < track.length; s++) {
    const seg = track[s];
    const tseg = times[s];
    if (seg.length < 2 || tseg.length !== seg.length) continue;
    let segLen = 0;
    for (let i = 1; i < seg.length; i++) segLen += haversine(seg[i - 1], seg[i]);
    if (segLen < MIN_SEGMENT_LENGTH_M) continue;
    const from = distances.length;
    for (let i = 0; i < seg.length; i++) {
      if (i > 0) cumDist += haversine(seg[i - 1], seg[i]);
      distances.push(cumDist);
      timesMs.push(tseg[i]);
    }
    segRanges.push([from, distances.length - 1]);
  }
  if (distances.length < 2) return null;

  // Smoothed speed per fix: displacement over the fixes within ±SPEED_WINDOW_MS,
  // clamped to the fix's own segment so paused time never dilutes it.
  const speeds: (number | null)[] = new Array(distances.length).fill(null);
  for (const [from, to] of segRanges) {
    let lo = from;
    let hi = from;
    for (let i = from; i <= to; i++) {
      const t = timesMs[i];
      while (lo < i && timesMs[lo] < t - SPEED_WINDOW_MS) lo++;
      if (hi < i) hi = i;
      while (hi < to && timesMs[hi + 1] <= t + SPEED_WINDOW_MS) hi++;
      const dtS = (timesMs[hi] - timesMs[lo]) / 1000;
      if (dtS > 0) speeds[i] = (distances[hi] - distances[lo]) / dtS;
    }
  }

  return { distances, timesMs, speeds };
}

// Binary search: greatest index i with arr[i] <= v (arr non-decreasing).
// Returns -1 when v precedes the first element.
function lowerIndex(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  if (v < arr[0]) return -1;
  if (v >= arr[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

function interpolate(
  xs: number[],
  ys: number[],
  x: number,
): number | null {
  const i = lowerIndex(xs, x);
  if (i < 0) return ys[0];
  if (i >= xs.length - 1) return ys[ys.length - 1];
  const span = xs[i + 1] - xs[i];
  if (span <= 0) return ys[i];
  const t = (x - xs[i]) / span;
  return ys[i] + (ys[i + 1] - ys[i]) * t;
}

/** Clock time (epoch ms) at a cumulative distance along the track. */
export function timeAtDistance(
  timing: TrackTiming,
  distanceM: number,
): number | null {
  return interpolate(timing.distances, timing.timesMs, distanceM);
}

/** Cumulative distance (m) at a clock time (epoch ms). */
export function distanceAtTime(
  timing: TrackTiming,
  timeMs: number,
): number | null {
  return interpolate(timing.timesMs, timing.distances, timeMs);
}

/** Smoothed speed (m/s) at a cumulative distance along the track. */
export function speedAtDistance(
  timing: TrackTiming,
  distanceM: number,
): number | null {
  const i = lowerIndex(timing.distances, distanceM);
  if (i < 0) return timing.speeds[0];
  const a = timing.speeds[i];
  const b = i + 1 < timing.speeds.length ? timing.speeds[i + 1] : null;
  if (a === null) return b;
  if (b === null) return a;
  const span = timing.distances[i + 1] - timing.distances[i];
  if (span <= 0) return a;
  const t = (distanceM - timing.distances[i]) / span;
  return a + (b - a) * t;
}
