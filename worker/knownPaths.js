// Which URLs this site actually answers — and where everything else goes.
//
// THE BUG THIS EXISTS FOR: https://fjellrute.no/xx showed the closed alpha's
// login screen. Not a 404, not the holding page — the app itself, at a URL
// nobody had ever published, with HTTP 200 and an invitation to sign up.
//
// Nothing was misconfigured in the ordinary sense. Two defaults simply lined
// up. "not_found_handling": "single-page-application" (wrangler.jsonc) answers
// any unmatched path with dist/index.html, and pathToNav() in src/Root.tsx ends
// with `return { view: 'overview' }` — a router default that has to exist,
// because the app needs *some* view for a path it doesn't recognise. Between
// them, every typo, every stale link and every scanner probing for /wp-admin
// was handed the alpha.
//
// The frontend cannot fix this on its own. By the time React reads
// location.pathname the shell has already been served with a 200, so a crawler
// has its answer, and any redirect after that is a visible flash of the app.
// The decision has to be made before the shell is sent, which means here.
//
// So this module states the allowlist positively: these are the paths that
// exist, everything else is a redirect. It is deliberately a pure function of
// the pathname — no env, no DB, no fetch — so scripts/verify-unknown-paths.mjs
// can import it and enumerate its answers, and so a wrong answer is a wrong
// answer at build time rather than a support email.
//
// WHERE UNKNOWN PATHS GO:
//   /xx, /wp-admin, /u          → the site root. During the alpha that is the
//                                 "Kommer snart" holding page, which is the
//                                 correct public face for a stranger's typo.
//   /alpha/xx, /alpha/plannerr  → the app's own home, /alpha/. Someone already
//                                 at an alpha URL has an invitation; bouncing
//                                 them out to a coming-soon page over a typo is
//                                 the wrong end of the funnel.
//
// WHAT IS DELIBERATELY *NOT* REDIRECTED: a well-formed share URL for something
// that doesn't exist — /u/ghost, /u/kari/r/deadslug. The URL's shape is one we
// publish, so the SPA loads and PublicView says the route is gone. A recipient
// of a dead share link should be told that, not silently deposited on a
// marketing page wondering whether they mistyped it.
//
// KEEP IN STEP WITH:
//   - src/Root.tsx      — pathToNav() and pathToPublic() are the same route
//                         table read by the client. A route added there and not
//                         here becomes a redirect; a route added here and not
//                         there renders the overview. Both are caught by
//                         scripts/verify-unknown-paths.mjs, which parses
//                         Root.tsx and compares the two lists.
//   - wrangler.jsonc    — "run_worker_first" must reach this code. Assets are
//                         served without invoking the Worker unless the path is
//                         listed there, so an unlisted path never gets here and
//                         the bug above comes straight back. That is why the
//                         array is now "/*" minus images rather than a list of
//                         known routes: a list of known routes is precisely
//                         what cannot cover an unknown one.
//   - src/appBase.ts    — APP_BASE is restated below; see the note on it.

import { USERNAME_RE } from './usernameRules.js';

/**
 * Where the app lives in the URL space. This is the same constant as
 * `APP_BASE` in src/appBase.ts, restated because that module is TypeScript in
 * the client bundle and this one is plain JavaScript in the Worker — the two
 * halves of the app cannot share it without dragging the frontend's build into
 * the Worker's.
 *
 * Two copies of one fact is the arrangement that produced the original
 * "Kommer snart" bug (see src/appBase.ts), so it is not left to memory:
 * scripts/verify-unknown-paths.mjs reads both and fails if they disagree.
 * WHEN THE ALPHA OPENS, set this and src/appBase.ts to '' together;
 * everything below adapts, because the app then owns the root and there is no
 * second home to send alpha typos to.
 */
export const APP_BASE = '/alpha';

/**
 * The signed-in app's views, spelled as if the app owned the root — i.e. after
 * APP_BASE has been stripped. This is navToPath()/pathToNav() in src/Root.tsx,
 * restated as data.
 */
const APP_ROUTES = new Set([
  '/', // the overview (or the login gate when signed out)
  '/planner',
  '/saved',
  '/completed',
  '/offline',
]);

/** The two views that open one stored item: /planner/<route id> and
 *  /completed/<track id>. Ids are crypto.randomUUID() (worker/routes.js,
 *  worker/tracks.js), so any non-empty segment is a plausible one — whether it
 *  resolves is the app's business, not the router's. */
const APP_ROUTE_WITH_ID = /^\/(?:planner|completed)\/[^/]+$/;

/**
 * Real HTML pages in public/, reachable by their pretty path as well as their
 * filename (Workers Assets' default "auto-trailing-slash" html_handling maps
 * /about → about.html). These are not SPA routes; they are files, and they are
 * listed so the allowlist below doesn't redirect them.
 *
 * public/about.html in particular is the URL declared as the application home
 * page on Google's OAuth consent screen — redirecting it would break sign-in
 * review, not just a link.
 */
const STATIC_PAGES = new Set([
  '/about',
  '/about.html',
  '/privacy',
  '/privacy.html',
]);

/**
 * The holding page is deliberately NOT in the list above. It is what the site
 * root serves (worker/index.js reads coming-soon.html and answers "/" with it),
 * so its own filename is a second address for a page that already has one —
 * and a second address is what the /index.html rule below exists to refuse.
 *
 * Both spellings are listed because the Worker now runs before the assets
 * binding, so it sees /coming-soon.html verbatim rather than the /coming-soon
 * that html_handling would have rewritten it to.
 */
const HOLDING_PAGE_ALIASES = new Set(['/coming-soon', '/coming-soon.html']);

/** /u/<handle> — a public profile. */
const PUBLIC_PROFILE = /^\/u\/([^/]+)$/;
/** /u/<handle>/r/<slug> (shared plan) and /u/<handle>/t/<slug> (shared tour). */
const PUBLIC_ITEM = /^\/u\/([^/]+)\/(?:r|t)\/([^/]+)$/;

/** A request for a file rather than a page: the last segment carries an
 *  extension. No app route can look like this — ids are UUIDs and handles are
 *  alphanumerics with hyphens (worker/usernameRules.js), neither of which
 *  contains a dot — so the test cannot swallow a real route. */
const LOOKS_LIKE_A_FILE = /\.[a-z0-9]{1,8}$/i;

/** Trailing slashes never distinguish two pages here, and the site root keeps
 *  its own. '/alpha/planner/' and '/alpha/planner' are one route. */
function normalize(pathname) {
  const path = pathname.replace(/\/+$/, '');
  return path || '/';
}

/** A normalized path with APP_BASE removed, or the path unchanged if it never
 *  carried the base. Mirrors stripAppBase() in src/appBase.ts, including its
 *  tolerance of un-prefixed paths — bookmarks made before the app moved under
 *  /alpha still resolve, and must not become redirects now. */
function stripBase(path) {
  if (!APP_BASE) return path;
  if (path === APP_BASE) return '/';
  if (path.startsWith(`${APP_BASE}/`)) return normalize(path.slice(APP_BASE.length));
  return path;
}

/** True if the path sits inside the app's own URL space, whether or not it
 *  names a route the app has. This is what decides which home an unknown path
 *  is sent to. */
function underAppBase(path) {
  if (!APP_BASE) return false;
  return path === APP_BASE || path.startsWith(`${APP_BASE}/`);
}

/**
 * A public share URL, checked for shape only.
 *
 * The handle is validated against the same regex that gates handles at sign-up
 * (worker/usernameRules.js), so /u/kari is a URL this site publishes while
 * /u/../etc or /u/a is not and gets the ordinary redirect. Whether "kari"
 * exists is a database question, answered later and in the open by
 * PublicView's not-found state — deliberately, see the header.
 *
 * Slugs are only required to be a non-empty segment: they are 12 random
 * characters (worker/share.js) with no structure worth re-deriving here.
 */
function isShareUrl(path) {
  const profile = PUBLIC_PROFILE.exec(path);
  if (profile) return isHandle(profile[1]);
  const item = PUBLIC_ITEM.exec(path);
  if (item) return isHandle(item[1]) && item[2].length > 0;
  return false;
}

function isHandle(segment) {
  let handle;
  try {
    handle = decodeURIComponent(segment);
  } catch {
    // Malformed percent-encoding — not a handle, and not something to throw
    // over in a router.
    return false;
  }
  return USERNAME_RE.test(handle.toLowerCase());
}

/**
 * Resolve a document request to one of three outcomes:
 *
 *   { kind: 'app' }              a URL the site owns. Serve whatever the assets
 *                                binding has for it — the SPA shell for a route,
 *                                the real file for a static page.
 *   { kind: 'file' }             a request for a file. Serve it if it exists;
 *                                a miss must be a real 404 and never the SPA
 *                                shell, or the browser is handed HTML where it
 *                                asked for an image or a script and fails
 *                                silently (the same failure the /assets/ branch
 *                                in worker/index.js already guards against).
 *   { kind: 'redirect', to }     not a URL this site has. `to` is a path on the
 *                                same origin, never an absolute URL, so preview
 *                                deployments and `wrangler dev` redirect to
 *                                themselves rather than to production.
 *
 * `to` is guaranteed never to equal the path that was asked for, so this can
 * not produce a redirect loop.
 */
export function resolveDocument(pathname) {
  const path = normalize(pathname);

  // The site root is decided before this function is reached — the holding page
  // while the alpha is closed (worker/index.js), the app once it opens. Saying
  // so here keeps '/' from ever being computed as its own redirect target.
  if (path === '/') return { kind: 'app' };

  // The SPA shell by its filename. dist/index.html is a real file, so the
  // assets binding would happily serve the app at /index.html — a second
  // address for the app, outside the base, which is the very thing APP_BASE
  // exists to prevent.
  if (path === '/index.html') return { kind: 'redirect', to: '/' };
  if (HOLDING_PAGE_ALIASES.has(path)) return { kind: 'redirect', to: '/' };

  if (STATIC_PAGES.has(path)) return { kind: 'app' };
  if (isShareUrl(path)) return { kind: 'app' };

  // Before the route table, so a missing image is a 404 rather than a redirect
  // to an HTML page.
  if (LOOKS_LIKE_A_FILE.test(path)) return { kind: 'file' };

  const inApp = stripBase(path);
  if (APP_ROUTES.has(inApp) || APP_ROUTE_WITH_ID.test(inApp)) {
    // '/alpha' and '/alpha/' are the app's home. The *bare* root reaching this
    // branch would mean the app claiming a URL the holding page owns; it can't
    // happen (see the first line of this function) but the base is what makes
    // that true, so it is written down rather than assumed.
    if (inApp === '/' && APP_BASE && !underAppBase(path)) {
      return { kind: 'redirect', to: '/' };
    }
    return { kind: 'app' };
  }

  return { kind: 'redirect', to: underAppBase(path) ? `${APP_BASE}/` : '/' };
}
