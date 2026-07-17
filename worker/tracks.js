// Recorded-tracks API: CRUD for the "track" table created in migration 0002.
//
//   GET    /api/tracks      → list the signed-in user's tracks (newest first)
//   POST   /api/tracks      → create { name, routeId?, geometry, startedAt, finishedAt }
//   GET    /api/tracks/:id  → one track (owner only)
//   DELETE /api/tracks/:id  → delete (owner only)
//
// "geometry" follows the same storage model as saved routes: a stringified
// GeoJSON Feature with a MultiLineString geometry (one line per
// uninterrupted recording stretch), precomputed display stats in
// properties (distanceM, ascentM, descentM, durationS, movingS,
// maxSpeedMps), and optional per-fix timestamps (properties.times, epoch
// ms, shaped like the coordinates). Coordinates are validated but
// otherwise treated as opaque.
//
// Every endpoint requires a Better Auth session cookie; ownership is
// enforced in SQL. A supplied routeId must reference one of the caller's
// own routes — otherwise the request is rejected, so tracks can't be
// attached to (or probe for) other users' plans.

import { getAuth } from './auth.js';

// Recorded tracks are denser than drawn routes (one point every few
// meters of GPS movement), so allow the same generous ceiling as routes.
const MAX_GEOMETRY_BYTES = 512 * 1024;
const MAX_NAME_LENGTH = 160;

export async function handleTracksApi(request, env, url) {
  const session = await getAuth(env, url.origin).api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id) {
    return Response.json({ error: 'authentication required' }, { status: 401 });
  }
  const userId = session.user.id;

  // /api/tracks or /api/tracks/:id — anything deeper is a 404.
  const rest = url.pathname.slice('/api/tracks'.length);
  const id = rest.startsWith('/') ? decodeURIComponent(rest.slice(1)) : null;
  if (id !== null && (id === '' || id.includes('/'))) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  try {
    if (id === null) {
      if (request.method === 'GET') return listTracks(env, userId);
      if (request.method === 'POST') return createTrack(request, env, userId);
      return methodNotAllowed('GET, POST');
    }
    if (request.method === 'GET') return getTrack(env, userId, id);
    if (request.method === 'DELETE') return deleteTrack(env, userId, id);
    return methodNotAllowed('GET, DELETE');
  } catch (err) {
    console.error('tracks api error:', err);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}

function methodNotAllowed(allow) {
  return Response.json(
    { error: 'method not allowed' },
    { status: 405, headers: { Allow: allow } },
  );
}

/** Row → API shape. The geometry string is passed through untouched. */
function toApiTrack(row) {
  return {
    id: row.id,
    routeId: row.routeId ?? null,
    name: row.name,
    geometry: row.geometry,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

async function listTracks(env, userId) {
  const { results } = await env.DB.prepare(
    'select id, "routeId", name, geometry, "startedAt", "finishedAt", "createdAt" ' +
      'from "track" where "userId" = ? order by "finishedAt" desc',
  )
    .bind(userId)
    .all();
  return Response.json({ tracks: results.map(toApiTrack) });
}

async function getTrack(env, userId, id) {
  const row = await env.DB.prepare(
    'select id, "routeId", name, geometry, "startedAt", "finishedAt", "createdAt" ' +
      'from "track" where id = ? and "userId" = ?',
  )
    .bind(id, userId)
    .first();
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(toApiTrack(row));
}

async function createTrack(request, env, userId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const name = validateName(body.name);
  if (name instanceof Response) return name;
  const geometry = validateGeometry(body.geometry);
  if (geometry instanceof Response) return geometry;
  const startedAt = validateTimestamp(body.startedAt, 'startedAt');
  if (startedAt instanceof Response) return startedAt;
  const finishedAt = validateTimestamp(body.finishedAt, 'finishedAt');
  if (finishedAt instanceof Response) return finishedAt;

  // Optional link to the planned route this track navigated. Must belong
  // to the caller; an unknown/foreign id is a client error rather than
  // being silently dropped.
  let routeId = null;
  if (body.routeId !== undefined && body.routeId !== null) {
    if (typeof body.routeId !== 'string' || !body.routeId) {
      return Response.json({ error: 'routeId must be a string' }, { status: 400 });
    }
    const owned = await env.DB.prepare(
      'select 1 from "route" where id = ? and "userId" = ?',
    )
      .bind(body.routeId, userId)
      .first();
    if (!owned) {
      return Response.json({ error: 'route not found' }, { status: 400 });
    }
    routeId = body.routeId;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    'insert into "track" (id, "userId", "routeId", name, geometry, "startedAt", "finishedAt", "createdAt") ' +
      'values (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, userId, routeId, name, geometry, startedAt, finishedAt, now)
    .run();
  return Response.json(
    { id, routeId, name, geometry, startedAt, finishedAt, createdAt: now },
    { status: 201 },
  );
}

async function deleteTrack(env, userId, id) {
  const result = await env.DB.prepare(
    'delete from "track" where id = ? and "userId" = ?',
  )
    .bind(id, userId)
    .run();
  if (result.meta.changes === 0) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  return Response.json({ ok: true });
}

/** Returns the trimmed name, or a 400 Response. */
function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'name required' }, { status: 400 });
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME_LENGTH) {
    return Response.json(
      { error: `name too long (max ${MAX_NAME_LENGTH} characters)` },
      { status: 400 },
    );
  }
  return trimmed;
}

/** Returns a normalized ISO timestamp string, or a 400 Response. */
function validateTimestamp(value, field) {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    return Response.json(
      { error: `${field} must be an ISO timestamp` },
      { status: 400 },
    );
  }
  return new Date(value).toISOString();
}

/**
 * Validates the geometry payload (a GeoJSON Feature with a MultiLineString,
 * as produced by src/tracking/api.ts) and returns it re-serialized, or a
 * 400 Response. Same rules as saved routes, plus the track-specific
 * durationS property.
 */
function validateGeometry(geometry) {
  const invalid = (msg) => Response.json({ error: msg }, { status: 400 });
  let feature = geometry;
  if (typeof feature === 'string') {
    if (feature.length > MAX_GEOMETRY_BYTES) return invalid('geometry too large');
    try {
      feature = JSON.parse(feature);
    } catch {
      return invalid('geometry is not valid JSON');
    }
  }
  if (typeof feature !== 'object' || feature === null || feature.type !== 'Feature') {
    return invalid('geometry must be a GeoJSON Feature');
  }
  const geom = feature.geometry;
  if (
    typeof geom !== 'object' ||
    geom === null ||
    geom.type !== 'MultiLineString' ||
    !Array.isArray(geom.coordinates) ||
    geom.coordinates.length === 0
  ) {
    return invalid('geometry must contain a non-empty MultiLineString');
  }
  for (const line of geom.coordinates) {
    if (!Array.isArray(line) || line.length < 2) {
      return invalid('each line needs at least two positions');
    }
    for (const pos of line) {
      if (
        !Array.isArray(pos) ||
        pos.length !== 2 ||
        !Number.isFinite(pos[0]) ||
        !Number.isFinite(pos[1]) ||
        pos[0] < -180 ||
        pos[0] > 180 ||
        pos[1] < -90 ||
        pos[1] > 90
      ) {
        return invalid('positions must be finite [lng, lat] pairs');
      }
    }
  }
  // Only keep the fields the app understands; drops any extra payload.
  const props = typeof feature.properties === 'object' && feature.properties !== null
    ? feature.properties
    : {};
  // Per-fix timestamps (epoch ms), shaped exactly like the coordinates.
  // Anything malformed or misaligned is dropped to null rather than
  // rejected — the track itself is still perfectly valid without timing.
  let times = null;
  if (
    Array.isArray(props.times) &&
    props.times.length === geom.coordinates.length &&
    props.times.every(
      (line, i) =>
        Array.isArray(line) &&
        line.length === geom.coordinates[i].length &&
        line.every((t) => Number.isFinite(t)),
    )
  ) {
    times = props.times;
  }
  const clean = JSON.stringify({
    type: 'Feature',
    properties: {
      distanceM: Number.isFinite(props.distanceM) ? props.distanceM : null,
      ascentM: Number.isFinite(props.ascentM) ? props.ascentM : null,
      descentM: Number.isFinite(props.descentM) ? props.descentM : null,
      durationS: Number.isFinite(props.durationS) ? props.durationS : null,
      movingS: Number.isFinite(props.movingS) ? props.movingS : null,
      maxSpeedMps: Number.isFinite(props.maxSpeedMps) ? props.maxSpeedMps : null,
      times,
    },
    geometry: { type: 'MultiLineString', coordinates: geom.coordinates },
  });
  if (clean.length > MAX_GEOMETRY_BYTES) return invalid('geometry too large');
  return clean;
}
