// Reverse-proxy helper for the Cloudflare Worker (see worker/index.js).
// Mirrors the Vite dev proxies in vite.config.ts so the same `/metno-api`,
// `/gts-api` and `/varsom-api` paths work identically in development and
// production.
//
// Two jobs:
//  1. Stamp identifying headers (MET's terms require a contactable
//     User-Agent; browsers can't set that header from fetch(), so it has
//     to happen server-side).
//  2. Cache upstream responses at the Cloudflare edge so repeated route
//     planning doesn't hammer the free public APIs — required by MET's
//     terms ("clients must cache") and just good citizenship toward NVE.

// Identifies the app to upstream services, per MET's ToS. Keep a working,
// monitored contact address here at all times. Use a role address (not a
// personal inbox) so it can be published in the repo and sent on every
// upstream request without exposing an individual's email.
export const USER_AGENT = 'fjellrute/0.1 contact@fjellrute.no';

// The contact address stamped on upstream requests. Same role address as
// USER_AGENT, split out because some APIs want it in their own header rather
// than inside a User-Agent string (see NVDB_HEADERS).
export const CONTACT_EMAIL = 'contact@fjellrute.no';

// Statens vegvesen's NVDB API asks callers to identify themselves with an
// application name and a contact person. Registration is not required and
// there is no key, but api.vegdata.no/retningslinjer.html states these headers
// are expected of anyone using the service in earnest — the same courtesy the
// MET proxy pays via User-Agent. Sending them is what keeps us a known caller
// rather than anonymous traffic if we ever need to be contacted about load.
export const NVDB_HEADERS = {
  'X-Client': 'fjellrute',
  'X-Kontaktperson': CONTACT_EMAIL,
};

/**
 * Proxy a GET request to `upstreamBase + path`, caching successful
 * responses at the edge for `ttlSeconds`.
 *
 * @param {Request} request       incoming request
 * @param {ExecutionContext} ctx  worker execution context (for waitUntil)
 * @param {string} prefix         route prefix to strip, e.g. '/metno-api'
 * @param {string} upstreamBase   e.g. 'https://api.met.no'
 * @param {number} ttlSeconds     edge cache lifetime
 * @param {string[]} [allow]      if set, the upstream path (after the prefix
 *                                is stripped) must start with one of these,
 *                                so the proxy can't be used as an open relay
 *                                against the whole upstream host.
 * @param {Record<string,string>} [extraHeaders]
 *                                additional request headers for upstreams that
 *                                want more than a User-Agent to identify the
 *                                caller (NVDB's X-Client / X-Kontaktperson).
 */
export async function proxyGet(
  request,
  ctx,
  prefix,
  upstreamBase,
  ttlSeconds,
  allow,
  extraHeaders,
) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const upstreamPath = url.pathname.slice(prefix.length);

  // Restrict to the exact upstream paths the app uses. Without this the proxy
  // would forward any path on the trusted host, letting a third party relay
  // arbitrary requests through (and fill) our edge cache.
  if (allow && !allow.some((p) => upstreamPath.startsWith(p))) {
    return new Response('Not found', { status: 404 });
  }

  const upstreamUrl = upstreamBase + upstreamPath + url.search;

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
      ...extraHeaders,
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
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}
