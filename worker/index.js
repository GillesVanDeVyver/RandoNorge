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
import { handlePublicApi } from './public.js';
import { handleUsernameApi } from './username.js';
import { handleTerrainTile } from './terrain.js';
import { withSecurityHeaders } from './securityHeaders.js';
import { rateLimit, clientIp } from './rateLimit.js';

const ROUTES = [
  // `allow` pins each proxy to the exact upstream path prefix the app uses,
  // so these routes can't be abused as an open relay / cache-filler against
  // the whole upstream host. Extend a list if the app calls a new path.
  {
    prefix: '/metno-api',
    upstream: 'https://api.met.no',
    ttl: 1800,
    allow: ['/weatherapi/locationforecast/'],
  },
  {
    prefix: '/gts-api',
    upstream: 'https://gts.nve.no/api',
    ttl: 21600,
    allow: ['/GridTimeSeries'],
  },
  {
    prefix: '/varsom-api',
    upstream: 'https://api01.nve.no',
    ttl: 3600,
    allow: ['/hydrology/forecast/avalanche/'],
  },
];

export default {
  async fetch(request, env, ctx) {
    // Every response leaves through this one wrapper, so the security headers
    // (worker/securityHeaders.js) are applied uniformly to the API, the
    // proxies, terrain tiles and the served SPA alike.
    const response = await handleRequest(request, env, ctx);
    return withSecurityHeaders(response);
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

async function handleRequest(request, env, ctx) {
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
    // both). This makes account enumeration possible by design, so it is
    // rate limited per IP (worker/rateLimit.js) to stop it being scripted
    // into a bulk membership check against a list of addresses.
    if (pathname === '/api/account-exists' && request.method === 'POST') {
      const { allowed, resetAt } = await rateLimit(
        env,
        `account-exists:${clientIp(request)}`,
        20,
        300,
      );
      if (!allowed) {
        const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
        return Response.json(
          { error: 'too many requests' },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } },
        );
      }
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

    // The signed-in user's public handle (worker/username.js).
    if (pathname === '/api/me/username') {
      return handleUsernameApi(request, env, url);
    }

    // Anonymous, read-only access to shared routes/tracks and public
    // profiles (worker/public.js). No session required.
    if (pathname.startsWith('/api/public/')) {
      return handlePublicApi(request, env, url);
    }

    // Terrain-DEM tiles for the 3D view: own Kartverket-derived tiles from
    // R2 with AWS Terrarium fallback (worker/terrain.js).
    if (pathname.startsWith('/terrain-dem/')) {
      const res = await handleTerrainTile(request, env, ctx);
      if (res) return res;
    }

    for (const { prefix, upstream, ttl, allow } of ROUTES) {
      if (pathname === prefix || pathname.startsWith(prefix + '/')) {
        return proxyGet(request, ctx, prefix, upstream, ttl, allow);
      }
    }

    // Everything else falls through to the static app (SPA handling is
    // configured in wrangler.jsonc).
    return env.ASSETS.fetch(request);
}

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
