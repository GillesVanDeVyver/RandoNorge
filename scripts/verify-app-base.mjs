// Guards the line between the app and the public holding page.
//
// During the closed alpha the site root is NOT the app: worker/index.js answers
// "/" with public/coming-soon.html, and the app lives one segment down, at
// /alpha/ (src/appBase.ts). That is two independent halves of one arrangement,
// held together by nothing a compiler can see — and on 2026-07-29 only the
// first half existed. The Worker took the root away; the frontend went on
// treating "/" as its own home. Every auth callback in LoginPage.tsx read
// `callbackURL: '/'`, and Root.tsx reset the URL to "/" after sign-out. So a
// new tester accepted the terms of use at sign-up, Better Auth redirected them
// to "/" exactly as asked, and Fjellrute answered "Kommer snart".
//
// Nothing failed. `tsc` is perfectly happy with a string, eslint has no opinion
// about which path it spells, and the only place the mistake was visible was in
// a browser, at the end of a sign-up flow nobody re-runs by hand very often.
// That is what this script is for.
//
// It checks two things that no type can express:
//
//   1. The mapping itself — appPath() and stripAppBase() round-trip, and
//      appPath() can never return the bare root. Run for real, against the
//      source, not asserted about by regex.
//   2. That no route or redirect is spelled as a literal anywhere in src/.
//      One `'/'` in a callbackURL is the whole bug.
//
// Plus the agreement between the halves: if the Worker intercepts "/", the base
// must be non-empty, and the URL testers are given in public/about.html must be
// the base the app actually uses.
//
// WHEN THE ALPHA OPENS TO THE PUBLIC this script does not need deleting. Set
// APP_BASE to '' and drop the Worker's root branch, and every check below
// adapts: the app is allowed to own "/" precisely when the holding page does
// not.
//
// Run with:  node scripts/verify-app-base.mjs   (needs Node >= 22)
// Wired into `pnpm test:appbase`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
// Order-sensitive in a way that can silently blank out the code being checked
// (it once did, here); the reasoning lives with the helper.
import { stripComments } from './lib/strip-comments.mjs';
import { CORE, REPO, WEB } from './lib/tree.mjs';

const root = REPO;
const basePath = join(WEB, 'src/appBase.ts');
const rootTsxPath = join(WEB, 'src/Root.tsx');
const loginPath = join(WEB, 'src/components/LoginPage.tsx');
const workerPath = join(REPO, 'worker/index.js');
const aboutPath = join(WEB, 'public/about.html');

const baseSource = readFileSync(basePath, 'utf8');
const rootTsx = readFileSync(rootTsxPath, 'utf8');
const login = readFileSync(loginPath, 'utf8');
const worker = readFileSync(workerPath, 'utf8');
const about = readFileSync(aboutPath, 'utf8');

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

// ---------------------------------------------------------------------------
// Loading src/appBase.ts into this script.
//
// The module is TypeScript and Node cannot import it, but the point of checks 1
// and 2 is to run the real functions rather than to assert things about their
// text — a regex saying stripAppBase() "looks like" it removes the prefix is
// worth very little. The annotations are therefore stripped with two narrow
// substitutions and the result is evaluated.
//
// This works because appBase.ts is deliberately plain: string constants and two
// pure functions, whose only type syntax is `: string`. Anything more (an
// interface, a generic, a satisfies clause) will make the eval throw, and the
// check below reports that as a failure telling you to keep the module simple
// or to teach this script the new syntax. Both are better than the alternative,
// which is not testing the mapping at all.
// ---------------------------------------------------------------------------
console.log('\n[load] the base module can be executed');

const stripTypes = (ts) => ts.replace(/\bexport\s+/g, '').replace(/:\s*string\b/g, '');
const stripped = stripTypes(baseSource);
check(
  'type annotations were found and removed',
  stripped !== baseSource && !/:\s*string\b/.test(stripped),
  'the strip is a no-op, so whatever is evaluated below is not this module',
);

let APP_BASE, appPath, stripAppBase;
try {
  ({ APP_BASE, appPath, stripAppBase } = new Function(
    `${stripped}\nreturn { APP_BASE, appPath, stripAppBase };`,
  )());
} catch (err) {
  check(
    'src/appBase.ts evaluates as plain JavaScript once types are stripped',
    false,
    `${err.message} — keep appBase.ts to constants and pure functions, or ` +
      'extend stripTypes() in this script',
  );
}
const loaded =
  typeof APP_BASE === 'string' &&
  typeof appPath === 'function' &&
  typeof stripAppBase === 'function';
check(
  'APP_BASE, appPath and stripAppBase are all exported',
  loaded,
  'these three names are what the rest of the app builds every URL from',
);
if (!loaded) {
  console.log('\nCANNOT CONTINUE — the base module did not load');
  process.exit(1);
}
console.log(`        APP_BASE = ${JSON.stringify(APP_BASE)}`);

// ---------------------------------------------------------------------------
// 1. The mapping. appPath() prefixes, stripAppBase() removes, and the two are
//    inverses — because Root.tsx uses one to write the URL and the other to
//    read it back, so a disagreement between them means the browser's back
//    button lands on a view the app does not think it is showing.
// ---------------------------------------------------------------------------
console.log('\n[mapping] outgoing and incoming paths are inverses');

// Every view Root.tsx can be in, spelled the way it would be if the app owned
// the root. Kept here rather than imported so that a path silently disappearing
// from navToPath() does not silently disappear from this test too.
const appPaths = [
  '/',
  '/planner',
  '/planner/abc123',
  '/saved',
  '/completed',
  '/completed/abc123',
  '/offline',
];

for (const path of appPaths) {
  const out = appPath(path);
  check(
    `appPath(${JSON.stringify(path)}) → ${JSON.stringify(out)} → back to ${JSON.stringify(path)}`,
    stripAppBase(out) === path,
    `round trip produced ${JSON.stringify(stripAppBase(out))}`,
  );
}

// The home page keeps a trailing slash, and the no-argument call is the same
// thing — Root.tsx's APP_HOME and LoginPage's AUTH_RETURN are both appPath().
check(
  'appPath() and appPath("/") agree',
  appPath() === appPath('/'),
  `${JSON.stringify(appPath())} vs ${JSON.stringify(appPath('/'))}`,
);

// A path handed over without its leading slash must not produce '/alphaplanner'.
check(
  'a leading slash is optional',
  appPath('planner') === appPath('/planner'),
  `${JSON.stringify(appPath('planner'))} vs ${JSON.stringify(appPath('/planner'))}`,
);

// Trailing slashes: '/alpha/planner/' is the same view as '/alpha/planner'.
// Before the base existed this fell through to the overview, which is the kind
// of quiet wrong answer that gets blamed on the browser.
check(
  'a trailing slash is ignored on the way in',
  stripAppBase(`${appPath('/planner')}/`) === '/planner',
  `got ${JSON.stringify(stripAppBase(`${appPath('/planner')}/`))}`,
);

// The base itself, with and without its slash, is the app's home.
if (APP_BASE) {
  check(
    `stripAppBase(${JSON.stringify(APP_BASE)}) is the home page`,
    stripAppBase(APP_BASE) === '/',
    `got ${JSON.stringify(stripAppBase(APP_BASE))} — a tester who types the ` +
      'URL without the trailing slash must still get the app',
  );
}

// Un-prefixed paths pass through, which is what keeps bookmarks made before the
// move (and any link already sent to a tester) resolving.
for (const path of ['/planner', '/saved', '/completed/abc123']) {
  check(
    `a pre-move bookmark ${JSON.stringify(path)} still resolves`,
    stripAppBase(path) === path,
    `got ${JSON.stringify(stripAppBase(path))}`,
  );
}

// Public share URLs are not under the base — a route shared with someone who
// has no invitation must not read as an alpha link — but the prefix is tolerated
// so an in-app link cannot break.
const share = '/u/kari/r/abc123';
check(
  'public share URLs are left alone',
  stripAppBase(share) === share && !appPath('/saved').includes('/u/'),
  `got ${JSON.stringify(stripAppBase(share))}`,
);
check(
  'a share URL that did pick up the base still resolves',
  stripAppBase(appPath(share)) === share,
);

// ---------------------------------------------------------------------------
// 2. The one invariant this whole script exists for: nothing the app builds may
//    be the bare root, for as long as the bare root is the holding page.
// ---------------------------------------------------------------------------
console.log('\n[home] the app never addresses the holding page');

const workerOwnsRoot = /pathname === '\/'/.test(worker);
check(
  'worker/index.js still intercepts the site root',
  workerOwnsRoot,
  'if the holding page is gone, say so: set APP_BASE to \'\' in src/appBase.ts ' +
    'and this script will expect the app at "/" instead',
);

if (workerOwnsRoot) {
  // The agreement between the two halves. This is the check that would have
  // caught the original bug on the day the Worker branch was added.
  check(
    'the Worker owns "/" and the app therefore has a base of its own',
    APP_BASE.length > 0,
    'the Worker serves coming-soon.html for "/" while the app still calls "/" ' +
      'home — every auth callback and sign-out lands on the holding page',
  );
  for (const path of [...appPaths, undefined]) {
    const out = path === undefined ? appPath() : appPath(path);
    check(
      `appPath(${JSON.stringify(path ?? null)}) is not the holding page`,
      out !== '/',
      'this path is served by public/coming-soon.html, not by the app',
    );
  }
} else {
  check(
    'with no holding page the app may own the root',
    APP_BASE.length === 0,
    `APP_BASE is ${JSON.stringify(APP_BASE)} but nothing is intercepting "/" — ` +
      'the app is then reachable at two addresses, one of which is the SPA ' +
      'fallback, and testers will bookmark whichever they were sent',
  );
}

// ---------------------------------------------------------------------------
// 3. No path is spelled as a literal. The mapping being right is worth nothing
//    if a call site bypasses it, and a bare `'/'` is the exact shape of the
//    original bug — so it is looked for across the whole frontend rather than
//    only in the two files that had it.
// ---------------------------------------------------------------------------
console.log('\n[literals] no route or redirect is hard-coded');

// Files under src/, so a new component with a new redirect is covered without
// anyone remembering to add it here — and under BOTH packages, because the
// extraction into @fjellrute/core moved the API clients out of apps/web and
// scanning only the app would have quietly narrowed this check to the half of
// the frontend that no longer contains routes/api.ts.
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}
const files = [
  ...sourceFiles(join(WEB, 'src')),
  ...sourceFiles(join(CORE, 'src')),
];

// Each pattern is a way of naming a destination. The `'/'` is what makes them
// findable: a destination built with appPath() is an identifier, never a string
// literal starting with a slash.
const literalPatterns = [
  {
    what: 'an auth callback pointing at a literal path',
    // callbackURL / errorCallbackURL / redirectTo — Better Auth's three names
    // for "where the browser comes back to". All six of these were '/'.
    re: /\b(?:error)?[cC]allbackURL\s*:\s*['"`]\//,
  },
  {
    what: 'a redirect target as a literal path',
    re: /\bredirectTo\s*:\s*['"`]\//,
  },
  {
    what: 'a history entry written as a literal path',
    // pushState/replaceState's third argument. window.location.pathname and
    // template strings built from appPath() are fine; a quoted '/…' is not.
    re: /\b(?:push|replace)State\s*\([^)]*['"`]\/[^)]*\)/,
  },
];

for (const { what, re } of literalPatterns) {
  const offenders = [];
  for (const file of files) {
    if (file === basePath) continue; // where the base is allowed to be a string
    const source = readFileSync(file, 'utf8');
    // Comments describe the old mistake on purpose (that is how a reader learns
    // why the rule exists), so only real code is scanned.
    const code = stripComments(source);
    if (re.test(code)) offenders.push(relative(root, file));
  }
  check(`${what}: none found`, offenders.length === 0, `in: ${JSON.stringify(offenders)}`);
}

// The positive form of the same rule for the two files that own routing, since
// "no literals" would also be satisfied by a file that had stopped navigating.
check(
  'src/Root.tsx builds every path with appPath()',
  /appPath\(/.test(rootTsx) && /stripAppBase\(/.test(rootTsx),
  'Root.tsx is where views become URLs; it has to go through the base',
);
{
  // navToPath() is the single function that turns a view into a URL. Every arm
  // of its switch must return appPath(...) — a `return '/saved'` would be
  // invisible to the literal patterns above, which only know about redirects.
  const fn = /function navToPath\([\s\S]*?\n}/.exec(rootTsx)?.[0] ?? '';
  const returns = [...fn.matchAll(/return\s+([^;]+);/g)].map((m) =>
    m[1].trim().replace(/\s+/g, ' '),
  );
  check(
    `all ${returns.length} navToPath() returns go through appPath()`,
    returns.length > 0 && returns.every((r) => r.startsWith('appPath(')),
    `returns: ${JSON.stringify(returns.filter((r) => !r.startsWith('appPath(')))}`,
  );
}
check(
  'src/components/LoginPage.tsx sends every auth round trip to appPath()',
  /const AUTH_RETURN = appPath\(\)/.test(login) &&
    (login.match(/AUTH_RETURN/g) ?? []).length >= 6,
  'the six callbacks are Google sign-in and its error path, sign-up, resend ' +
    'verification, and the two password-reset requests',
);

// ---------------------------------------------------------------------------
// 4. The base is the URL testers are actually given.
//
// public/about.html is the page an invitation points at, and it names the app's
// address in prose, twice, in two languages. A base that no longer matches it
// means the instruction sent to every new tester is wrong — which is a support
// problem rather than a crash, and so can run for weeks.
// ---------------------------------------------------------------------------
console.log('\n[advertised] the documented URL is the base the app uses');

// The lookahead excludes filenames: "fjellrute.no/about.html" is a page on the
// domain, not the app's address, and without it every static page in public/
// would be read as a mismatched base.
const advertised = [...about.matchAll(/fjellrute\.no(\/[\w/-]*)(?![.\w-])/g)]
  .map((m) => m[1].replace(/\/$/, ''))
  .filter((p) => p && !p.endsWith('.html'));
check(
  `public/about.html names the app's address (found ${JSON.stringify([...new Set(advertised)])})`,
  advertised.length > 0,
  'the page that tells testers where the app is should say where the app is',
);
check(
  `every advertised address is ${JSON.stringify(APP_BASE)}`,
  advertised.every((p) => p === APP_BASE),
  `mismatched: ${JSON.stringify(advertised.filter((p) => p !== APP_BASE))} — ` +
    'testers are being sent somewhere the app does not answer',
);

// ---------------------------------------------------------------------------
// Negative controls. Each mutation is a version of a mistake that has either
// already happened here or is one edit away, and each must be caught by the
// check above that claims to catch it.
// ---------------------------------------------------------------------------
console.log('\n[control] the checks detect the regressions they exist for');
{
  // THE ORIGINAL BUG: an auth callback put back to the bare root. This is what
  // sent a tester from the terms gate to "Kommer snart".
  const reverted = login.replace(/callbackURL: AUTH_RETURN/, "callbackURL: '/'");
  check(
    'an auth callback reverted to "/" is caught',
    reverted !== login &&
      literalPatterns[0].re.test(
        stripComments(reverted),
      ),
  );

  // The other half of the original bug: sign-out resetting the URL to the root.
  const revertedHistory = rootTsx.replace(
    /replaceState\(null, '', APP_HOME\)/,
    "replaceState(null, '', '/')",
  );
  check(
    'a history reset to "/" is caught',
    revertedHistory !== rootTsx &&
      literalPatterns[2].re.test(
        stripComments(revertedHistory),
      ),
  );

  // A switch arm in navToPath() going back to a literal, which no redirect
  // pattern would notice.
  const literalArm = rootTsx.replace(
    /return appPath\('\/saved'\);/,
    "return '/saved';",
  );
  const mutatedFn = /function navToPath\([\s\S]*?\n}/.exec(literalArm)?.[0] ?? '';
  check(
    'a navToPath() arm returning a literal is caught',
    literalArm !== rootTsx &&
      [...mutatedFn.matchAll(/return\s+([^;]+);/g)].some(
        (m) => !m[1].trim().startsWith('appPath('),
      ),
  );

  // The base emptied while the Worker still owns the root — i.e. someone
  // "opening up" the app without removing the holding page. This is the state
  // the repository was actually in, and the state no compiler objects to.
  const opened = stripTypes(baseSource.replace(/APP_BASE = '[^']*'/, "APP_BASE = ''"));
  const openedBase = new Function(
    `${opened}\nreturn { APP_BASE, appPath };`,
  )();
  check(
    'emptying the base while the root is still the holding page is caught',
    openedBase.APP_BASE === '' && openedBase.appPath() === '/' && workerOwnsRoot,
    'this is the combination that produced the bug; the [home] section above ' +
      'is what now refuses it',
  );

  // stripAppBase() no longer stripping — the inverse breaking on one side only,
  // which would leave deep links and the back button landing on the overview.
  const notStripping = stripTypes(
    baseSource.replace(/path = path\.slice\(APP_BASE\.length\);/, 'path = path;'),
  );
  const halfBase = new Function(
    `${notStripping}\nreturn { appPath, stripAppBase };`,
  )();
  check(
    'a stripAppBase() that stops stripping is caught',
    halfBase.stripAppBase(halfBase.appPath('/planner')) !== '/planner',
  );

  // And the advertised URL drifting away from the base, the support-desk
  // version of the same failure.
  const staleAbout = about.replace(/fjellrute\.no\/alpha\//g, 'fjellrute.no/beta/');
  const staleAdvertised = [...staleAbout.matchAll(/fjellrute\.no(\/[\w/-]*)(?![.\w-])/g)]
    .map((m) => m[1].replace(/\/$/, ''))
    .filter((p) => p && !p.endsWith('.html'));
  check(
    'an advertised URL that no longer matches the base is caught',
    staleAbout !== about && staleAdvertised.some((p) => p !== APP_BASE),
  );
}

console.log(
  failures === 0
    ? '\nALL CHECKS PASSED — the app and the holding page still agree on who owns "/"'
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
