// Turning MET's timeseries into the two things every client that renders it
// needs: the hours grouped into local calendar days, and a precipitation figure
// that is honest about what it is measuring.
//
// Both were written inside apps/web's WeatherPanel. Phase 3 of
// docs/mobile-web-parity-plan.md gives the phone the same table, and the plan's
// one rule is that logic moves here rather than being written twice — which for
// `fmtPrecip` is not a formality. See below.

import { toYMD } from '../time/calendar.ts';
import type { WeatherHour } from './api.ts';

/**
 * Group the forecast by the local calendar day, so a day chip selects a flat
 * list of hours. Days with no hours never appear. Insertion order follows the
 * timeseries, which is chronological; callers that need a stable order sort the
 * keys, which are 'YYYY-MM-DD' and therefore sort lexically.
 */
export function groupByDay(hours: WeatherHour[]): Map<string, WeatherHour[]> {
  const map = new Map<string, WeatherHour[]>();
  for (const h of hours) {
    const ymd = toYMD(new Date(h.time));
    const arr = map.get(ymd);
    if (arr) arr.push(h);
    else map.set(ymd, [h]);
  }
  return map;
}

/**
 * The millimetres to print against a single hour, or null for "print nothing".
 *
 * TWO SEPARATE REASONS TO PRINT NOTHING, and keeping them apart is the whole
 * job of this function.
 *
 * The first is that no rain is forecast, in which case a column of zeroes is
 * noise and the cell is left empty.
 *
 * The second is that MET is not talking about an hour. It publishes hourly for
 * roughly the first two days and six-hourly after that, and the far-out entries
 * carry a six-hour total with no hourly figure at all. A column headed "mm"
 * beside a clock time that showed 4.8 would be read as 4.8 mm in that hour,
 * which is a different weather forecast from 4.8 mm across six hours. So this
 * refuses the coarse figure rather than misattributing it, and the printable
 * briefing — which groups its rows into the periods those totals actually cover
 * — prints them where they mean something.
 *
 * The min/max band collapses to a single number when MET is confident, which is
 * why the two cases below are not one.
 */
export function fmtPrecip(h: WeatherHour): string | null {
  if (h.precipHours != null && h.precipHours !== 1) return null;
  const lo = h.precipMinMm;
  const hi = h.precipMaxMm;
  const mid = h.precipMm;
  if (
    (lo == null || lo === 0) &&
    (hi == null || hi === 0) &&
    (mid == null || mid === 0)
  ) {
    return null;
  }
  if (typeof lo === 'number' && typeof hi === 'number' && hi !== lo) {
    return `${lo.toFixed(lo < 1 ? 1 : 0)}–${hi.toFixed(hi < 10 ? 1 : 0)}`;
  }
  if (typeof mid === 'number') return mid.toFixed(mid < 10 ? 1 : 0);
  return null;
}

/**
 * The rotation, in degrees, for an arrow that points where the wind is blowing
 * TO — given `windFromDeg`, which is the bearing it blows FROM.
 *
 * Both clients draw a glyph that points right at rest (east, 90°), so the turn
 * is (from + 180) − 90. Shared because the +180 is the kind of thing that gets
 * dropped on a re-implementation and produces a chart that is confidently
 * backwards, which is worse than one that is obviously broken.
 */
export function windArrowRotation(windFromDeg: number): number {
  return windFromDeg + 180 - 90;
}
