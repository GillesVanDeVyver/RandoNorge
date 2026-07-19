// Client for the anonymous public API (worker/public.js) and the signed-in
// user's own handle (worker/username.js).
//
// Shared routes/tracks are returned in the very same in-memory shapes as
// the owner's own library (`SavedRoute` / `SavedTrack`), so every viewer —
// the public route/track page and the public profile list — can reuse the
// exact rendering the owner sees. The only extra is `owner` (public display
// name + handle) travelling alongside.

import type { LatLng, Route, TrackTimes } from '../types';
import type { SavedRoute } from '../routes/api';
import type { SavedTrack } from '../tracking/api';

/** Public identity of an account: never includes the email address. */
export interface Owner {
  name: string;
  username: string | null;
}

interface Feature {
  type: 'Feature';
  properties?: Record<string, unknown> | null;
  geometry: { type: 'MultiLineString'; coordinates: [number, number][][] };
}

/** GeoJSON [lng, lat] MultiLineString → the app's [lat, lng] `Route`. */
function featureToRoute(geometry: string): {
  route: Route;
  props: Record<string, unknown>;
} {
  try {
    const feature = JSON.parse(geometry) as Feature;
    const route = feature.geometry.coordinates.map((line) =>
      line.map(([lng, lat]): LatLng => [lat, lng]),
    );
    return { route, props: feature.properties ?? {} };
  } catch {
    return { route: [], props: {} };
  }
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface PublicRouteRow {
  shareSlug?: string;
  name: string;
  description: string | null;
  geometry: string;
  createdAt: string;
  updatedAt: string;
}

/** Build the owner-equivalent `SavedRoute` from a public row. `id` carries
 *  the share slug so the row can link to its own public page. */
function toSavedRoute(row: PublicRouteRow, slug: string): SavedRoute {
  const { route, props } = featureToRoute(row.geometry);
  return {
    id: slug,
    name: row.name,
    description: row.description,
    route,
    distanceM: num(props.distanceM),
    ascentM: num(props.ascentM),
    descentM: num(props.descentM),
    isShared: true,
    shareSlug: slug,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface PublicTrackRow {
  shareSlug?: string;
  name: string;
  geometry: string;
  startedAt: string;
  finishedAt: string;
  createdAt?: string;
}

function toSavedTrack(row: PublicTrackRow, slug: string): SavedTrack {
  const { route, props } = featureToRoute(row.geometry);
  const t = props.times;
  const times =
    Array.isArray(t) &&
    t.length === route.length &&
    t.every(
      (seg, s) =>
        Array.isArray(seg) &&
        seg.length === route[s].length &&
        seg.every((v) => Number.isFinite(v)),
    )
      ? (t as TrackTimes)
      : null;
  return {
    id: slug,
    routeId: null,
    name: row.name,
    track: route,
    times,
    distanceM: num(props.distanceM),
    ascentM: num(props.ascentM),
    descentM: num(props.descentM),
    durationS: num(props.durationS),
    movingS: num(props.movingS),
    maxSpeedMps: num(props.maxSpeedMps),
    isShared: true,
    shareSlug: slug,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt ?? row.finishedAt,
  };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (res.status === 404) throw new NotFoundError();
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

/** Thrown when a slug/username doesn't resolve (or isn't public), so the UI
 *  can show a friendly "not found / no longer shared" state. */
export class NotFoundError extends Error {
  constructor() {
    super('not found');
    this.name = 'NotFoundError';
  }
}

export interface PublicRoute {
  route: SavedRoute;
  owner: Owner;
}

export async function getPublicRoute(slug: string): Promise<PublicRoute> {
  const data = await get<PublicRouteRow & { owner: Owner }>(
    `/api/public/route/${encodeURIComponent(slug)}`,
  );
  return { route: toSavedRoute(data, slug), owner: data.owner };
}

export interface PublicTrack {
  track: SavedTrack;
  /** The planned route the tour navigated, if it too is public. */
  planned: SavedRoute | null;
  owner: Owner;
}

export async function getPublicTrack(slug: string): Promise<PublicTrack> {
  const data = await get<
    PublicTrackRow & {
      owner: Owner;
      planned: { name: string; geometry: string } | null;
    }
  >(`/api/public/track/${encodeURIComponent(slug)}`);
  const planned = data.planned
    ? toSavedRoute(
        {
          name: data.planned.name,
          description: null,
          geometry: data.planned.geometry,
          createdAt: data.startedAt,
          updatedAt: data.finishedAt,
        },
        `${slug}-plan`,
      )
    : null;
  return { track: toSavedTrack(data, slug), planned, owner: data.owner };
}

export interface PublicProfile {
  owner: Owner;
  routes: SavedRoute[];
  tracks: SavedTrack[];
}

export async function getPublicProfile(username: string): Promise<PublicProfile> {
  const data = await get<{
    owner: Owner;
    routes: (PublicRouteRow & { shareSlug: string })[];
    tracks: (PublicTrackRow & { shareSlug: string })[];
  }>(`/api/public/profile/${encodeURIComponent(username)}`);
  return {
    owner: data.owner,
    routes: data.routes.map((r) => toSavedRoute(r, r.shareSlug)),
    tracks: data.tracks.map((t) => toSavedTrack(t, t.shareSlug)),
  };
}

// ---- The signed-in user's own handle -----------------------------------

export async function getMyUsername(): Promise<string | null> {
  const res = await fetch('/api/me/username');
  if (!res.ok) return null;
  const data = (await res.json()) as { username: string | null };
  return data.username;
}

/** Set/change the handle. Throws with the server's message on 4xx (e.g.
 *  "that username is taken", validation errors). */
export async function setMyUsername(username: string): Promise<string> {
  const res = await fetch('/api/me/username', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    username?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data.username ?? username;
}
