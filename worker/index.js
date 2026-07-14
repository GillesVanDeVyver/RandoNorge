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

    // Tells the account overview whether the signed-in user is visiting
    // for the first time since registering (their current session is the
    // earliest one on record), so it can greet with "Welcome" instead of
    // "Welcome back".
    if (pathname === '/api/first-visit' && request.method === 'GET') {
      return firstVisit(request, env, url.origin);
    }

    // Saved routes: authenticated CRUD against the "route" table
    // (worker/routes.js).
    if (pathname === '/api/routes' || pathname.startsWith('/api/routes/')) {
      return handleRoutesApi(request, env, url);
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
};

/** GET → { first: boolean }. True when the caller's session is the
 *  user's earliest on record, i.e. their first visit after registering.
 *  Works for both sign-up paths: Google OAuth (session created right at
 *  sign-up) and email+password (session created when the verification
 *  link is clicked, however much later that is). Backs the account
 *  overview's "Welcome" vs "Welcome back" greeting. */
async function firstVisit(request, env, origin) {
  const session = await getAuth(env, origin).api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id || !session?.session?.id) {
    return Response.json({ error: 'authentication required' }, { status: 401 });
  }
  const earlier = await env.DB.prepare(
    'select 1 from "session" where "userId" = ?1 and "createdAt" < ' +
      '(select "createdAt" from "session" where "id" = ?2) limit 1',
  )
    .bind(session.user.id, session.session.id)
    .first();
  return Response.json({ first: earlier === null });
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
