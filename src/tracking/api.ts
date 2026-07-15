// Client for the recorded-tracks API (worker/tracks.js). Mirrors the
// saved-routes client (src/routes/api.ts): same-origin /api/tracks…,
// authenticated by the Better Auth session cookie.
//
// Storage format: the recorded `Route` (segments of [lat, lng] — one
// segment per uninterrupted recording stretch, pauses start a new one) is
// serialized as a GeoJSON Feature with a MultiLineString geometry plus the
// display stats (distanceM, ascentM, descentM, durationS) in `properties`,
// so activity lists can render without re-running the elevation pipeline.

import type { LatLng, Route } from '../types';

export interface TrackStats {
  distanceM: number | null;
  ascentM: number | null;
  descentM: number | null;
  durationS: number | null;
}

/** What the API stores in the `geometry` column. */
interface TrackFeature {
  type: 'Feature';
  properties: {
    distanceM: number | null;
    ascentM: number | null;
    descentM: number | null;
    durationS: number | null;
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
  distanceM: number | null;
  ascentM: number | null;
  descentM: number | null;
  /** Active recording time in seconds (pauses excluded). */
  durationS: number | null;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
}

export function trackToFeature(track: Route, stats: TrackStats): TrackFeature {
  return {
    type: 'Feature',
    properties: {
      distanceM: stats.distanceM !== null ? Math.round(stats.distanceM) : null,
      ascentM: stats.ascentM !== null ? Math.round(stats.ascentM) : null,
      descentM: stats.descentM !== null ? Math.round(stats.descentM) : null,
      durationS: stats.durationS !== null ? Math.round(stats.durationS) : null,
    },
    geometry: {
      type: 'MultiLineString',
      // The API requires every line to have ≥ 2 positions; drop fragments
      // (e.g. a segment where only one fix arrived before a pause).
      coordinates: track
        .filter((seg) => seg.length >= 2)
        .map((seg) => seg.map(([lat, lng]) => [lng, lat])),
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
  let distanceM: number | null = null;
  let ascentM: number | null = null;
  let descentM: number | null = null;
  let durationS: number | null = null;
  try {
    const feature = JSON.parse(row.geometry) as TrackFeature;
    track = featureToTrack(feature);
    distanceM = feature.properties?.distanceM ?? null;
    ascentM = feature.properties?.ascentM ?? null;
    descentM = feature.properties?.descentM ?? null;
    durationS = feature.properties?.durationS ?? null;
  } catch {
    // A row with unreadable geometry still lists (name/date), it just
    // can't be drawn on the map.
  }
  return {
    id: row.id,
    routeId: row.routeId,
    name: row.name,
    track,
    distanceM,
    ascentM,
    descentM,
    durationS,
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
  stats: TrackStats;
  startedAt: string;
  finishedAt: string;
}): Promise<SavedTrack> {
  const row = await request<ApiTrackRow>('/api/tracks', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      routeId: input.routeId ?? null,
      geometry: trackToFeature(input.track, input.stats),
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
