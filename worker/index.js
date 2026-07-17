// Cloudflare Worker entry point. Static assets (the Vite build in dist/)
// are served automatically by the assets binding before this code runs;
// the Worker handles the auth API (/api/auth/*, see worker/auth.js) plus
// the three API proxy routes that the app needs in production — the same
// paths the Vite dev server proxies locally (see vite.config.ts).
//
//   /metno-api/*  → https://api.met.no/*      (User-Agent required by ToS)
//   /gts-api/*    → https://gts.nve.no/api/*  (no CORS upstream)
//   /varsom-api/* → https://api01.nve.no/*    (no CORS upstream)
//
// Cache lifetimes are matched to how each dataset updates: MET forecast
// model runs are roughly hourly (30 min), the seNorge snow grid is a daily
// product (6 h), Varsom warnings are daily with occasional intraday
// updates (1 h).
import { proxyGet } from './proxy.js';
import { getAuth } from './auth.js';
import { handleRoutesApi } from './routes.js';
import { handleTracksApi } from './tracks.js';
import { handleTerrainTile } from './terrain.js';

const ROUTES = [
  { prefix: '/metno-api', upstream: 'https://api.met.no', ttl: 1800 },
  { prefix: '/gts-api', upstream: 'https://gts.nve.no/api', ttl: 21600 },
  { prefix: '/varsom-api', upstream: 'https://api01.nve.no', ttl: 3600 },
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Authentication (Better Auth): sign-up, sign-in, sign-out, session,
    // email verification and password reset all live under /api/auth/*.
    if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
      return getAuth(env, url.origin).handler(request);
    }

    // Tells the login form whether an account exists for an email address,
    // so it can show "user not found" vs "wrong password" after a failed
    // sign-in (Better Auth itself deliberately returns the same 401 for
    // both). Note: this makes account enumeration possible by design.
    if (pathname === '/api/account-exists' && request.method === 'POST') {
      return accountExists(request, env);
    }

    // Saved routes: authenticated CRUD against the "route" table
    // (worker/routes.js).
    if (pathname === '/api/routes' || pathname.startsWith('/api/routes/')) {
      return handleRoutesApi(request, env, url);
    }

    // Recorded tracks ("actual routes" from navigation mode): authenticated
    // CRUD against the "track" table (worker/tracks.js).
    if (pathname === '/api/tracks' || pathname.startsWith('/api/tracks/')) {
      return handleTracksApi(request, env, url);
    }

    // Terrain-DEM tiles for the 3D view: own Kartverket-derived tiles from
    // R2 with AWS Terrarium fallback (worker/terrain.js).
    if (pathname.startsWith('/terrain-dem/')) {
      const res = await handleTerrainTile(request, env, ctx);
      if (res) return res;
    }

    for (const { prefix, upstream, ttl } of ROUTES) {
      if (pathname === prefix || pathname.startsWith(prefix + '/')) {
        return proxyGet(request, ctx, prefix, upstream, ttl);
      }
    }

    // Everything else falls through to the static app (SPA handling is
    // configured in wrangler.jsonc).
    return env.ASSETS.fetch(request);
  },

  // Daily data-retention cleanup (cron in wrangler.jsonc). GDPR storage
  // limitation (art. 5(1)(e)): expired session rows contain the user's IP
  // address and user agent and must not accumulate forever, and expired
  // verification tokens have no purpose after their expiry. Better Auth
  // expires sessions logically but does not purge the rows from D1, so we
  // do it here. The privacy policy (src/terms/privacy.ts §5) promises this
  // cleanup — keep both in sync.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(purgeExpiredRows(env));
  },
};

/**
 * Delete expired "session" and "verification" rows. Better Auth's kysely
 * adapter has stored datetimes both as ISO-8601 strings and as epoch
 * milliseconds depending on version, so compare in whichever form the row
 * actually uses (typeof() is SQLite-native).
 */
async function purgeExpiredRows(env) {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const expired = (table) =>
    env.DB.prepare(
      `delete from "${table}" where (case
         when typeof("expiresAt") = 'text' then "expiresAt" < ?1
         else "expiresAt" < ?2
       end)`,
    ).bind(nowIso, nowMs);
  const [sessions, verifications] = await env.DB.batch([
    expired('session'),
    expired('verification'),
  ]);
  console.log(
    `retention cleanup: ${sessions.meta.changes} expired sessions, ` +
      `${verifications.meta.changes} expired verification tokens deleted`,
  );
}

/** POST { email } → { exists: boolean }. Backs the login form's
 *  "user not found" / "wrong password" distinction. */
async function accountExists(request, env) {
  let email;
  try {
    ({ email } = await request.json());
  } catch {
    // Malformed/missing JSON body; handled by the type check below.
  }
  if (typeof email !== 'string' || !email.trim()) {
    return Response.json({ error: 'email required' }, { status: 400 });
  }
  const row = await env.DB.prepare(
    'select 1 from "user" where lower(email) = lower(?) limit 1',
  )
    .bind(email.trim())
    .first();
  return Response.json({ exists: row !== null });
}
