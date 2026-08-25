// Cross-origin access to /api/* for browser clients that are not this site.
//
// READ THIS BEFORE ASSUMING CORS IS WHAT MAKES THE PHONE WORK. It is not. CORS
// is enforced by browsers: the browser withholds a cross-origin response from
// the page unless the server says otherwise. React Native's fetch is not a
// browser and performs no such check, so a native build of apps/mobile talks to
// this Worker with or without any of the headers below. What would reject the
// phone is Better Auth's CSRF check, which is `trustedOrigins` in worker/auth.js.
//
// So what is this file for? Anything that legitimately calls /api/* from a page
// this Worker does not serve: a local docs page, a future admin tool, a scratch
// HTML file used to reproduce an API bug without the app in the way. The Expo
// dev server's origin is listed below for the same reason.
//
// It is specifically NOT for running the mobile app in a browser with
// `expo start --web`. An earlier draft of this comment said it was, and that was
// wrong: two of that app's dependencies are native-only — MapLibre React Native
// has no web renderer, and expo-secure-store has no web implementation, so there
// is nowhere for the session to live. No CORS policy fixes either. apps/mobile
// therefore has no `web` script.
//
// The policy is an exact-match allowlist, never a wildcard, and it must stay
// that way for one specific reason: these endpoints are authenticated by cookie,
// and `Access-Control-Allow-Origin: *` is not permitted together with
// `Access-Control-Allow-Credentials: true` — browsers reject the combination.
// A wildcard here would therefore either do nothing or, if someone "fixed" it by
// reflecting the request's Origin back unconditionally, hand every site on the
// internet authenticated read/write access to the signed-in user's routes.
// Reflecting an origin is only safe when it has been checked against a list, and
// that is exactly what this does.

/**
 * Origins allowed to call /api/* from a browser, beyond our own.
 *
 * The Expo web dev server, on both hostnames it answers to. Ports are fixed by
 * Expo's default; a second instance shifts to 8082 and would need adding here
 * rather than being globbed, because a glob over localhost ports is a glob over
 * every dev server on the machine.
 */
const DEV_ORIGINS = ['http://localhost:8081', 'http://127.0.0.1:8081'];

/** Methods the API actually implements, so a preflight cannot advertise more. */
const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';

/**
 * Headers a cross-origin caller may send. Content-Type covers the JSON bodies;
 * Cookie is deliberately absent because a browser will not let a page set it
 * from script anyway — it travels via credentials, which is what
 * Allow-Credentials below is for.
 */
const ALLOWED_HEADERS = 'Content-Type';

/**
 * Is this origin allowed to call the API cross-origin?
 *
 * `self` — the origin this Worker is serving — is always allowed, which makes
 * the function total: a same-origin request that happens to carry an Origin
 * header (every POST does) is answered rather than treated as foreign.
 *
 * The dev origins are only allowed when the Worker itself is running on a
 * development origin. On production, localhost is not a trusted caller: an
 * attacker's page cannot become localhost, but a developer's half-finished tool
 * reaching the real database by accident is a mistake worth making impossible.
 */
export function isAllowedOrigin(origin, self) {
  if (!origin) return false;
  if (origin === self) return true;
  return isDevSelf(self) && DEV_ORIGINS.includes(origin);
}

/** Whether this Worker is being served from a local development origin. */
function isDevSelf(self) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
    self,
  );
}

/**
 * The CORS headers for a request, or null when there is nothing to add.
 *
 * Vary: Origin is not optional. These responses are edge-cached, and a cached
 * response carrying one caller's Allow-Origin would be served to another; Vary
 * tells the cache that the header is part of the key.
 */
export function corsHeaders(request, url) {
  const origin = request.headers.get('Origin');
  if (!isAllowedOrigin(origin, url.origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

/**
 * Answer a CORS preflight, or return null if this is not one.
 *
 * A preflight is an OPTIONS request carrying Access-Control-Request-Method. It
 * must be answered *before* any authentication runs — it carries no cookies by
 * design, so an auth check would reject it and the browser would report the real
 * request as blocked, with the preflight failure being the actual cause.
 *
 * An OPTIONS from a disallowed origin gets 403 rather than a bare 204: silence
 * here is the single most confusing failure in cross-origin work, and a status
 * with a body says which origin was refused.
 */
export function handlePreflight(request, url) {
  if (request.method !== 'OPTIONS') return null;
  if (!request.headers.get('Access-Control-Request-Method')) return null;

  const headers = corsHeaders(request, url);
  if (!headers) {
    return Response.json(
      { error: 'origin not allowed' },
      { status: 403, headers: { Vary: 'Origin' } },
    );
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...headers,
      'Access-Control-Allow-Methods': ALLOWED_METHODS,
      'Access-Control-Allow-Headers': ALLOWED_HEADERS,
      // 10 minutes. Long enough that a burst of API calls preflights once,
      // short enough that changing this allowlist takes effect the same day.
      'Access-Control-Max-Age': '600',
    },
  });
}

/**
 * Copy the CORS headers onto a response that has already been produced.
 *
 * Returns a new Response rather than mutating: a Response's headers are
 * immutable once it has been constructed by another handler, and the alternative
 * — asking every API handler to accept and thread these headers — would mean
 * every future endpoint has to remember to.
 */
export function withCors(response, request, url) {
  const headers = corsHeaders(request, url);
  if (!headers) return response;
  const merged = new Headers(response.headers);
  for (const [k, v] of Object.entries(headers)) merged.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
