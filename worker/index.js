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
