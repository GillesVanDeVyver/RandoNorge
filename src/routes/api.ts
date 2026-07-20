// Client for the saved-routes API (worker/routes.js). All calls are
// same-origin (/api/routes…) and authenticated by the Better Auth session
// cookie, so there is nothing to configure here.
//
// Storage format: the in-memory `Route` (segments of [lat, lng]) is
// serialized as a GeoJSON Feature with a MultiLineString geometry — one
// line per drawn segment, so eraser gaps survive the round-trip — plus the
// display stats (`distanceM`, `ascentM`, `descentM`) in `properties`, so route lists
// can render without re-running the elevation pipeline.

import type { LatLng, Route } from '../types';
import { parseSnapshot, type ForecastSnapshot } from '../forecast/snapshot';

/** What the API stores in the `geometry` column. */
interface RouteFeature {
  type: 'Feature';
  properties: {
    distanceM: number | null;
    ascentM: number | null;
    /** Optional: absent in routes saved before descent was recorded. */
    descentM?: number | null;
  };
  geometry: {
    type: 'MultiLineString';
    /** GeoJSON position order: [lng, lat]. */
    coordinates: [number, number][][];
  };
}

/** A saved route as returned by the API, with the geometry parsed. */
export interface SavedRoute {
  id: string;
  name: string;
  description: string | null;
  route: Route;
  /** Route length in meters, as computed when it was saved. */
  distanceM: number | null;
  /** Total ascent in meters, as computed when it was saved. */
  ascentM: number | null;
  /** Total descent in meters (null for routes saved before it was recorded). */
  descentM: number | null;
  /** Whether the route is publicly shared. */
  isShared: boolean;
  /** The unguessable slug behind the public link, when shared (else null). */
  shareSlug: string | null;
  /**
   * Frozen snow/avalanche/weather data captured when the route was saved, so a
   * reopened or shared route shows the exact same numbers (and preserves the
   * weather forecast after it drops off MET's window). Null for routes saved
   * before the feature or with no computed profile.
   */
  forecast: ForecastSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface RouteStats {
  distanceM: number;
  ascentM: number;
  descentM: number;
}

export function routeToFeature(route: Route, stats: RouteStats | null): RouteFeature {
  return {
    type: 'Feature',
    properties: {
      distanceM: stats ? Math.round(stats.distanceM) : null,
      ascentM: stats ? Math.round(stats.ascentM) : null,
      descentM: stats ? Math.round(stats.descentM) : null,
    },
    geometry: {
      type: 'MultiLineString',
      coordinates: route.map((seg) => seg.map(([lat, lng]) => [lng, lat])),
    },
  };
}

function featureToRoute(feature: RouteFeature): Route {
  return feature.geometry.coordinates.map((line) =>
    line.map(([lng, lat]): LatLng => [lat, lng]),
  );
}

interface ApiRouteRow {
  id: string;
  name: string;
  description: string | null;
  geometry: string;
  forecast?: string | null;
  isShared?: boolean;
  shareSlug?: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseRow(row: ApiRouteRow): SavedRoute {
  let route: Route = [];
  let distanceM: number | null = null;
  let ascentM: number | null = null;
  let descentM: number | null = null;
  try {
    const feature = JSON.parse(row.geometry) as RouteFeature;
    route = featureToRoute(feature);
    distanceM = feature.properties?.distanceM ?? null;
    ascentM = feature.properties?.ascentM ?? null;
    descentM = feature.properties?.descentM ?? null;
  } catch {
    // A row with unreadable geometry still lists (name/date), it just
    // can't be opened as a drawn route.
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    route,
    distanceM,
    ascentM,
    descentM,
    isShared: row.isShared ?? false,
    shareSlug: row.shareSlug ?? null,
    forecast: parseSnapshot(row.forecast ?? null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

export async function listRoutes(): Promise<SavedRoute[]> {
  const data = await request<{ routes: ApiRouteRow[] }>('/api/routes');
  return data.routes.map(parseRow);
}

export async function createRoute(input: {
  name: string;
  description?: string;
  route: Route;
  stats: RouteStats | null;
  /** Frozen forecast snapshot to store alongside the route (optional). */
  forecast?: ForecastSnapshot | null;
}): Promise<SavedRoute> {
  const row = await request<ApiRouteRow>('/api/routes', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      geometry: routeToFeature(input.route, input.stats),
      forecast: input.forecast ?? null,
    }),
  });
  return parseRow(row);
}

export async function updateRoute(
  id: string,
  input: {
    name?: string;
    description?: string;
    route?: Route;
    stats?: RouteStats | null;
    /** Frozen forecast snapshot to (re)store; null clears it. */
    forecast?: ForecastSnapshot | null;
  },
): Promise<SavedRoute> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.description !== undefined) body.description = input.description;
  if (input.route !== undefined) {
    body.geometry = routeToFeature(input.route, input.stats ?? null);
  }
  if (input.forecast !== undefined) body.forecast = input.forecast;
  const row = await request<ApiRouteRow>(`/api/routes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return parseRow(row);
}

export async function deleteRoute(id: string): Promise<void> {
  await request<{ ok: true }>(`/api/routes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * Share or unshare a saved route. The server mints the share slug on the
 * first share and returns the updated route (with `isShared`/`shareSlug`),
 * so the caller can immediately build the public link.
 */
export async function setRouteShared(
  id: string,
  isShared: boolean,
): Promise<SavedRoute> {
  const row = await request<ApiRouteRow>(`/api/routes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ isShared }),
  });
  return parseRow(row);
}
