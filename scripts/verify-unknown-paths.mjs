// Guards the answer this site gives to a URL it does not have.
//
// THE BUG: https://fjellrute.no/xx served the closed alpha's login screen.
// HTTP 200, no redirect, no 404 — the app, at an address nobody published, to
// anyone who mistyped the domain or ran a scanner across it. During a closed
// alpha whose whole public face is a "Kommer snart" holding page, that is the
// one page the site should never hand out by accident.
//
// It was not a mistake anybody made. It was two reasonable defaults meeting:
//
//   1. "not_found_handling": "single-page-application" (wrangler.jsonc) is how
//      a client-routed app is supposed to be served — answer every unmatched
//      path with index.html and let the client decide. Crucially, the assets
//      binding does that *without invoking the Worker* unless the path is
//      listed in "run_worker_first", so no amount of code in worker/index.js
//      could see the request.
//   2. pathToNav() in src/Root.tsx ends `return { view: 'overview' }`. A router
//      needs a default; this one's default is the app's front door.
//
// Neither is wrong on its own and neither shows up in a diff as a problem. The
// only place the combination was visible was in a browser, at a URL nobody had
// a reason to type.
//
// So this script tests the fix the way the bug was found: as answers to URLs.
// It imports worker/knownPaths.js for real — it is plain JavaScript with no
// Worker globals precisely so that this is possible — and asserts, path by
// path, what the site does with each one.
//
// It checks five things:
//
//   1. The table. Every path that should be served, redirected or 404'd, named
//      individually, including the ones the bug report was about.
//   2. No loops. Every redirect target must itself be a path the site serves,
//      and must differ from the path that was asked for.
//   3. Agreement with src/Root.tsx. The Worker's allowlist and the client's
//      router are two spellings of one route table; a route in one and not the
//      other is either a page that redirects away from itself or a URL that
//      quietly renders the overview again.
//   4. Agreement with src/appBase.ts, and that wrangler.jsonc still puts the
//      Worker in front of document requests. Any of these drifting restores
//      the original bug in full.
//   5. Negative controls, so a check that has stopped checking is caught.
//
// Run with:  node scripts/verify-unknown-paths.mjs   (needs Node >= 22)
// Wired into `pnpm test:notfound`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, WEB } from './lib/tree.mjs';
import { stripComments } from './lib/strip-comments.mjs';
import { APP_BASE, resolveDocument } from '../worker/knownPaths.js';

const root = REPO;
const rootTsx = readFileSync(join(WEB, 'src/Root.tsx'), 'utf8');
const appBaseTs = readFileSync(join(WEB, 'src/appBase.ts'), 'utf8');
const workerIndex = readFileSync(join(root, 'worker/index.js'), 'utf8');
const wrangler = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    if (detail) console.log(`        ${detail}`);
  }
};

/** Render an outcome as the short string the table below is written in:
 *  'app', 'file', or '→ /where'. */
const outcome = (path) => {
  const r = resolveDocument(path);
  return r.kind === 'redirect' ? `→ ${r.to}` : r.kind;
};

// ---------------------------------------------------------------------------
// 1. The table.
//
// Left column: a URL somebody could arrive at. Right column: what this site
// does with it. Written out one by one rather than generated, because the point
// of the exercise is that the answers are decided deliberately — a generated
// expectation would just restate the implementation.
// ---------------------------------------------------------------------------
console.log('\n[answers] every URL resolves the way it was decided to');

const HOME = `${APP_BASE}/`;

const table = [
  // --- The bug report, verbatim -------------------------------------------
  ['/xx', '→ /'],
  ['/xx/', '→ /'],
  // What actually knocks on the door of a public domain all day. Each of these
  // used to be answered with the alpha's sign-up form.
  ['/wp-admin', '→ /'],
  ['/wp-login.php', 'file'],
  ['/.env', 'file'],
  ['/admin/login', '→ /'],
  ['/api', '→ /'], // /api/* is claimed earlier in worker/index.js; a bare /api is not

  // --- The app, at its real address ---------------------------------------
  [APP_BASE, 'app'],
  [HOME, 'app'],
  [`${APP_BASE}/planner`, 'app'],
  [`${APP_BASE}/planner/`, 'app'],
  [`${APP_BASE}/planner/2f1c9d64-0f4a-4a1e-9a1b-7c2f4d0e5b31`, 'app'],
  [`${APP_BASE}/saved`, 'app'],
  [`${APP_BASE}/completed`, 'app'],
  [`${APP_BASE}/completed/2f1c9d64-0f4a-4a1e-9a1b-7c2f4d0e5b31`, 'app'],
  [`${APP_BASE}/offline`, 'app'],

  // --- Typos inside the app go to the app, not to the holding page ---------
  // Somebody at an /alpha URL already has an invitation. Bouncing them out to
  // "Kommer snart" over a mistyped route is the wrong direction of travel.
  [`${APP_BASE}/plannerr`, `→ ${HOME}`],
  [`${APP_BASE}/nonsense`, `→ ${HOME}`],
  [`${APP_BASE}/planner/abc/extra`, `→ ${HOME}`],
  [`${APP_BASE}/u/kari`, `→ ${HOME}`], // share URLs are not under the base

  // --- Bookmarks made before the app moved under /alpha --------------------
  // stripAppBase() in src/appBase.ts still resolves these, so they must not
  // become redirects now; the first in-app navigation rewrites the URL.
  ['/planner', 'app'],
  ['/saved', 'app'],
  ['/completed/2f1c9d64-0f4a-4a1e-9a1b-7c2f4d0e5b31', 'app'],

  // --- Public share URLs ---------------------------------------------------
  // Well-formed but possibly dead: these keep loading the SPA so PublicView can
  // say the route is gone. A dead share link deserves an explanation, not a
  // silent hop to a marketing page.
  ['/u/kari', 'app'],
  ['/u/kari/', 'app'],
  ['/u/ghost-user-who-does-not-exist', 'app'],
  ['/u/kari/r/abcdefghjkmn', 'app'],
  ['/u/kari/t/abcdefghjkmn', 'app'],
  // Malformed: not a URL shape this site publishes.
  ['/u', '→ /'],
  ['/u/', '→ /'],
  ['/u/a', '→ /'], // shorter than the 3-character minimum (worker/usernameRules.js)
  ['/u/-nope-', '→ /'], // handles must start and end alphanumeric
  ['/u/kari/x/abcdefghjkmn', '→ /'], // only r and t exist
  ['/u/kari/r', '→ /'],

  // --- Real pages in public/ ----------------------------------------------
  // about.html is the application home page declared on Google's OAuth consent
  // screen; redirecting it would break sign-in review, not just a link.
  ['/about', 'app'],
  ['/about.html', 'app'],
  ['/privacy', 'app'],
  ['/privacy.html', 'app'],

  // --- Pages that must not have a second address ---------------------------
  // dist/index.html and dist/coming-soon.html are both real files, so the
  // assets binding would serve the app at /index.html and the holding page at
  // /coming-soon — duplicating, outside the base, the two pages whose whole
  // arrangement is about which one owns "/".
  ['/index.html', '→ /'],
  ['/coming-soon', '→ /'],
  ['/coming-soon.html', '→ /'],

  // --- File requests 404 rather than redirect ------------------------------
  // A 302 to an HTML page in answer to <img src> or a stylesheet is worse than
  // a 404: the browser follows it and fails on the content type instead.
  //
  // NOTE: these are the resolver's answers. Whether the resolver is consulted
  // is a separate question — the image patterns excluded from
  // "run_worker_first" (wrangler.jsonc) never reach the Worker at all, so a
  // missing .png still gets the SPA fallback in production. That is the
  // deliberate trade for not billing 83 weather icons as Worker requests, and
  // the section below pins down exactly which extensions it applies to.
  ['/missing.png', 'file'],
  ['/favicon.ico', 'file'],
  ['/robots.txt', 'file'],
  ['/login-fall.jpg', 'file'],
  ['/weather-icons/rain.svg', 'file'],
];

for (const [path, expected] of table) {
  const got = outcome(path);
  check(`${path.padEnd(48)} ${expected}`, got === expected, `got ${got}`);
}

// ---------------------------------------------------------------------------
// 2. No loops, and no redirect into thin air.
//
// A redirect whose target is itself unknown is an infinite bounce, and a
// redirect to the path that was asked for is the same thing more directly. Both
// are one careless edit away from any allowlist, and neither is visible in the
// table above — an expectation of '→ /' says nothing about what '/' does.
// ---------------------------------------------------------------------------
console.log('\n[loops] every redirect lands somewhere real, in one hop');

const everyPath = table.map(([path]) => path);
for (const path of everyPath) {
  const r = resolveDocument(path);
  if (r.kind !== 'redirect') continue;
  check(
    `${path} → ${r.to} is not a self-redirect`,
    r.to !== path && r.to !== path.replace(/\/+$/, ''),
    'the browser would follow this to the same URL forever',
  );
  const next = resolveDocument(r.to);
  check(
    `${path} → ${r.to} lands on a served page`,
    next.kind === 'app',
    `the target resolves to ${JSON.stringify(next)} — a redirect chain, not a destination`,
  );
}

// Redirect targets are same-origin paths, never absolute URLs: worker/index.js
// resolves them against the incoming request, so `wrangler dev` and preview
// deployments must not send a developer to production.
{
  const targets = new Set(
    everyPath
      .map((p) => resolveDocument(p))
      .filter((r) => r.kind === 'redirect')
      .map((r) => r.to),
  );
  check(
    `every redirect target is a bare path (${JSON.stringify([...targets])})`,
    [...targets].every((t) => t.startsWith('/') && !t.startsWith('//')),
    'an absolute URL here sends localhost traffic to the live site',
  );
}

// ---------------------------------------------------------------------------
// 3. The Worker's allowlist and the client's router are the same table.
//
// src/Root.tsx decides what a path renders; worker/knownPaths.js decides
// whether the browser is ever given the chance. A route in Root.tsx that is
// missing here redirects away from a page that exists. A route here that is
// missing from Root.tsx renders the overview — which is the original bug,
// rebuilt one route at a time.
// ---------------------------------------------------------------------------
console.log('\n[agreement] the Worker and src/Root.tsx know the same routes');

const routerCode = stripComments(rootTsx);

// pathToNav()'s literals: `path === '/saved'` and `/^\/planner\/([^/]+)$/`.
const navFn = /function pathToNav\([\s\S]*?\n}/.exec(routerCode)?.[0] ?? '';
check(
  'pathToNav() was found in src/Root.tsx',
  navFn.length > 0,
  'this script cannot compare against a router it cannot find',
);

const clientRoutes = [...navFn.matchAll(/path === '([^']+)'/g)].map((m) => m[1]);
const clientIdRoutes = [...navFn.matchAll(/\^\\\/(\w+)\\\/\(\[\^\/\]\+\)\$/g)].map(
  (m) => `/${m[1]}`,
);
check(
  `pathToNav() names ${clientRoutes.length} plain routes ` +
    `(${JSON.stringify(clientRoutes)})`,
  clientRoutes.length >= 4,
  'suspiciously few — the extraction above has probably stopped matching',
);
check(
  `pathToNav() names ${clientIdRoutes.length} routes that open one item ` +
    `(${JSON.stringify(clientIdRoutes)})`,
  clientIdRoutes.length === 2,
  'expected /planner/:id and /completed/:id',
);

for (const route of clientRoutes) {
  check(
    `the Worker serves ${APP_BASE}${route}, which pathToNav() renders`,
    resolveDocument(`${APP_BASE}${route}`).kind === 'app',
    'the client would render this view; the Worker redirects away from it first',
  );
}
for (const route of clientIdRoutes) {
  check(
    `the Worker serves ${APP_BASE}${route}/<id>`,
    resolveDocument(`${APP_BASE}${route}/2f1c9d64-0f4a-4a1e-9a1b-7c2f4d0e5b31`)
      .kind === 'app',
  );
}

// And the reverse: nothing the Worker serves under the base is a path the
// client has no view for. The overview ('/' after the base is stripped) is the
// one legitimate extra, since it is the app's home rather than a named route.
{
  const knownToClient = new Set([...clientRoutes, ...clientIdRoutes, '/']);
  const served = ['/', '/planner', '/saved', '/completed', '/offline'].filter(
    (r) => resolveDocument(`${APP_BASE}${r === '/' ? '/' : r}`).kind === 'app',
  );
  const orphans = served.filter((r) => !knownToClient.has(r));
  check(
    'every route the Worker serves has a view in pathToNav()',
    orphans.length === 0,
    `${JSON.stringify(orphans)} would be served and then render the overview — ` +
      'which is the bug this script exists for, one route at a time',
  );
}

// The public share patterns, the same way.
const publicFn = /function pathToPublic\([\s\S]*?\n}/.exec(routerCode)?.[0] ?? '';
check(
  'pathToPublic() was found in src/Root.tsx',
  publicFn.length > 0,
);
check(
  'pathToPublic() still namespaces public URLs under /u/',
  /\\\/u\\\//.test(publicFn),
  'if share URLs moved, worker/knownPaths.js has to move with them',
);
for (const kind of ['r', 't']) {
  check(
    `pathToPublic() handles /u/<handle>/${kind}/<slug>, and so does the Worker`,
    new RegExp(`\\\\/${kind}\\\\/`).test(publicFn) &&
      resolveDocument(`/u/kari/${kind}/abcdefghjkmn`).kind === 'app',
  );
}

// ---------------------------------------------------------------------------
// 4. The three files that have to agree, and the one setting that makes any of
//    this run at all.
// ---------------------------------------------------------------------------
console.log('\n[config] the base is one value and the Worker is in front');

const clientBase = /APP_BASE = '([^']*)'/.exec(appBaseTs)?.[1];
check(
  `src/appBase.ts and worker/knownPaths.js agree on ${JSON.stringify(APP_BASE)}`,
  clientBase === APP_BASE,
  `src/appBase.ts says ${JSON.stringify(clientBase)} — the Worker would redirect ` +
    'alpha typos to a base the app does not use',
);

// THE SETTING THAT MADE THE BUG POSSIBLE. Without the Worker running first,
// none of the code above is ever reached: the assets binding answers the
// unmatched path with index.html and the request never enters the Worker.
const workerFirst =
  /"run_worker_first"\s*:\s*\[([\s\S]*?)\]/.exec(stripComments(wrangler))?.[1] ??
  '';
const patterns = [...workerFirst.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
check(
  `run_worker_first covers every path ("/*" among ${JSON.stringify(patterns)})`,
  patterns.includes('/*'),
  'without a catch-all the Worker only sees paths someone thought to list, ' +
    'and an unlisted path gets the SPA fallback — which is the original bug',
);
const exclusions = patterns.filter((p) => p.startsWith('!'));

// Cloudflare's "*" matches across "/" too, so an exclusion written as an
// extension — "!/*.png" — is not "static images", it is "every path on the site
// ending in .png". That included /terrain-dem/12/2145/1088.png, and the 3D
// view's heightmaps stopped reaching worker/terrain.js: the assets binding
// answered them with index.html, HTTP 200, and MapLibre was handed HTML. The
// rule that prevents the whole family of that mistake is that an exclusion must
// begin with a literal segment or filename prefix, never a wildcard.
check(
  'every exclusion is anchored to a literal prefix, not to an extension',
  exclusions.every((p) => /^!\/[a-z0-9][a-z0-9-]*[/*.]/i.test(p)),
  `${JSON.stringify(exclusions.filter((p) => !/^!\/[a-z0-9][a-z0-9-]*[/*.]/i.test(p)))} ` +
    'starts with a wildcard, so it matches paths in every directory — ' +
    'including the ones the Worker has to handle',
);
check(
  'no exclusion matches a path the Worker must handle',
  (() => {
    const mustReachWorker = [
      '/api/auth/get-session',
      '/assets/index-abc123.js',
      '/assets/inter-latin-400-normal.woff2',
      '/terrain-dem/12/2145/1088.png',
      '/metno-api/weatherapi/locationforecast/2.0/compact',
      '/gts-api/GridTimeSeries',
      '/varsom-api/hydrology/forecast/avalanche/',
    ];
    return mustReachWorker.every((path) => !matchesAnyExclusion(path));
  })(),
  'this is the terrain-tile regression described above, in whichever form it ' +
    'has come back',
);

// A document route must never be hidden behind an exclusion either. Checked
// against the table rather than by reading the globs, because a glob's meaning
// is Cloudflare's business and the table's is ours.
for (const [path, expectedOutcome] of table) {
  if (expectedOutcome === 'file') continue;
  check(
    `${path} reaches the Worker`,
    !matchesAnyExclusion(path),
    'an exclusion in run_worker_first matches this path, so the assets ' +
      'binding answers it and the redirect above never happens',
  );
}

/** Cloudflare's asset-routing glob, as far as this script needs it: "*" is a
 *  wildcard that spans "/" — which is the whole point of the checks above. */
function matchesAnyExclusion(path) {
  return exclusions.some((pattern) => {
    const glob = pattern.slice(1);
    const re = new RegExp(
      `^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );
    return re.test(path);
  });
}
check(
  'run_worker_first is an array, not `true`',
  /"run_worker_first"\s*:\s*\[/.test(wrangler),
  '`true` bills every hashed bundle, tile and photo as a Worker request ' +
    '(docs/cost-and-limits.md)',
);
check(
  'the SPA fallback is still what the Worker is guarding against',
  /"not_found_handling"\s*:\s*"single-page-application"/.test(wrangler),
  'if this changed, re-read worker/knownPaths.js — its "file" outcome assumes ' +
    'a miss comes back as index.html',
);

// The enforcement in worker/index.js, since knownPaths.js answering correctly
// is worth nothing if nobody asks it.
check(
  'worker/index.js consults resolveDocument()',
  /resolveDocument\(pathname\)/.test(stripComments(workerIndex)),
);
check(
  'worker/index.js answers a redirect outcome with a 302 and a Location',
  /status: 302/.test(workerIndex) && /Location:/.test(workerIndex),
);
check(
  'worker/index.js still intercepts the site root for the holding page',
  /pathname === '\/'/.test(workerIndex),
  'the redirects above send strangers to "/" expecting coming-soon.html',
);
check(
  'only GET and HEAD are redirected',
  /request\.method !== 'GET' && request\.method !== 'HEAD'/.test(workerIndex),
  'a POST to a path that does not exist is not a mistyped URL',
);

// ---------------------------------------------------------------------------
// 5. Negative controls. Each mutation below is a plausible future edit, and
//    each must be caught by the check that claims to catch it — otherwise this
//    script is a list of passing assertions about nothing.
// ---------------------------------------------------------------------------
console.log('\n[control] the checks detect the regressions they exist for');

// THE ORIGINAL BUG, reconstructed: a resolver whose default is "serve the app".
{
  const permissive = (path) =>
    path.startsWith('/u/') || path === '/' ? { kind: 'app' } : { kind: 'app' };
  check(
    'a resolver that serves everything is caught by the table',
    permissive('/xx').kind === 'app' && outcome('/xx') === '→ /',
    'the table would pass against a resolver that never redirects',
  );
}

// The catch-all quietly removed from run_worker_first, leaving the named
// routes that were there before — the exact state the repository was in.
{
  const narrowed = ['/', '/assets/*', '/api/*', '/alpha', '/alpha/*', '/u/*'];
  check(
    'a run_worker_first without a catch-all is caught',
    !narrowed.includes('/*'),
  );
}

// THE TERRAIN-TILE REGRESSION, as it was actually written: "!/*.png" reads as
// "static images" and means "every .png anywhere", including the 3D view's
// heightmap tiles. The anchoring rule is what refuses it.
{
  const anchored = /^!\/[a-z0-9][a-z0-9-]*[/*.]/i;
  check(
    'an extension-only exclusion is caught',
    !anchored.test('!/*.png') && !anchored.test('!/*.jpg'),
    'these are the two patterns that took /terrain-dem/**.png away from the Worker',
  );
  check(
    'the patterns actually in use pass the same rule',
    anchored.test('!/weather-icons/*') && anchored.test('!/login-*.jpg'),
    'the rule is worthless if it also rejects the exclusions we want',
  );
}

// An exclusion aimed at a document route, which would hide typed paths from the
// Worker again without touching a line of code. Anchored, so the rule above
// passes it; caught instead by the per-path check against the table.
{
  const saved = exclusions.slice();
  exclusions.push('!/alpha/*');
  check(
    'an exclusion covering a document route is caught',
    matchesAnyExclusion(`${APP_BASE}/saved`),
    'an exclusion for a document route puts the SPA fallback back in charge',
  );
  exclusions.length = 0;
  exclusions.push(...saved);
}

// The two bases drifting apart — alpha typos redirected to a home that no
// longer exists, which is a loop the browser gives up on.
{
  const drifted = '/beta';
  check(
    'the two copies of APP_BASE drifting apart is caught',
    drifted !== APP_BASE,
  );
}

// A route added to src/Root.tsx and forgotten here: the client can render it,
// the Worker redirects away from it, and the page is simply unreachable.
{
  const invented = `${APP_BASE}/statistics`;
  check(
    'a route the client would render but the Worker does not serve is caught',
    resolveDocument(invented).kind === 'redirect',
    'add it to APP_ROUTES in worker/knownPaths.js when it is added to Root.tsx',
  );
}

// A share URL turned into a redirect, which would take the explanation away
// from everyone holding a link to a deleted route.
check(
  'a well-formed share URL is never a redirect',
  resolveDocument('/u/kari/r/abcdefghjkmn').kind === 'app' &&
    resolveDocument('/u/ghost').kind === 'app',
  'PublicView\'s not-found state is the answer a dead share link should get',
);

console.log(
  failures === 0
    ? '\nALL CHECKS PASSED — a URL this site does not have goes to the front page'
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
