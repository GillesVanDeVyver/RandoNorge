/**
 * Where the app itself lives in the URL space, during the closed alpha.
 *
 * The site root is NOT the app. `worker/index.js` answers a bare visit to "/"
 * with the static holding page (`public/coming-soon.html`), so "/" belongs to
 * the public, not to testers. The app therefore needs a home of its own, and
 * that home is `/alpha/` — the URL testers are already given in their
 * invitation and the one `public/about.html` and `docs/TODO_WEEK3.md` name.
 *
 * This module exists because that fact used to be nowhere in the frontend. The
 * app treated "/" as its own root: `Root.tsx` wrote "/" into the URL for the
 * overview and after sign-out, and every emailed/OAuth return in
 * `LoginPage.tsx` used `callbackURL: '/'`. Each of those quietly handed the
 * user to the holding page — most visibly right after accepting the terms at
 * sign-up, which is where the bug was found: accept, and Fjellrute answers
 * "Kommer snart". Nothing threw, nothing logged; the app simply was not the
 * thing at the address it had sent the browser to.
 *
 * So: no route may be spelled as a literal string any more. Build outgoing
 * paths with `appPath()` and read incoming ones through `stripAppBase()`, and
 * the base is stated in exactly one place.
 *
 * WHEN THE ALPHA OPENS TO THE PUBLIC, set `APP_BASE` to '' and the app returns
 * to the root — that, plus dropping the "/" branch in `worker/index.js` and
 * the "/" entry in `wrangler.jsonc`, is the whole change. `stripAppBase()`
 * keeps accepting `/alpha/...` afterwards, so links already sent to testers do
 * not rot.
 *
 * Public share URLs (`/u/<handle>/…`) are deliberately NOT under this base.
 * They are meant to be shareable with people who have no invitation, they are
 * served for anyone (`worker/public.js`), and a link with "alpha" in it invites
 * exactly the question a shared route should not raise. `stripAppBase()` still
 * tolerates the prefix on them so an in-app link cannot break.
 */
export const APP_BASE = '/alpha';

/**
 * An in-app path, prefixed with the base. Pass the path the app would use if
 * it owned the root ('/planner', '/saved', …); pass nothing for the app's own
 * home page.
 *
 *   appPath()           → '/alpha/'
 *   appPath('/planner') → '/alpha/planner'
 *
 * The home page keeps its trailing slash: it is the address testers are sent,
 * and it is what distinguishes "the app" from a page called "alpha".
 */
export function appPath(path: string = '/'): string {
  if (!path || path === '/') return APP_BASE ? `${APP_BASE}/` : '/';
  const rooted = path.startsWith('/') ? path : `/${path}`;
  return `${APP_BASE}${rooted}`;
}

/**
 * The reverse: a real `location.pathname` → the path the routing code reasons
 * about, with the base removed and a trailing slash normalised away.
 *
 *   '/alpha/'          → '/'
 *   '/alpha'           → '/'
 *   '/alpha/planner/'  → '/planner'
 *   '/planner'         → '/planner'   (see below)
 *   '/u/kari/r/abc'    → '/u/kari/r/abc'
 *
 * Un-prefixed paths are passed through unchanged, which is what keeps older
 * bookmarks and any link sent out before the move working: `/saved` still
 * opens the saved list, and the first in-app navigation afterwards rewrites
 * the URL under the base. The one path this cannot rescue is the bare root —
 * the holding page answers that before the app ever loads.
 */
export function stripAppBase(pathname: string): string {
  let path = pathname;
  if (APP_BASE) {
    if (path === APP_BASE) {
      path = '/';
    } else if (path.startsWith(`${APP_BASE}/`)) {
      path = path.slice(APP_BASE.length);
    }
  }
  // '/planner/' and '/planner' are the same view; only the root keeps its
  // slash. Without this, a trailing slash silently falls through to the
  // overview instead of the view the user asked for.
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path || '/';
}
