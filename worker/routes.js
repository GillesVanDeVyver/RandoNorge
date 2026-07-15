// Saved-routes API: CRUD for the "route" table created in migration 0001.
//
//   GET    /api/routes      → list the signed-in user's routes (newest first)
//   POST   /api/routes      → create { name, description?, geometry }
//   GET    /api/routes/:id  → one route (owner only)
//   PATCH  /api/routes/:id  → update any of { name, description, geometry }
//   DELETE /api/routes/:id  → delete (owner only)
//
// "geometry" is stored exactly as the client sends it: a stringified GeoJSON
// Feature whose geometry is a MultiLineString (one line per drawn segment,
// so eraser gaps survive a round-trip) and whose properties carry the
// precomputed stats the route lists display (distanceM, ascentM, descentM). The
// Worker validates shape and size but treats the coordinates as opaque.
//
// Every endpoint requires a Better Auth session cookie; ownership is
// enforced in SQL ("where id = ? and userId = ?") so a valid session for
// user A can never read or touch user B's routes. Sharing (isShared /
// shareSlug) is deliberately not exposed yet — routes are always private.

import { getAuth } from './auth.js';

// Generous but bounded: a full-day tour simplified at 8 m epsilon is a few
// kilobytes; 512 KB leaves room for very long traverses while keeping
// abusive payloads out of D1.
const MAX_GEOMETRY_BYTES = 512 * 1024;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;

export async function handleRoutesApi(request, env, url) {
  const session = await getAuth(env, url.origin).api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id) {
    return Response.json({ error: 'authentication required' }, { status: 401 });
  }
  const userId = session.user.id;

  // /api/routes or /api/routes/:id — anything deeper is a 404.
  const rest = url.pathname.slice('/api/routes'.length);
  const id = rest.startsWith('/') ? decodeURIComponent(rest.slice(1)) : null;
  if (id !== null && (id === '' || id.includes('/'))) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  try {
    if (id === null) {
      if (request.method === 'GET') return listRoutes(env, userId);
      if (request.method === 'POST') return createRoute(request, env, userId);
      return methodNotAllowed('GET, POST');
    }
    if (request.method === 'GET') return getRoute(env, userId, id);
    if (request.method === 'PATCH') return updateRoute(request, env, userId, id);
    if (request.method === 'DELETE') return deleteRoute(env, userId, id);
    return methodNotAllowed('GET, PATCH, DELETE');
  } catch (err) {
    console.error('routes api error:', err);
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
function toApiRoute(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    geometry: row.geometry,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function listRoutes(env, userId) {
  const { results } = await env.DB.prepare(
    'select id, name, description, geometry, "createdAt", "updatedAt" ' +
      'from "route" where "userId" = ? order by "updatedAt" desc',
  )
    .bind(userId)
    .all();
  return Response.json({ routes: results.map(toApiRoute) });
}

async function getRoute(env, userId, id) {
  const row = await env.DB.prepare(
    'select id, name, description, geometry, "createdAt", "updatedAt" ' +
      'from "route" where id = ? and "userId" = ?',
  )
    .bind(id, userId)
    .first();
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(toApiRoute(row));
}

async function createRoute(request, env, userId) {
  const body = await readJson(request);
  if (body === undefined) {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const name = validateName(body.name);
  if (name instanceof Response) return name;
  const description = validateDescription(body.description);
  if (description instanceof Response) return description;
  const geometry = validateGeometry(body.geometry);
  if (geometry instanceof Response) return geometry;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    'insert into "route" (id, "userId", name, description, geometry, "createdAt", "updatedAt") ' +
      'values (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, userId, name, description, geometry, now, now)
    .run();
  return Response.json(
    { id, name, description, geometry, createdAt: now, updatedAt: now },
    { status: 201 },
  );
}

async function updateRoute(request, env, userId, id) {
  const body = await readJson(request);
  if (body === undefined) {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const sets = [];
  const binds = [];
  if (body.name !== undefined) {
    const name = validateName(body.name);
    if (name instanceof Response) return name;
    sets.push('name = ?');
    binds.push(name);
  }
  if (body.description !== undefined) {
    const description = validateDescription(body.description);
    if (description instanceof Response) return description;
    sets.push('description = ?');
    binds.push(description);
  }
  if (body.geometry !== undefined) {
    const geometry = validateGeometry(body.geometry);
    if (geometry instanceof Response) return geometry;
    sets.push('geometry = ?');
    binds.push(geometry);
  }
  if (sets.length === 0) {
    return Response.json({ error: 'nothing to update' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `update "route" set ${sets.join(', ')}, "updatedAt" = ? ` +
      'where id = ? and "userId" = ?',
  )
    .bind(...binds, now, id, userId)
    .run();
  if (result.meta.changes === 0) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  return getRoute(env, userId, id);
}

async function deleteRoute(env, userId, id) {
  const result = await env.DB.prepare(
    'delete from "route" where id = ? and "userId" = ?',
  )
    .bind(id, userId)
    .run();
  if (result.meta.changes === 0) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  return Response.json({ ok: true });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
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

/** Returns the description (null when empty), or a 400 Response. */
function validateDescription(description) {
  if (description === undefined || description === null) return null;
  if (typeof description !== 'string') {
    return Response.json({ error: 'description must be a string' }, { status: 400 });
  }
  const trimmed = description.trim();
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    return Response.json(
      { error: `description too long (max ${MAX_DESCRIPTION_LENGTH} characters)` },
      { status: 400 },
    );
  }
  return trimmed || null;
}

/**
 * Validates the geometry payload (a GeoJSON Feature with a MultiLineString,
 * as produced by src/routes/api.ts) and returns it re-serialized, or a 400
 * Response. Coordinates are checked to be finite [lng, lat] pairs so junk
 * can't be persisted and crash the map on load.
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
  const clean = JSON.stringify({
    type: 'Feature',
    properties: {
      distanceM: Number.isFinite(props.distanceM) ? props.distanceM : null,
      ascentM: Number.isFinite(props.ascentM) ? props.ascentM : null,
      descentM: Number.isFinite(props.descentM) ? props.descentM : null,
    },
    geometry: { type: 'MultiLineString', coordinates: geom.coordinates },
  });
  if (clean.length > MAX_GEOMETRY_BYTES) return invalid('geometry too large');
  return clean;
}
