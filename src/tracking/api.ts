// Client for the recorded-tracks API (worker/tracks.js). Mirrors the
// saved-routes client (src/routes/api.ts): same-origin /api/tracks…,
// authenticated by the Better Auth session cookie.
//
// Storage format: the recorded `Route` (segments of [lat, lng] — one
// segment per uninterrupted recording stretch, pauses start a new one) is
// serialized as a GeoJSON Feature with a MultiLineString geometry plus the
// display stats (distanceM, ascentM, descentM, durationS, movingS,
// maxSpeedMps) in `properties`, so activity lists can render without
// re-running the elevation pipeline. Per-fix timestamps travel in
// `properties.times` (epoch ms, shaped exactly like the coordinates), so
// reviewing a completed tour can scrub through real clock time and derive
// speed/pace at any point. Tracks saved before timestamps were recorded
// simply have no `times` — reviews degrade to distance-only scrubbing.

import type { LatLng, Route, TrackTimes } from '../types';

export interface TrackStats {
  distanceM: number | null;
  ascentM: number | null;
  descentM: number | null;
  durationS: number | null;
  /** Time actually spent moving, seconds (standing still excluded). */
  movingS: number | null;
  /** Fastest observed speed, m/s. */
  maxSpeedMps: number | null;
}

/** What the API stores in the `geometry` column. */
interface TrackFeature {
  type: 'Feature';
  properties: {
    distanceM: number | null;
    ascentM: number | null;
    descentM: number | null;
    durationS: number | null;
    movingS?: number | null;
    maxSpeedMps?: number | null;
    /** Epoch ms per point, aligned with geometry.coordinates. */
    times?: number[][] | null;
  };
  geometry: {
    type: 'MultiLineString';
    /** GeoJSON position order: [lng, lat]. */
    coordinates: [number, number][][];
  };
}

/** A recorded track as returned by the API, with the geometry parsed. */
export interface SavedTrack {
  id: string;
  /** The planned route this track navigated (null if none / deleted). */
  routeId: string | null;
  name: string;
  track: Route;
  /** Per-fix timestamps (epoch ms), shaped like `track`; null for tracks
   *  saved before timestamps were recorded. */
  times: TrackTimes | null;
  distanceM: number | null;
  ascentM: number | null;
  descentM: number | null;
  /** Active recording time in seconds (pauses excluded). */
  durationS: number | null;
  /** Time spent moving, seconds; null on older tracks. */
  movingS: number | null;
  /** Fastest observed speed, m/s; null on older tracks. */
  maxSpeedMps: number | null;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
}

export function trackToFeature(
  track: Route,
  stats: TrackStats,
  times?: TrackTimes | null,
): TrackFeature {
  // The API requires every line to have ≥ 2 positions; drop fragments
  // (e.g. a segment where only one fix arrived before a pause). The
  // timestamp arrays are filtered by the same mask so they stay aligned
  // with the surviving coordinates.
  const keep = track.map((seg) => seg.length >= 2);
  const kept = track.filter((_, s) => keep[s]);
  const keptTimes =
    times && times.length === track.length
      ? times.filter((_, s) => keep[s])
      : null;
  const timesAligned =
    keptTimes !== null &&
    keptTimes.every((seg, s) => seg.length === kept[s].length);
  return {
    type: 'Feature',
    properties: {
      distanceM: stats.distanceM !== null ? Math.round(stats.distanceM) : null,
      ascentM: stats.ascentM !== null ? Math.round(stats.ascentM) : null,
      descentM: stats.descentM !== null ? Math.round(stats.descentM) : null,
      durationS: stats.durationS !== null ? Math.round(stats.durationS) : null,
      movingS: stats.movingS !== null ? Math.round(stats.movingS) : null,
      maxSpeedMps: stats.maxSpeedMps,
      times: timesAligned ? keptTimes : null,
    },
    geometry: {
      type: 'MultiLineString',
      coordinates: kept.map((seg) => seg.map(([lat, lng]) => [lng, lat])),
    },
  };
}

function featureToTrack(feature: TrackFeature): Route {
  return feature.geometry.coordinates.map((line) =>
    line.map(([lng, lat]): LatLng => [lat, lng]),
  );
}

interface ApiTrackRow {
  id: string;
  routeId: string | null;
  name: string;
  geometry: string;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
}

function parseRow(row: ApiTrackRow): SavedTrack {
  let track: Route = [];
  let times: TrackTimes | null = null;
  let distanceM: number | null = null;
  let ascentM: number | null = null;
  let descentM: number | null = null;
  let durationS: number | null = null;
  let movingS: number | null = null;
  let maxSpeedMps: number | null = null;
  try {
    const feature = JSON.parse(row.geometry) as TrackFeature;
    track = featureToTrack(feature);
    distanceM = feature.properties?.distanceM ?? null;
    ascentM = feature.properties?.ascentM ?? null;
    descentM = feature.properties?.descentM ?? null;
    durationS = feature.properties?.durationS ?? null;
    movingS = feature.properties?.movingS ?? null;
    maxSpeedMps = feature.properties?.maxSpeedMps ?? null;
    // Only accept timestamps whose shape matches the track exactly; a
    // mismatch (hand-edited row, partial write) degrades to no timing
    // rather than misaligned scrubbing.
    const t = feature.properties?.times;
    if (
      Array.isArray(t) &&
      t.length === track.length &&
      t.every(
        (seg, s) =>
          Array.isArray(seg) &&
          seg.length === track[s].length &&
          seg.every((v) => Number.isFinite(v)),
      )
    ) {
      times = t;
    }
  } catch {
    // A row with unreadable geometry still lists (name/date), it just
    // can't be drawn on the map.
  }
  return {
    id: row.id,
    routeId: row.routeId,
    name: row.name,
    track,
    times,
    distanceM,
    ascentM,
    descentM,
    durationS,
    movingS,
    maxSpeedMps,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Non-JSON error body; keep the status message.
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function listTracks(): Promise<SavedTrack[]> {
  const data = await request<{ tracks: ApiTrackRow[] }>('/api/tracks');
  return data.tracks.map(parseRow);
}

export async function createTrack(input: {
  name: string;
  routeId?: string | null;
  track: Route;
  times?: TrackTimes | null;
  stats: TrackStats;
  startedAt: string;
  finishedAt: string;
}): Promise<SavedTrack> {
  const row = await request<ApiTrackRow>('/api/tracks', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      routeId: input.routeId ?? null,
      geometry: trackToFeature(input.track, input.stats, input.times),
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    }),
  });
  return parseRow(row);
}

export async function deleteTrack(id: string): Promise<void> {
  await request<{ ok: true }>(`/api/tracks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
