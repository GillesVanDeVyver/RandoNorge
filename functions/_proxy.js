// Shared reverse-proxy helper for the Cloudflare Pages Functions in this
// directory. Mirrors the Vite dev proxies in vite.config.ts so the same
// `/metno-api`, `/gts-api` and `/varsom-api` paths work identically in
// development and production.
//
// Two jobs:
//  1. Stamp identifying headers (MET's terms require a contactable
//     User-Agent; browsers can't set that header from fetch(), so it has
//     to happen server-side).
//  2. Cache upstream responses at the Cloudflare edge so repeated route
//     planning doesn't hammer the free public APIs — required by MET's
//     terms ("clients must cache") and just good citizenship toward NVE.
//
// Files starting with "_" are not routed by Pages, so this module is only
// reachable through the route handlers that import it.

// Identifies the app to upstream services, per MET's ToS. Keep a working
// contact address in here at all times.
export const USER_AGENT = 'fjellrute/0.1 tryggve@sonofit.no';

/**
 * Proxy a GET request to `upstreamBase + path`, caching successful
 * responses at the edge for `ttlSeconds`.
 *
 * @param {EventContext} context  Pages Function context
 * @param {string} prefix         route prefix to strip, e.g. '/metno-api'
 * @param {string} upstreamBase   e.g. 'https://api.met.no'
 * @param {number} ttlSeconds     edge cache lifetime
 */
export async function proxyGet(context, prefix, upstreamBase, ttlSeconds) {
  const url = new URL(context.request.url);
  const upstreamUrl =
    upstreamBase + url.pathname.slice(prefix.length) + url.search;

  // caches.default is Cloudflare's per-datacenter edge cache. Keyed on the
  // upstream URL, so identical lookups (same forecast cell, same day) are
  // served without touching the upstream at all.
  const cache = caches.default;
  const cacheKey = new Request(upstreamUrl);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = await fetch(upstreamUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });

  // Rebuild the response so headers are mutable, then set our own cache
  // policy (upstream cookies/vary headers are dropped deliberately —
  // these are anonymous, public data responses).
  const response = new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type':
        upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': `public, max-age=${ttlSeconds}`,
    },
  });

  // MET returns 203 while an endpoint is deprecated but still valid —
  // treat it like a 200. Never cache errors.
  if (upstream.status === 200 || upstream.status === 203) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}
