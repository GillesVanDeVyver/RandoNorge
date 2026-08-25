// Where this package's API clients send their requests, and what they send for
// credentials. Two adapters, both defaulting to exactly what the web app has
// always done, so nothing on the web changes by installing them.
//
// THE PROBLEM THIS SOLVES. Every API client in this package was written inside a
// browser, where `fetch('/api/routes')` resolves against the page's origin. That
// is not a property of fetch; it is a property of having a document. React
// Native's fetch has no origin to resolve against and rejects a path-only URL
// outright, so the same call that works on the web fails on a phone with a
// message about an unsupported URL. packages/core/README.md called this the one
// thing left undecided at the end of Phase 1; this file is the decision, made
// once, in one place, rather than four times at four call sites.
//
// WHY AN ADAPTER RATHER THAN A REQUIRED ARGUMENT. Threading a base URL through
// every function would change every web call site for the benefit of a caller
// the web does not have, and a required argument cannot have a default that
// keeps the browser's behaviour byte-identical. The rest of this package already
// resolves its platform differences this way — see i18n/environment.ts for
// locale storage, elevation/raster.ts for image decode, routes/xml.ts for the
// XML parser — so this is the established shape, not a new one.
//
// WHAT THE PHONE SETS. The mobile app calls both setters once at startup:
// setApiBase() with the Worker's origin (its own dev/production switch decides
// which), and setAuthHeaders() with a function returning the Cookie header from
// Better Auth's Expo client, because on native the session lives in SecureStore
// rather than in a cookie jar that fetch consults on its own.

/**
 * The origin every API path is resolved against, or '' for "resolve it the way
 * a browser would". Empty is the web's behaviour and the default, so a module
 * that never calls setApiBase() emits precisely the URLs it always did.
 */
let apiBase = '';

/**
 * Point this package's API clients at an explicit origin.
 *
 * Call it once, before the first request. Pass an origin with no trailing slash
 * (`https://fjellrute.no`, `http://192.168.50.10:8787`); a trailing slash is
 * tolerated and stripped, because the value usually arrives from configuration
 * a human typed.
 *
 * Passing '' restores same-origin resolution, which is what makes this safe to
 * call unconditionally from shared code.
 */
export function setApiBase(base: string): void {
  apiBase = base.replace(/\/+$/, '');
}

/** The configured origin, or '' when requests resolve against the page. */
export function getApiBase(): string {
  return apiBase;
}

/**
 * Resolve an API path against the configured origin.
 *
 * The paths in this package are always root-relative ('/api/routes'), and the
 * assertion below keeps them that way: a relative path would resolve against
 * whatever the current document happens to be on the web and silently produce a
 * different URL per screen, which is the class of bug this indirection exists to
 * remove rather than introduce.
 */
export function apiUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`apiUrl needs a root-relative path, got: ${path}`);
  }
  return apiBase ? `${apiBase}${path}` : path;
}

/** Extra headers to send with every API request. */
type HeaderSource = () => Record<string, string>;

const NO_HEADERS: HeaderSource = () => ({});

let headerSource: HeaderSource = NO_HEADERS;

/**
 * Supply headers that authenticate the caller — on native, the Cookie header
 * holding the Better Auth session.
 *
 * A function rather than a value because the session outlives no particular
 * render: it is read at request time, so a token refreshed after startup is
 * picked up without re-installing the adapter.
 *
 * The default returns nothing, which is correct for the browser: there the
 * session is a real cookie on our own origin and fetch attaches it without being
 * asked.
 */
export function setAuthHeaders(source: HeaderSource): void {
  headerSource = source;
}

/** The configured auth headers, or an empty object on the web. */
export function authHeaders(): Record<string, string> {
  return headerSource();
}

/**
 * Whether fetch should be allowed to manage cookies itself.
 *
 * True on the web, where the session cookie is the mechanism. False once
 * setAuthHeaders() is installed, because Better Auth's Expo guidance is
 * explicit that `credentials: 'include'` interferes with a Cookie header set by
 * hand — the two compete, and the manual one loses.
 */
export function usesCookieCredentials(): boolean {
  return headerSource === NO_HEADERS;
}
