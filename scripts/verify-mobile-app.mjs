// Guards the four things about the phone app that break silently.
//
// WHY A SCRIPT. Nothing else in this repository can see these. `tsc --noEmit`
// in apps/mobile type-checks the code but knows nothing about app.json,
// eas.json, setup.sh or worker/auth.js — and every failure below is a
// disagreement BETWEEN two of those files, each of which is individually
// correct. The whole class is invisible to a compiler and expensive on a device,
// because the symptom never names the cause:
//
//   1. THE SCHEME. Better Auth's Expo client sends the deep-link scheme as the
//      request origin. It is written in app.json, in worker/auth.js's
//      trustedOrigins, and in the client. If they disagree, what fails is the
//      CSRF check — so a correct password is rejected, and the app looks like it
//      has an authentication bug rather than a typo. This one cost an evening
//      elsewhere in the project as an inferred version number; there is no
//      reason to relearn it as an inferred string.
//
//   2. AN UNDECLARED IMPORT. Every native package the app uses is installed by
//      setup.sh (through `expo install`, so the version matches the SDK) rather
//      than written into package.json. That is deliberate — see the //versions
//      comment there — but it means importing a package is no longer the same
//      act as declaring it. An import that setup.sh does not install works
//      perfectly on the machine that once installed it by hand and fails on
//      every other, at bundle time, deep inside Metro's resolver.
//
//   3. A HOST WRITTEN TWICE. src/config/api.ts is the app's single decision
//      about which backend it talks to. A second URL literal anywhere else is
//      how you get a screen that still points at production after the switch,
//      and it presents as one feature being mysteriously stale.
//
//   4. A CORE SUBPATH THAT ISN'T EXPORTED. packages/core's exports map is
//      hand-written with no wildcard, so importing a file that exists but was
//      never listed resolves in an editor (the tsconfig paths mapping) and
//      fails in Metro. verify-core-package.mjs checks the map is internally
//      valid; this checks the phone only asks for things in it.
//
// It also asserts the Phase 3/4 boundary in app.json: no background-location
// permission until something records a track. Asking for it early means a
// prompt the user cannot connect to a feature, and Play requires a
// justification video for it.
//
// Run with:  node scripts/verify-mobile-app.mjs   (needs Node >= 22)
// Wired into `pnpm test:mobile`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MOBILE, CORE, REPO } from './lib/tree.mjs';

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    if (detail) console.log(detail);
  }
};

const read = (...parts) => readFileSync(join(...parts), 'utf8');

/**
 * app.json and eas.json carry `//`-prefixed comment keys — the project's way of
 * keeping rationale next to configuration in a format with no comments. They
 * are ordinary string members, so JSON.parse handles them and they are simply
 * ignored here.
 */
const appJson = JSON.parse(read(MOBILE, 'app.json'));
const easJson = JSON.parse(read(MOBILE, 'eas.json'));
const mobilePkg = JSON.parse(read(MOBILE, 'package.json'));
const corePkg = JSON.parse(read(CORE, 'package.json'));
const rootPkg = JSON.parse(read(REPO, 'package.json'));
const setupSh = read(MOBILE, 'setup.sh');
const workerAuth = read(REPO, 'worker/auth.js');

/** Every .ts/.tsx under a directory, as absolute paths. */
function sourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.expo') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = [
  ...sourceFiles(join(MOBILE, 'app')),
  ...sourceFiles(join(MOBILE, 'src')),
];
const rel = (f) => relative(REPO, f);

console.log('\nMobile app\n');

check(
  'the app has source files to check',
  files.length > 0,
  '        apps/mobile/app and apps/mobile/src are both empty — this harness\n' +
    '        would pass vacuously, which is worse than failing.',
);

// ---------------------------------------------------------------------------
// 1. One deep-link scheme, spelled the same in three places.
// ---------------------------------------------------------------------------

const declaredScheme = appJson.expo?.scheme ?? null;

check(
  'app.json declares a deep-link scheme',
  typeof declaredScheme === 'string' && declaredScheme.length > 0,
  '        expo.scheme is missing. Without it the auth client has no origin to\n' +
    '        send and expo-linking cannot resolve a callback.',
);

// worker/auth.js: `export const MOBILE_SCHEME = 'fjellrute';`
const workerScheme =
  /MOBILE_SCHEME\s*=\s*['"]([^'"]+)['"]/.exec(workerAuth)?.[1] ?? null;
check(
  'worker/auth.js exports MOBILE_SCHEME',
  workerScheme !== null,
  '        The server half has to name the scheme so it can be listed in\n' +
    '        trustedOrigins. Searched for MOBILE_SCHEME = \'…\'.',
);

const clientSource = read(MOBILE, 'src/auth/client.ts');
const clientScheme =
  /MOBILE_SCHEME\s*=\s*['"]([^'"]+)['"]/.exec(clientSource)?.[1] ?? null;
check(
  'src/auth/client.ts names the scheme',
  clientScheme !== null,
  '        Searched for MOBILE_SCHEME = \'…\' in the auth client.',
);

check(
  'all three copies of the scheme agree',
  declaredScheme !== null &&
    declaredScheme === workerScheme &&
    declaredScheme === clientScheme,
  `        app.json:              ${declaredScheme}\n` +
    `        worker/auth.js:        ${workerScheme}\n` +
    `        src/auth/client.ts:    ${clientScheme}\n` +
    '        A mismatch fails Better Auth\'s CSRF check, which surfaces as a\n' +
    '        correct password being rejected — not as a configuration error.',
);

check(
  'the Worker trusts the scheme as an origin',
  workerScheme !== null &&
    new RegExp(`\\$\\{MOBILE_SCHEME\\}://|['"\`]${workerScheme}://`).test(
      workerAuth,
    ),
  '        trustedOrigins in worker/auth.js does not list the mobile scheme.\n' +
    '        Every request from the phone would fail the CSRF check.',
);

check(
  'the Worker registers the Better Auth expo plugin',
  /@better-auth\/expo/.test(workerAuth) && /\bexpo\(\)/.test(workerAuth),
  '        worker/auth.js must import { expo } from \'@better-auth/expo\' and\n' +
    '        include expo() in the plugins array, or the phone\'s cookie-less\n' +
    '        session handling is not served.',
);

check(
  '@better-auth/expo matches better-auth\'s version at the root',
  rootPkg.dependencies?.['@better-auth/expo'] !== undefined &&
    rootPkg.dependencies['@better-auth/expo'] ===
      rootPkg.dependencies['better-auth'],
  `        better-auth:        ${rootPkg.dependencies?.['better-auth']}\n` +
    `        @better-auth/expo:  ${rootPkg.dependencies?.['@better-auth/expo']}\n` +
    '        The plugin and the core package share internals and are released\n' +
    '        together; a version skew fails at runtime, not at install.',
);

// ---------------------------------------------------------------------------
// 2. Every imported package is actually installed by something.
// ---------------------------------------------------------------------------

/**
 * The packages setup.sh installs. Parsed rather than duplicated, because a
 * hard-coded list here would be a fifth place to keep in sync — the exact
 * problem this file exists to catch.
 */
function packagesInstalledBySetup(script) {
  const found = new Set();
  for (const line of script.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    if (!/^(npx expo install|pnpm add)\b/.test(trimmed)) continue;
    const args = trimmed
      .replace(/^npx expo install\b/, '')
      .replace(/^pnpm add\b/, '')
      .replace(/["']/g, '')
      .split(/\s+/)
      .filter(Boolean);
    for (const arg of args) {
      if (arg.startsWith('-')) continue; // flags, e.g. --fix
      // Strip a version suffix: 'better-auth@1.2.3' or the shell expansion
      // '@better-auth/expo@${root_version}'. The separator is the LAST '@'
      // that is not the leading scope marker.
      const at = arg.lastIndexOf('@');
      const name = at > 0 ? arg.slice(0, at) : arg;
      if (name.startsWith('$')) continue;
      found.add(name);
    }
  }
  return found;
}

const fromSetup = packagesInstalledBySetup(setupSh);
check(
  'setup.sh installs a plausible number of packages',
  fromSetup.size >= 8,
  `        Parsed only ${fromSetup.size}: ${[...fromSetup].join(', ') || '(none)'}\n` +
    '        The parser above found almost nothing, which would make the import\n' +
    '        check below fail for every package. Fix the parser, not setup.sh.',
);

const declared = new Set([
  ...Object.keys(mobilePkg.dependencies ?? {}),
  ...Object.keys(mobilePkg.devDependencies ?? {}),
  ...fromSetup,
  // Provided transitively and unavoidably: React Native re-exports these, and
  // expo-router's own peers surface as subpath imports.
  'react',
  'react-native',
  'expo',
]);

/** Bare specifiers only: './x' and '../x' are the app's own files. */
function importsIn(source) {
  const specifiers = new Set();
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const [, spec] of source.matchAll(pattern)) {
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      specifiers.add(spec);
    }
  }
  return specifiers;
}

/** '@scope/name/sub' → '@scope/name'; 'name/sub' → 'name'. */
function packageOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const undeclared = [];
const coreSubpaths = new Map();
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const specifier of importsIn(source)) {
    const pkg = packageOf(specifier);
    if (pkg === '@fjellrute/core') {
      const existing = coreSubpaths.get(specifier) ?? [];
      existing.push(rel(file));
      coreSubpaths.set(specifier, existing);
      continue;
    }
    if (!declared.has(pkg)) undeclared.push(`${pkg}  (${rel(file)})`);
  }
}

check(
  'every imported package is installed by package.json or setup.sh',
  undeclared.length === 0,
  undeclared.map((line) => `        ${line}`).join('\n') +
    '\n        Add it to the right `expo install` group in setup.sh. Not to\n' +
    '        package.json: for a native module the correct version is a\n' +
    '        function of the SDK version, and `expo install` is what knows it.',
);

// ---------------------------------------------------------------------------
// 3. Every @fjellrute/core import is in the exports map.
// ---------------------------------------------------------------------------

const exported = new Set(
  Object.keys(corePkg.exports ?? {}).map((key) =>
    key.replace(/^\./, '@fjellrute/core'),
  ),
);

const unexported = [...coreSubpaths.entries()].filter(
  ([specifier]) => !exported.has(specifier),
);

check(
  'every @fjellrute/core import is a listed subpath',
  unexported.length === 0,
  unexported
    .map(([specifier, where]) => `        ${specifier}  (${where.join(', ')})`)
    .join('\n') +
    '\n        The exports map has no wildcard, deliberately. An unlisted\n' +
    '        subpath resolves in an editor via the tsconfig paths mapping and\n' +
    '        then fails in Metro, so this cannot be caught by type-checking.',
);

check(
  'the app actually uses the shared package',
  coreSubpaths.size >= 3,
  `        Only ${coreSubpaths.size} core subpath(s) imported. The point of the\n` +
    '        phone app is that it shares geometry, the routes client, i18n and\n' +
    '        the layer descriptors rather than reimplementing them.',
);

// ---------------------------------------------------------------------------
// 4. One place decides the backend host.
// ---------------------------------------------------------------------------

const HOST_LITERAL = /['"`]https?:\/\/[^'"`]+['"`]/g;
const API_PATH_LITERAL = /['"`]\/api\/[^'"`]*['"`]/g;
const CONFIG = join(MOBILE, 'src/config/api.ts');

const strayHosts = [];
const strayApiPaths = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  // Strip comments before searching. Both kinds, because the two rules below
  // are about what the app REQUESTS, and this codebase explains itself at
  // length — a doc comment that says which endpoint a header is for would
  // otherwise read as a second copy of that endpoint.
  //
  // Whole-line `//` only, never a trailing one: 'https://…' contains a '//'
  // and a trailing-comment rule would truncate the very literals rule 4 exists
  // to find. Block comments are removed wholesale; nothing in this app has a
  // string containing '/*', and if one ever does, the failure is a false PASS
  // on the following lines, so keep this in mind rather than relying on it.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  if (file !== CONFIG) {
    for (const [match] of code.matchAll(HOST_LITERAL)) {
      strayHosts.push(`${match}  (${rel(file)})`);
    }
  }
  for (const [match] of code.matchAll(API_PATH_LITERAL)) {
    strayApiPaths.push(`${match}  (${rel(file)})`);
  }
}

check(
  'no backend host is written outside src/config/api.ts',
  strayHosts.length === 0,
  strayHosts.map((line) => `        ${line}`).join('\n') +
    '\n        src/config/api.ts is the single decision about which backend this\n' +
    '        build talks to. A second literal is how one screen keeps pointing\n' +
    '        at production after the switch.',
);

check(
  'no /api/ path is written in the app',
  strayApiPaths.length === 0,
  strayApiPaths.map((line) => `        ${line}`).join('\n') +
    '\n        Endpoints belong in @fjellrute/core, where the web app and the\n' +
    '        phone share one client and one storage format.',
);

check(
  'src/config/api.ts refuses to use a development host in a release build',
  /!__DEV__/.test(read(MOBILE, 'src/config/api.ts')),
  '        Expected a `!__DEV__` guard returning the production host. Without\n' +
    '        it a shipped build can be aimed at a laptop IP by a debug flag.',
);

// ---------------------------------------------------------------------------
// 5. The Phase 3/4 permission boundary, and the build profile.
// ---------------------------------------------------------------------------

const androidPermissions = appJson.expo?.android?.permissions ?? [];

check(
  'foreground location is requested',
  androidPermissions.includes('ACCESS_FINE_LOCATION'),
  '        The position marker needs ACCESS_FINE_LOCATION in app.json.',
);

check(
  'background location is not requested yet',
  !androidPermissions.some((p) => /BACKGROUND_LOCATION|FOREGROUND_SERVICE/.test(p)),
  `        Found: ${androidPermissions.join(', ')}\n` +
    '        Background location belongs to the phase that records a track.\n' +
    '        Asking earlier means a prompt the user cannot connect to a\n' +
    '        feature, and Play requires a justification video for it.',
);

check(
  'iOS states why it wants location',
  typeof appJson.expo?.ios?.infoPlist?.NSLocationWhenInUseUsageDescription ===
    'string',
  '        iOS rejects a build with no usage description, at submission time.',
);

check(
  'the MapLibre config plugin is registered',
  (appJson.expo?.plugins ?? []).includes('@maplibre/maplibre-react-native'),
  '        Without the plugin the iOS build fails at `pod install` rather than\n' +
    '        at runtime, because nothing adds $MLRN.post_install to the Podfile.',
);

const dev = easJson.build?.development;
check(
  'eas.json has a development profile that builds an installable APK',
  dev?.developmentClient === true && dev?.android?.buildType === 'apk',
  '        developmentClient must be true (so the binary loads JS from Metro\n' +
    '        instead of shipping a frozen bundle) and the Android output must be\n' +
    '        apk, because an .aab can only be installed through Play.',
);

check(
  'apps/mobile is not a project reference of the root tsconfig',
  !/apps\/mobile/.test(read(REPO, 'tsconfig.json')),
  '        The root solution compiles packages/core with `types: []` so a stray\n' +
    '        `document` fails there. Adding this app would put React Native\'s\n' +
    '        types into the same solution and the boundary would stop meaning\n' +
    '        anything. The app type-checks on its own: pnpm -C apps/mobile\n' +
    '        typecheck.',
);

// ---------------------------------------------------------------------------
// 6. The tile URL templates the map screen hands to MapLibre.
//
// The only check in this file that RUNS code rather than reading it, and the
// only one that could not be a string comparison. core's descriptors expose
// `tileUrl` as a function; MapLibre needs a `{z}/{x}/{y}` template;
// `tileUrlTemplate` recovers one from the other by calling the function with
// sentinel coordinates and substituting them back out. That is string surgery
// on a URL nobody here controls, and its failure mode is a template that looks
// entirely plausible and 404s for every tile — a blank map, nothing logged.
//
// Bundled with esbuild rather than imported: core's internal imports are a mix
// of extensionless and `.ts`, which Metro and Vite both resolve and bare Node
// does not. Same approach, for the same reason, as verify-parking-signs.mjs.
// ---------------------------------------------------------------------------

const { OFFLINE_LAYERS: liveLayers, tileUrlTemplate } = await (async () => {
  const { build } = await import('esbuild');
  const outfile = join(REPO, 'node_modules/.tmp/verify-mobile-layers.mjs');
  await build({
    entryPoints: [join(CORE, 'src/offline/layers.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
  });
  return import(`${outfile}?v=${Date.now()}`);
})();

for (const id of ['topo', 'steepness']) {
  let template = null;
  let error = null;
  try {
    template = tileUrlTemplate(liveLayers[id]);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  // A ROUND TRIP, not a shape check — and that distinction is the whole value
  // of this test. Counting placeholders passes a template with `{x}` planted in
  // the middle of Kartverket's `/1.0.0/` version segment, which is exactly what
  // a badly chosen sentinel produces. Filling the template back in and
  // comparing against the function it came from cannot be fooled that way: if
  // the two disagree for one coordinate triple they are not the same URL.
  //
  // Deliberately checked here as well as inside tileUrlTemplate, because the
  // assertion in core is itself a line of code someone can delete.
  const filled =
    typeof template === 'string'
      ? template.replace('{z}', '9').replace('{x}', '523').replace('{y}', '287')
      : null;
  const ok =
    typeof template === 'string' &&
    template.startsWith('https://') &&
    ['{z}', '{x}', '{y}'].every((p) => template.split(p).length === 2) &&
    filled === liveLayers[id].tileUrl(9, 523, 287);
  check(
    `the ${id} layer yields a usable XYZ tile template`,
    ok,
    `        Template: ${error ?? template}\n` +
      `        Expands to: ${filled}\n` +
      `        tileUrl gives: ${liveLayers[id].tileUrl(9, 523, 287)}\n` +
      '        The map screen passes the template straight to MapLibre as\n' +
      '        `tiles`. One that does not expand to the same URL the downloader\n' +
      '        would fetch returns 404 for every tile: a blank map, no error.',
  );
}

check(
  'a layer with no XYZ template is rejected rather than mangled',
  (() => {
    try {
      // snowdepth is a WMS GetMap with a computed bbox — the sentinels land
      // inside a BBOX parameter and there is no template to recover. Returning
      // a plausible-looking string would be worse than throwing.
      tileUrlTemplate(liveLayers.snowdepth);
      return false;
    } catch {
      return true;
    }
  })(),
  '        tileUrlTemplate(snowdepth) returned a string. It must throw: that\n' +
    '        URL encodes a bounding box, so any template derived from it is\n' +
    '        nonsense that would only be discovered on a phone.',
);

check(
  'the map screen does not derive tile templates on its own',
  !/replace\(String\(/.test(read(MOBILE, 'app/route/[id].tsx')),
  '        Found a local copy of the sentinel-substitution trick. It belongs in\n' +
    '        packages/core/src/offline/layers.ts beside the descriptors, so the\n' +
    '        web app and the phone cannot disagree about a tile URL.',
);

console.log(
  failures === 0
    ? '\nAll mobile app checks passed.\n'
    : `\n${failures} mobile app check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
