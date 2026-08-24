// Terrain exposure summary for the tour briefing.
//
// The elevation profile shows steepness and runout continuously, which is the
// right tool while planning. A briefing needs the same information as a few
// numbers a guide can say out loud: how much of this tour is in avalanche
// terrain, how steep does it get, and where.
//
// Everything is measured along the route by DISTANCE, not by point count, so a
// coarsely-resampled long route and a finely-resampled short one are described
// on the same terms. Each consecutive pair of profile points contributes the
// length between them, classified by the mean slope of the pair — the same
// rule the profile chart uses to colour that stretch, so the numbers here and
// the picture there always agree.

import type { ProfileData, ProfilePoint } from '@fjellrute/core/elevation/profile';
import { RUNOUT_UNKNOWN } from '@fjellrute/core/elevation/runout';
import { STEEPNESS_BANDS, type SteepnessBand } from '@fjellrute/core/elevation/steepness';
import { translate } from '@fjellrute/core/i18n/locale';

/** The slope angle at which terrain is conventionally treated as avalanche
 *  terrain in Norwegian practice (and the threshold NVE's overlay starts
 *  painting at). Used for the headline "in avalanche terrain" figure. */
export const AVALANCHE_TERRAIN_MIN_DEG = 30;

export interface BandSummary extends SteepnessBand {
  /** Inclusive lower bound of the band, in degrees. */
  min: number;
  /** Metres of route whose mean slope falls in this band. */
  metres: number;
  /** Share of the measured route length, 0–1. */
  fraction: number;
  /** Localized label, e.g. "35–40°" or "&lt;30°". */
  label: string;
}

export interface RunoutSummary {
  /** Metres of route inside a modeled runout zone (any level). */
  metres: number;
  /** Share of the measured route length, 0–1. */
  fraction: number;
  /** Deepest (closest to release) runout level touched: 0–3. */
  worstLevel: number;
  /** True when the NVE runout lookup failed for part of the route, so the
   *  figures above understate exposure and must be reported as incomplete. */
  incomplete: boolean;
}

export interface TerrainSummary {
  /** Route length actually measured, in metres. */
  measuredM: number;
  /** Steepest mean slope along the route, in degrees; NaN when unknown. */
  maxSlopeDeg: number;
  /** Distance from route start to the steepest stretch, in metres. */
  maxSlopeAtM: number;
  /** Metres at or above AVALANCHE_TERRAIN_MIN_DEG. */
  steepM: number;
  /** Share of the route at or above AVALANCHE_TERRAIN_MIN_DEG, 0–1. */
  steepFraction: number;
  bands: BandSummary[];
  runout: RunoutSummary;
  /** True when no point on the route had usable slope data. */
  slopeUnknown: boolean;
}

/** Mean terrain slope of the stretch between two profile points. Falls back to
 *  whichever endpoint has a finite slope; NaN when both are unknown. Mirrors
 *  ProfilePanel's segmentSlope so colours and numbers stay in step. */
function meanSlope(a: ProfilePoint, b: ProfilePoint): number {
  const aS = Number.isFinite(a.slopeDeg) ? a.slopeDeg : NaN;
  const bS = Number.isFinite(b.slopeDeg) ? b.slopeDeg : NaN;
  if (Number.isNaN(aS)) return bS;
  if (Number.isNaN(bS)) return aS;
  return (aS + bS) / 2;
}

function bandLabel(min: number, max: number): string {
  if (!Number.isFinite(max)) return `>${min}°`;
  if (min === 0) return translate(`under ${max}°`, `under ${max}°`);
  return `${min}–${max}°`;
}

/** Localized name for a runout level (1=long, 2=medium, 3=short). */
export function runoutLevelLabel(level: number): string {
  switch (level) {
    case 1:
      return translate('langt utløp', 'long runout');
    case 2:
      return translate('middels utløp', 'medium runout');
    case 3:
      return translate('kort utløp', 'short runout');
    default:
      return translate('utenfor utløpssone', 'outside runout zones');
  }
}

/**
 * Summarise steepness and runout exposure along a computed route profile.
 * Returns null when there is nothing measurable to describe.
 */
export function summariseTerrain(profile: ProfileData): TerrainSummary | null {
  const bandMetres = new Array<number>(STEEPNESS_BANDS.length).fill(0);
  let measuredM = 0;
  let steepM = 0;
  let maxSlopeDeg = NaN;
  let maxSlopeAtM = 0;
  let runoutM = 0;
  let worstLevel = 0;
  let runoutIncomplete = false;
  let sawSlope = false;

  for (const seg of profile.segments) {
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1];
      const b = seg[i];
      const len = b.distance - a.distance;
      // Guard against the zero/negative steps a degenerate resample can leave.
      if (!(len > 0)) continue;
      measuredM += len;

      const slope = meanSlope(a, b);
      if (Number.isFinite(slope)) {
        sawSlope = true;
        // First band whose exclusive upper bound the slope falls under.
        let idx = STEEPNESS_BANDS.findIndex((band) => slope < band.max);
        if (idx < 0) idx = STEEPNESS_BANDS.length - 1;
        bandMetres[idx] += len;
        if (slope >= AVALANCHE_TERRAIN_MIN_DEG) steepM += len;
        if (Number.isNaN(maxSlopeDeg) || slope > maxSlopeDeg) {
          maxSlopeDeg = slope;
          maxSlopeAtM = a.distance;
        }
      }

      // Runout: a stretch counts as exposed when BOTH endpoints are inside a
      // modeled zone, matching the profile chart's conservative rule at zone
      // boundaries. An unknown at either end taints the stretch instead of
      // being silently read as "safe".
      if (a.runoutLevel === RUNOUT_UNKNOWN || b.runoutLevel === RUNOUT_UNKNOWN) {
        runoutIncomplete = true;
      } else {
        const lvl = Math.min(a.runoutLevel, b.runoutLevel);
        if (lvl > 0) {
          runoutM += len;
          if (lvl > worstLevel) worstLevel = lvl;
        }
      }
    }
  }

  if (measuredM <= 0) return null;

  let min = 0;
  const bands: BandSummary[] = STEEPNESS_BANDS.map((band, i) => {
    const summary: BandSummary = {
      ...band,
      min,
      metres: bandMetres[i],
      fraction: bandMetres[i] / measuredM,
      label: bandLabel(min, band.max),
    };
    min = band.max;
    return summary;
  });

  return {
    measuredM,
    maxSlopeDeg,
    maxSlopeAtM,
    steepM,
    steepFraction: steepM / measuredM,
    bands,
    runout: {
      metres: runoutM,
      fraction: runoutM / measuredM,
      worstLevel,
      incomplete: runoutIncomplete,
    },
    slopeUnknown: !sawSlope,
  };
}
