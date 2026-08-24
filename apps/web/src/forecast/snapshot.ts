// A frozen copy of the snow / avalanche / weather data shown for a route,
// captured when the route is saved. Rendering from this snapshot — instead of
// re-fetching — is what makes a shared route show every viewer exactly the
// same numbers, and it is the only way to preserve a weather forecast at all:
// MET's Locationforecast has no historical mode, so once the tour date passes
// the forecast the owner saw can never be re-fetched (seNorge snow and Varsom
// avalanche *are* date-queryable, but freezing them too keeps every viewer off
// the third-party APIs and guarantees identical data).
//
// The snapshot stores the data in the same shapes the hooks already return, so
// a hook fed a frozen piece can hand it straight back with no reshaping:
//   * weather → per-anchor ForecastResult (full ~10-day hourly window)
//   * snow    → SnowData (per-segment depths, parallel to the profile)
//   * avalanche → the aggregated regions + worst level for one date
//
// Each piece records the owner's selected date; a hook only treats the frozen
// piece as authoritative while the viewer stays on that date. Switching to a
// different day falls through to a live fetch (we only froze the chosen date),
// and the global "Refresh" affordance drops the whole snapshot to go live.

import { createContext } from 'react';
import type { ProfileData } from '../elevation/profile';
import type { LatLng } from '../types';
import { fetchForecast, type WeatherHour } from '../weather/api';
import { weatherCandidates } from '../weather/useWeather';
import { fetchSnowDepths } from '../snow/api';
import type { SnowData } from '../snow/useSnow';
import {
  fetchAvalancheWarning,
  type AvalancheWarning,
} from '../avalanche/api';
import { aggregateWarnings, samplePoints } from '../avalanche/useAvalanche';

export const SNAPSHOT_VERSION = 1 as const;

/** One anchor point's frozen forecast (mirrors weather/api ForecastResult). */
export interface WeatherSnapshotEntry {
  hours: WeatherHour[];
  fetchedAt: number;
}

export interface WeatherSnapshot {
  lowest: WeatherSnapshotEntry | null;
  highest: WeatherSnapshotEntry | null;
  /** Anchor the owner had selected (lowest / highest point of the route). */
  selectedLoc: 'lowest' | 'highest';
  /** Day chip the owner had selected (YYYY-MM-DD), if any. */
  selectedDay: string | null;
}

export interface AvalancheSnapshot {
  date: string;
  level: number;
  regions: AvalancheWarning[];
  fetchedAt: number | null;
}

export interface ForecastSnapshot {
  version: typeof SNAPSHOT_VERSION;
  /** Epoch ms when the snapshot was captured (drives the "not recent" age). */
  createdAt: number;
  weather: WeatherSnapshot | null;
  snow: SnowData | null;
  avalanche: AvalancheSnapshot | null;
}

/** The owner's current, panel-internal selections, published up so a snapshot
 *  can be built from what they actually see. Snow's date lives in App state and
 *  is passed to the builder directly. */
export interface ForecastSelections {
  avalancheDate: string | null;
  weatherDay: string | null;
  weatherLoc: 'lowest' | 'highest';
}

export interface ForecastContextValue {
  /** Frozen data to render (null = live planning / after Refresh). */
  snapshot: ForecastSnapshot | null;
  /** Panels publish their live selections here so a save can capture them.
   *  A stable callback (not a raw ref) so it can be called from an effect
   *  without ESLint's immutability rule flagging a mutation of context. */
  publish: (part: Partial<ForecastSelections>) => void;
}

export const ForecastContext = createContext<ForecastContextValue | null>(null);

/** Runtime guard for a snapshot parsed from the API / storage. Anything that
 *  isn't a recognizably-shaped, current-version snapshot is treated as absent
 *  so a stray or future payload never crashes the planner. */
export function parseSnapshot(raw: unknown): ForecastSnapshot | null {
  if (typeof raw === 'string') {
    try {
      return parseSnapshot(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<ForecastSnapshot>;
  if (s.version !== SNAPSHOT_VERSION) return null;
  if (typeof s.createdAt !== 'number') return null;
  return {
    version: SNAPSHOT_VERSION,
    createdAt: s.createdAt,
    weather: s.weather ?? null,
    snow: s.snow ?? null,
    avalanche: s.avalanche ?? null,
  };
}

/** Reshape a flat per-point depth array back into the profile's segments,
 *  matching the layout useSnow produces. */
function reshapeSnow(profile: ProfileData, flat: number[]): number[][] {
  const out: number[][] = [];
  let off = 0;
  for (const seg of profile.segments) {
    out.push(flat.slice(off, off + seg.length));
    off += seg.length;
  }
  return out;
}

/**
 * Capture the data currently shown for a route into a snapshot. Fetches go
 * through the same cached api layer the panels use, so most calls are already
 * warm; the deliberate Save action is a fine time to fetch the one anchor the
 * weather panel wasn't displaying. Each source is captured independently and a
 * failure in one leaves that piece null rather than failing the whole save.
 */
export async function buildForecastSnapshot(
  profile: ProfileData,
  snowDate: string,
  selections: ForecastSelections,
): Promise<ForecastSnapshot> {
  const weather = await captureWeather(profile, selections).catch(() => null);
  const snow = await captureSnow(profile, snowDate).catch(() => null);
  const avalanche = await captureAvalanche(
    profile,
    selections.avalancheDate,
  ).catch(() => null);

  return {
    version: SNAPSHOT_VERSION,
    createdAt: Date.now(),
    weather,
    snow,
    avalanche,
  };
}

async function captureWeather(
  profile: ProfileData,
  selections: ForecastSelections,
): Promise<WeatherSnapshot | null> {
  const cands = weatherCandidates(profile);
  if (!cands) return null;
  const [lowest, highest] = await Promise.all([
    fetchForecast(cands.lowest.lat, cands.lowest.lng)
      .then((r) => ({ hours: r.hours, fetchedAt: r.fetchedAt }))
      .catch(() => null),
    fetchForecast(cands.highest.lat, cands.highest.lng)
      .then((r) => ({ hours: r.hours, fetchedAt: r.fetchedAt }))
      .catch(() => null),
  ]);
  if (!lowest && !highest) return null;
  return {
    lowest,
    highest,
    selectedLoc: selections.weatherLoc,
    selectedDay: selections.weatherDay,
  };
}

async function captureSnow(
  profile: ProfileData,
  date: string,
): Promise<SnowData | null> {
  const flat: LatLng[] = [];
  for (const seg of profile.segments) {
    for (const p of seg) flat.push([p.lat, p.lng]);
  }
  if (flat.length === 0) return null;
  const { depths, fetchedAt } = await fetchSnowDepths(flat, date);
  return { depths: reshapeSnow(profile, depths), date, fetchedAt };
}

async function captureAvalanche(
  profile: ProfileData,
  date: string | null,
): Promise<AvalancheSnapshot | null> {
  if (!date) return null;
  const points = samplePoints(profile);
  if (points.length === 0) return null;
  const results = await Promise.all(
    points.map((p) => fetchAvalancheWarning(p.lat, p.lng, date)),
  );
  const { level, regions, fetchedAt } = aggregateWarnings(results);
  return { date, level, regions, fetchedAt };
}
