// Cloudflare Worker entry point. Static assets (the Vite build in dist/)
// are served automatically by the assets binding before this code runs;
// the Worker handles the auth API (/api/auth/*, see worker/auth.js) plus
// the API proxy routes that the app needs in production — the same
// paths the Vite dev server proxies locally (see vite.config.ts).
//
//   /metno-api/*  → https://api.met.no/*      (User-Agent required by ToS)
//   /gts-api/*    → https://gts.nve.no/api/*  (no CORS upstream)
//   /varsom-api/* → https://api01.nve.no/*    (no CORS upstream)
//   /nvdb-api/*   → https://nvdbapiles.atlas.vegvesen.no/*
//                   (identifying headers, see NVDB_HEADERS in proxy.js)
//
// Cache lifetimes are matched to how each dataset updates: MET forecast
// model runs are roughly hourly (30 min), the seNorge snow grid is a daily
// product (6 h), Varsom warnings are daily with occasional intraday
// updates (1 h), and NVDB parking areas are civil infrastructure that
// changes over years rather than hours (24 h, and that is conservative).
import { proxyGet, NVDB_HEADERS } from './proxy.js';
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
import { handlePoliciesApi } from './policies.js';
import { handleAccountApi } from './account.js';
import { handleFeedbackApi } from './feedback.js';
import { handleTerrainTile } from './terrain.js';
import { resolveDocument } from './knownPaths.js';
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
  {
    // Statens vegvesen's Nasjonal vegdatabank. Only vegobjekttype 43
    // (Parkeringsområde) is allowed through: NVDB exposes hundreds of object
    // types and the whole datakatalog, and an open relay onto that would be a
    // generous gift to someone else's scraper at our edge cache's expense.
    //
    // NVDB's own guidelines prefer live querying over bulk download, so unlike
    // most sources in docs/parking-data-sources.md this one is queried per
    // request rather than pre-built into a table. The 24 h edge cache keeps us
    // far inside their documented 40 req/s ceiling.
    prefix: '/nvdb-api',
    upstream: 'https://nvdbapiles.atlas.vegvesen.no',
    ttl: 86400,
    allow: ['/vegobjekter/api/v4/vegobjekter/43'],
    headers: NVDB_HEADERS,
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
  // address and user agent and must not accumulate forever, expired
  // verification tokens have no purpose after their expiry, and spent
  // rate-limit buckets are keyed by IP with nothing left to enforce. Better
  // Auth expires sessions logically but does not purge the rows from D1, so
  // we do it here. The privacy policy (src/terms/privacy.ts §5) promises this
  // cleanup — keep both in sync.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(purgeExpiredRows(env));
  },
};

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;

    // Closed-alpha public face: a bare visit to the site root shows the
    // static holding page (public/coming-soon.html) instead of the app's
    // login screen. The real app lives at /alpha/ — see src/appBase.ts — and
    // that path, its deep links (/alpha/planner…) and the public share URLs
    // (/u/…) all fall through to the SPA below; this only changes what the
    // domain root itself serves. Requires "/" in run_worker_first
    // (wrangler.jsonc) so the Worker beats the assets SPA fallback here.
    //
    // THE FRONTEND MUST AGREE ABOUT THIS. Taking the root away from the app
    // does not, on its own, stop the app navigating to it: until 2026-07-29
    // the SPA still used "/" as its home and every auth callback still
    // returned there, so accepting the terms at sign-up landed the new tester
    // on "Kommer snart". The base declared in src/appBase.ts is what keeps the
    // two halves in step — change one and change the other. To make the app
    // public again: delete this block, drop the "/" entry in wrangler.jsonc,
    // and set APP_BASE to '' in src/appBase.ts.
    //
    // That page is deliberately almost empty, and is therefore *not* the URL
    // to declare as the application home page on Google's OAuth consent
    // screen — that is public/about.html, which ASSETS serves directly and so
    // needs no branch here. See the comment at the top of either file.
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
      return runAuthHandler(env, url, request);
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

    // Which version of the terms / privacy policy this account accepted, and
    // re-acceptance after a version bump (worker/policies.js). Backs the
    // promise in privacy policy §8.
    if (pathname === '/api/me/policies') {
      return handlePoliciesApi(request, env, url);
    }

    // Self-service account deletion, GDPR art. 17 (worker/account.js).
    // Requires the caller's own email as confirmation, plus their password
    // when the account has one.
    if (pathname === '/api/account') {
      return handleAccountApi(request, env, url);
    }

    // In-app feedback: stored in D1 and emailed on to FEEDBACK_TO
    // (worker/feedback.js). Signed-in only, and rate limited there.
    if (pathname === '/api/feedback') {
      return handleFeedbackApi(request, env, url);
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

    for (const { prefix, upstream, ttl, allow, headers } of ROUTES) {
      if (pathname === prefix || pathname.startsWith(prefix + '/')) {
        return proxyGet(request, ctx, prefix, upstream, ttl, allow, headers);
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
        return notFound();
      }
      return asset;
    }

    // Everything left is a request for a document or a file. Decide whether
    // this site actually has a URL by that name BEFORE the assets binding gets
    // a chance to answer, because its answer for a path it doesn't recognise is
    // the SPA fallback — dist/index.html, HTTP 200. That is how
    // https://fjellrute.no/xx came to serve the closed alpha's login screen to
    // anyone who mistyped the domain or scanned it. worker/knownPaths.js holds
    // the allowlist and the reasoning; this is only the enforcement.
    //
    // Nothing above this line is affected: the API, the proxies, the terrain
    // tiles and the hashed bundles have all already returned.
    const resolved = resolveDocument(pathname);
    if (resolved.kind === 'redirect') {
      // Only a navigation is redirected. A POST or PUT to a path that doesn't
      // exist is not a user who mistyped a URL, and answering it with "go look
      // at the front page" would be a lie about what happened — say 404.
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return notFound();
      }
      // 302, not 301: the alpha's URL space is still moving (when APP_BASE goes
      // away, several of these paths become real pages again), and a permanent
      // redirect is cached by browsers indefinitely and would outlive the
      // arrangement that justified it.
      //
      // Resolved against the request's own origin rather than hard-coded to
      // https://fjellrute.no, so preview deployments and `wrangler dev`
      // redirect to themselves instead of bouncing a developer to production.
      return new Response(null, {
        status: 302,
        headers: {
          Location: new URL(resolved.to, url).toString(),
          // The destination is a different page for every branch of the
          // allowlist and the allowlist changes with the deploy; caching the
          // hop buys nothing and outlives its reason.
          'Cache-Control': 'no-store',
        },
      });
    }

    // A URL the site owns: hand back what the assets binding has for it. The
    // HTML shell must be revalidated on every navigation so a returning visitor
    // always resolves the latest asset hashes — a browser-cached index.html is
    // exactly what leaves users requesting deleted bundles above. Only the HTML
    // shell is marked no-cache; the hashed assets it references stay immutably
    // cacheable.
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      if (resolved.kind === 'file') {
        // Something with a file extension that isn't there. The SPA fallback
        // just answered it with index.html, which is the same trap as a deleted
        // hashed bundle: the browser asked for an image or a script and is
        // handed HTML, so the load fails with no useful error. Make it a 404.
        return notFound();
      }
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

/** A plain-text 404. text/plain on purpose: every caller here is a request for
 *  something that is missing rather than something to read, and an HTML body
 *  is what the callers are trying to avoid handing back. */
function notFound() {
  return new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Delete expired "session" and "verification" rows. Better Auth's kysely
 * adapter has stored datetimes both as ISO-8601 strings and as epoch
 * milliseconds depending on version, so compare in whichever form the row
 * actually uses (typeof() is SQLite-native).
 *
 * The two rate-limit tables (migration 0005) are purged here too. Their keys
 * embed the client IP verbatim — `account-exists:<ip>`, `invite-signup:<ip>`
 * and Better Auth's own per-route keys — so a spent bucket is an IP log with
 * no remaining purpose, exactly the storage-limitation problem (GDPR art.
 * 5(1)(e)) this job exists to prevent for sessions.
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
  const [sessions, verifications, appBuckets, authBuckets] =
    await env.DB.batch([
      expired('session'),
      expired('verification'),
      // Our own limiter (worker/rateLimit.js) stores the window end as epoch
      // ms in "resetAt"; once it has passed the row can never allow or deny
      // anything again. Indexed by "app_rate_limit_resetAt_idx".
      env.DB.prepare(`delete from "app_rate_limit" where "resetAt" < ?1`).bind(
        nowMs,
      ),
      // Better Auth's store has no expiry column — only "lastRequest" (epoch
      // ms). Its longest configured window is 3600 s (worker/auth.js), so a
      // bucket untouched for 24 h is far outside every window and dropping it
      // cannot loosen a limit for anyone still being throttled.
      env.DB.prepare(`delete from "rateLimit" where "lastRequest" < ?1`).bind(
        nowMs - 24 * 60 * 60 * 1000,
      ),
    ]);
  console.log(
    `retention cleanup: ${sessions.meta.changes} expired sessions, ` +
      `${verifications.meta.changes} expired verification tokens, ` +
      `${appBuckets.meta.changes} app rate-limit buckets, ` +
      `${authBuckets.meta.changes} auth rate-limit buckets deleted`,
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
    return runAuthHandler(env, url, rebuildJsonRequest(request, raw));
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
  const authResponse = await runAuthHandler(
    env,
    url,
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
 * Run a request through Better Auth, guaranteeing a readable response.
 *
 * Better Auth's router (better-call) answers an error it doesn't recognise —
 * anything that isn't one of its own APIErrors — with `new Response(null,
 * { status: 500 })`: no body at all. The auth client can't parse that, so it
 * reports only "something went wrong", and the form shows its catch-all
 * message. Two separate week-long outages were diagnosed slowly for exactly
 * this reason: the one signal that would have named the cause never left the
 * server. Most recently that was a PBKDF2 iteration count the platform refuses
 * (worker/password.js), which is not the kind of thing anyone guesses from
 * "could not create the account".
 *
 * `onAPIError.throw` (worker/auth.js) makes those unrecognised errors propagate
 * here instead of becoming that empty 500 — Better Auth's real APIErrors are
 * still converted to their proper responses inside the router and never reach
 * this catch. So this turns the one unreadable outcome into a logged line and
 * a JSON body shaped like every other error the client already understands.
 *
 * The message stays generic on purpose: the detail goes to the log
 * (`wrangler tail`), not to whoever is posting to the endpoint.
 */
async function runAuthHandler(env, url, request) {
  try {
    return await getAuth(env, url.origin).handler(request);
  } catch (err) {
    console.error(
      `auth handler failed for ${request.method} ${url.pathname}:`,
      err,
    );
    return Response.json(
      {
        message: 'Something went wrong on our side. Please try again shortly.',
        code: 'AUTH_INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
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
