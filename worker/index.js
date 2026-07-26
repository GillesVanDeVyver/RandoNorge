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
import {
  normalizeInviteCode,
  validateInviteCode,
  redeemInviteCode,
} from './invite.js';
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

    // Closed-alpha public face: a bare visit to the site root shows the
    // static "coming soon" page (public/coming-soon.html) instead of the
    // app's login screen. The real app stays reachable for testers at
    // /alpha/ and via its own deep links / public share URLs (/u/…), which
    // still fall through to the SPA below — this only changes what the
    // domain root itself serves. Requires "/" in run_worker_first
    // (wrangler.jsonc) so the Worker beats the assets SPA fallback here.
    // Remove this block (and the "/" entry) to make the app public again.
    if (pathname === '/') {
      const landing = await env.ASSETS.fetch(
        new Request(new URL('/coming-soon.html', url)),
      );
      // Serve it as the 200 response for "/" (ASSETS would otherwise answer
      // the bare path with the SPA's index.html via not_found_handling).
      return new Response(landing.body, {
        status: 200,
        headers: landing.headers,
      });
    }

    // Closed-alpha gate: email/password sign-up must carry a valid invite
    // code (migration 0006, worker/invite.js). We check the code here and
    // only forward the request to Better Auth's real sign-up flow when it
    // passes, so that flow is exercised for real — the code just decides who
    // gets in. Everything else under /api/auth/* (sign-in, social sign-up,
    // verification, reset) is untouched. Delete this block to open public
    // sign-ups.
    if (pathname === '/api/auth/sign-up/email' && request.method === 'POST') {
      return gatedEmailSignUp(request, env, url, ctx);
    }

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

    // Content-hashed build assets (/assets/index-<hash>.js|css). These are
    // immutable, so a request for one that no longer exists can only be a
    // stale index.html from a previous deploy pointing at a deleted bundle.
    // The SPA not_found_handling (wrangler.jsonc) would answer that miss with
    // index.html — HTTP 200, text/html — and the browser then tries to run
    // HTML as a module script, throws a syntax error, and renders a blank
    // page. Force a real 404 for a missing hashed asset instead, so the load
    // fails loudly and a reload (which revalidates the no-cache index.html
    // below and picks up the current bundle) recovers cleanly. Existing
    // assets keep their immutable Cache-Control untouched.
    if (pathname.startsWith('/assets/')) {
      const asset = await env.ASSETS.fetch(request);
      const type = asset.headers.get('content-type') || '';
      if (type.includes('text/html')) {
        return new Response('Not Found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      return asset;
    }

    // Everything else falls through to the static app (SPA handling is
    // configured in wrangler.jsonc). The HTML shell must be revalidated on
    // every navigation so a returning visitor always resolves the latest
    // asset hashes — a browser-cached index.html is exactly what leaves users
    // requesting deleted bundles above. Only the HTML shell is marked
    // no-cache; the hashed assets it references stay immutably cacheable.
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-cache');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
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

/**
 * Invite-code gate in front of Better Auth's email/password sign-up.
 *
 * Flow: read the JSON body once, pull out `inviteCode`, and validate it. If
 * it's missing/invalid, reject with 403 before any account work happens. If
 * it's valid, rebuild the request for Better Auth with the `inviteCode` field
 * stripped (it isn't part of Better Auth's schema) and hand it off. Only when
 * Better Auth answers 2xx do we consume one use of the code and log the
 * redemption — a failed sign-up (taken username, weak password…) leaves the
 * code untouched.
 *
 * Note: with email verification on, Better Auth returns a deliberate fake
 * 2xx for an already-registered address (anti-enumeration), so in principle a
 * duplicate sign-up could still spend a use. The client checks
 * /api/account-exists before calling this, so it's a rare edge; a shared code
 * with room to spare (max_uses) absorbs it.
 */
async function gatedEmailSignUp(request, env, url, ctx) {
  const denied = (reason) =>
    Response.json(
      {
        // Better Auth's client surfaces `message`; `code` lets the form show
        // the right localized text and attach it to the invite field.
        message:
          reason === 'missing'
            ? 'An invite code is required during the alpha.'
            : 'That invite code is not valid.',
        code: 'INVALID_INVITE_CODE',
      },
      { status: 403 },
    );

  // Any failure talking to D1 while gating (e.g. the invite_code table hasn't
  // been migrated on this database yet) must surface as a clean, localizable
  // error — not a raw text/plain 500, which the client can't parse and so
  // shows as the useless generic "could not create the account". 503 keeps it
  // distinct from a real sign-up failure and signals "try again later".
  const unavailable = () =>
    Response.json(
      {
        message: 'Sign-ups are temporarily unavailable. Please try again shortly.',
        code: 'SIGNUP_UNAVAILABLE',
      },
      { status: 503 },
    );

  // Throttle per IP. An invalid code is rejected here *before* it reaches
  // Better Auth, so Better Auth's own sign-up limiter never sees guessing
  // attempts — this is what stops a code being brute-forced. The cap is loose
  // enough for real users retrying a typo.
  const { allowed, resetAt } = await rateLimit(
    env,
    `invite-signup:${clientIp(request)}`,
    15,
    3600,
  );
  if (!allowed) {
    const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    return Response.json(
      { message: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  // Read the body once; we have to rebuild the request for Better Auth anyway.
  let raw;
  try {
    raw = await request.text();
  } catch {
    return denied('missing');
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    // Malformed body — let Better Auth produce its normal validation error
    // rather than masking it as an invite problem.
    return getAuth(env, url.origin).handler(rebuildJsonRequest(request, raw));
  }

  const code = normalizeInviteCode(body?.inviteCode);
  let check;
  try {
    check = await validateInviteCode(env, code);
  } catch (err) {
    console.error('invite validation failed', err);
    return unavailable();
  }
  if (!check.ok) return denied(check.reason);

  // Forward to Better Auth without the extra field.
  const { inviteCode: _drop, ...forwarded } = body;
  const authResponse = await getAuth(env, url.origin).handler(
    rebuildJsonRequest(request, JSON.stringify(forwarded)),
  );

  // Consume a use only on a real success. Do it in the background so the
  // user isn't blocked on the extra writes, but keep the isolate alive for
  // them with waitUntil.
  if (authResponse.ok) {
    const email = typeof body?.email === 'string' ? body.email : '';
    // The account is already created; if the bookkeeping write fails, log it
    // but never let it reject unhandled — the user's sign-up still succeeded.
    ctx.waitUntil(
      redeemInviteCode(env, code, email).catch((err) =>
        console.error('invite redemption failed', err),
      ),
    );
  }
  return authResponse;
}

/**
 * Clone a request with a replaced JSON body. The original Content-Length must
 * NOT be carried over: we replace the body (the inviteCode field is stripped,
 * so it's shorter), and a stale, too-large Content-Length makes the runtime
 * wait for bytes that never arrive — Better Auth's request.json() then hangs
 * and the sign-up never returns (the form sits on "one moment…"). Dropping it
 * lets the runtime set the correct length; Origin, Cookie, Content-Type and
 * the CF-* headers Better Auth needs (trusted origin, client IP) are kept.
 */
function rebuildJsonRequest(request, bodyText) {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: bodyText,
  });
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
