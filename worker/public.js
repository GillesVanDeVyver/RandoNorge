// Anonymous, read-only access to shared routes/tracks and public profiles.
//
//   GET /api/public/route/:slug     → one shared planned route + its owner
//   GET /api/public/track/:slug     → one shared completed tour + its owner
//   GET /api/public/profile/:name   → an account's public library (by username)
//
// No session is required or consulted: everything here is deliberately
// world-readable. The gate is the data itself — only rows with isShared = 1
// are ever returned, and only the owner's public display fields (name +
// username) travel alongside; the email address never does.
//
// A shared *track* may reference a planned route; that plan's geometry is
// only included when the plan is itself shared, so making a tour public
// never leaks a route the owner kept private.

const MAX_LIST = 200; // guard the profile query; a hobby account won't hit it.

export async function handlePublicApi(request, env, url) {
  if (request.method !== 'GET') {
    return Response.json(
      { error: 'method not allowed' },
      { status: 405, headers: { Allow: 'GET' } },
    );
  }

  const rest = url.pathname.slice('/api/public/'.length);
  const [kind, rawKey] = rest.split('/');
  const key = rawKey ? decodeURIComponent(rawKey) : '';
  if (!key || rawKey.includes('/')) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  try {
    if (kind === 'route') return getPublicRoute(env, key);
    if (kind === 'track') return getPublicTrack(env, key);
    if (kind === 'profile') return getPublicProfile(env, key);
    return Response.json({ error: 'not found' }, { status: 404 });
  } catch (err) {
    console.error('public api error:', err);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}

/** Cache shared reads at the edge: the content is public and changes rarely,
 *  and this keeps a viral link from hammering D1. */
const publicJson = (data) =>
  Response.json(data, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });

async function getPublicRoute(env, slug) {
  const row = await env.DB.prepare(
    'select r.name, r.description, r.geometry, r."createdAt", r."updatedAt", ' +
      'u.name as "ownerName", u.username as "ownerUsername" ' +
      'from "route" r join "user" u on u.id = r."userId" ' +
      'where r."shareSlug" = ? and r."isShared" = 1',
  )
    .bind(slug)
    .first();
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });
  return publicJson({
    name: row.name,
    description: row.description ?? null,
    geometry: row.geometry,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    owner: { name: row.ownerName, username: row.ownerUsername ?? null },
  });
}

async function getPublicTrack(env, slug) {
  const row = await env.DB.prepare(
    'select t.name, t.geometry, t."routeId", t."startedAt", t."finishedAt", ' +
      't."createdAt", u.name as "ownerName", u.username as "ownerUsername" ' +
      'from "track" t join "user" u on u.id = t."userId" ' +
      'where t."shareSlug" = ? and t."isShared" = 1',
  )
    .bind(slug)
    .first();
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });

  // The planned route this tour navigated — only if it, too, is public.
  let planned = null;
  if (row.routeId) {
    const plan = await env.DB.prepare(
      'select name, geometry from "route" where id = ? and "isShared" = 1',
    )
      .bind(row.routeId)
      .first();
    if (plan) planned = { name: plan.name, geometry: plan.geometry };
  }

  return publicJson({
    name: row.name,
    geometry: row.geometry,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    planned,
    owner: { name: row.ownerName, username: row.ownerUsername ?? null },
  });
}

async function getPublicProfile(env, username) {
  const user = await env.DB.prepare(
    'select id, name, username from "user" where lower(username) = lower(?)',
  )
    .bind(username)
    .first();
  if (!user) return Response.json({ error: 'not found' }, { status: 404 });

  const [routes, tracks] = await Promise.all([
    env.DB.prepare(
      'select "shareSlug", name, description, geometry, "createdAt", "updatedAt" ' +
        'from "route" where "userId" = ? and "isShared" = 1 ' +
        'order by "updatedAt" desc limit ?',
    )
      .bind(user.id, MAX_LIST)
      .all(),
    env.DB.prepare(
      'select "shareSlug", name, geometry, "startedAt", "finishedAt" ' +
        'from "track" where "userId" = ? and "isShared" = 1 ' +
        'order by "finishedAt" desc limit ?',
    )
      .bind(user.id, MAX_LIST)
      .all(),
  ]);

  return publicJson({
    owner: { name: user.name, username: user.username },
    routes: routes.results.map((r) => ({
      shareSlug: r.shareSlug,
      name: r.name,
      description: r.description ?? null,
      geometry: r.geometry,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    tracks: tracks.results.map((t) => ({
      shareSlug: t.shareSlug,
      name: t.name,
      geometry: t.geometry,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
    })),
  });
}
