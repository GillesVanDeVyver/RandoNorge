// Reading the seNorge depths against the profile they were fetched for.
//
// Kept out of SnowSvg.tsx so that file exports a component and nothing else
// (same reason axis.ts exists), and because the sheet needs the summary
// numbers for its key-facts panel whether or not the chart is drawn.
//
// seNorge is an interpolated 1 km grid model, not a measurement at your feet.
// Everything here therefore reports a range along the route and how much of it
// the grid actually answered for, rather than one confident headline number.

import type { ProfileData } from '../elevation/profile';
import type { SnowData } from '../snow/useSnow';

export interface SnowSummary {
  minCm: number;
  maxCm: number;
  meanCm: number;
  /** Share of route points the seNorge grid answered for, 0–1. */
  coverage: number;
  /** Depth at the route's lowest and highest points, or null when unknown. */
  atLowCm: number | null;
  atHighCm: number | null;
}

export interface SnowSample {
  d: number; // distance along route, metres
  cm: number; // depth; NaN where the grid had nothing
  e: number; // elevation, for the low/high readings
}

/** Flatten the per-segment depths alongside the profile they were fetched for.
 *  Returns [] when the two disagree in shape, which is the honest response to
 *  a snapshot saved against a different route. */
export function snowSamples(
  profile: ProfileData,
  snow: SnowData | null,
): SnowSample[] {
  if (!snow) return [];
  const out: SnowSample[] = [];
  for (let s = 0; s < profile.segments.length; s++) {
    const seg = profile.segments[s];
    const depths = snow.depths[s];
    if (!depths || depths.length !== seg.length) return [];
    for (let i = 0; i < seg.length; i++) {
      out.push({ d: seg[i].distance, cm: depths[i], e: seg[i].elevation });
    }
  }
  return out;
}

export function summariseSnow(
  profile: ProfileData,
  snow: SnowData | null,
): SnowSummary | null {
  const pts = snowSamples(profile, snow);
  if (pts.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  let low: SnowSample | null = null;
  let high: SnowSample | null = null;
  for (const p of pts) {
    if (Number.isFinite(p.e)) {
      if (!low || p.e < low.e) low = p;
      if (!high || p.e > high.e) high = p;
    }
    if (!Number.isFinite(p.cm)) continue;
    n++;
    sum += p.cm;
    if (p.cm < min) min = p.cm;
    if (p.cm > max) max = p.cm;
  }
  // Every point fell outside the grid: no range to report, and inventing one
  // from an empty set would print "Infinity–-Infinity cm".
  if (n === 0) return null;

  return {
    minCm: min,
    maxCm: max,
    meanCm: sum / n,
    coverage: n / pts.length,
    atLowCm: low && Number.isFinite(low.cm) ? low.cm : null,
    atHighCm: high && Number.isFinite(high.cm) ? high.cm : null,
  };
}
