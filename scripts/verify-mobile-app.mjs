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
// Most of what follows reads text. Two sections do not, and deliberately:
// section 9 shells out to `expo-modules-autolinking` to learn which native
// module versions Gradle would really link, and section 11 require()s
// apps/mobile/metro.config.js to read the resolved bundler config rather than
// grep its source. Both were textual first and both were wrong that way — the
// history is in the comment on each. Neither needs a device or an emulator, but
// both need node_modules installed, and both FAIL rather than skip when they
// cannot run.
//
// Run with:  node scripts/verify-mobile-app.mjs   (needs Node >= 22)
// Wired into `pnpm test:mobile`.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { MOBILE, CORE, REPO } from './lib/tree.mjs';

// metro.config.js is CommonJS and is the file Metro itself loads. Section 11
// requires it and reads the values back, so that what is asserted is the
// config Metro would actually use rather than what the source text looks like.
const require = createRequire(import.meta.url);

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
 * app.json carries `//`-prefixed comment keys — the project's way of keeping
 * rationale next to configuration in a format with no comments. They are
 * ordinary string members, so JSON.parse handles them and they are simply
 * ignored here.
 *
 * eas.json must NOT, and section 8 enforces that. EAS validates it against a
 * closed schema before a build starts and rejects unknown keys outright, so the
 * same convention that documents app.json aborts the build here with
 * `"cli.//appVersionSource" is not allowed`. That documentation lives in
 * README.md instead.
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

/**
 * Source with comments removed, for the rules that are about what the app DOES.
 *
 * Every rule below searches for string literals in a specific syntactic
 * position — after `from`, inside `require(`, and so on — and a comment can
 * contain those shapes without meaning them. This codebase explains itself at
 * unusual length, which makes that likelihood high rather than theoretical: the
 * doc comment on `Resolved` in src/config/api.ts contains the words
 * `from "on this Wi-Fi"`, and section 2 duly reported a missing dependency
 * called `on this Wi-Fi`. Rewording the sentence would have fixed that one
 * instance and left the trap for the next person writing a comment about where
 * something comes from.
 *
 * TWO RULES, AND THE SECOND ONE IS NARROW ON PURPOSE. Block comments go
 * wholesale. Line comments are removed only when they occupy a WHOLE line,
 * never as a trailing comment, because 'https://…' contains a '//' and a
 * trailing-comment rule would truncate at it — cutting the literals section 4
 * exists to find out of the text before it looks. The cost of the narrow rule
 * is that a trailing comment can still produce a phantom match; the cost of the
 * wide one is a false PASS, so the narrow rule is the right way round.
 *
 * Removing comments can only ever remove matches, never add them, so nothing
 * this makes invisible could have been a real import: those live in code.
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Bare specifiers only: './x' and '../x' are the app's own files. */
function importsIn(source) {
  const specifiers = new Set();
  const code = withoutComments(source);
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const [, spec] of code.matchAll(pattern)) {
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
  // Comments out, for the reasons given on withoutComments() above — the rules
  // below are about what the app REQUESTS, and a doc comment naming an endpoint
  // is not a second copy of it. This used to be an inline copy of that logic,
  // which meant the identical hazard existed in section 2 and was not handled
  // there; hoisting it is what fixed section 2.
  const code = withoutComments(source);
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

// ---------------------------------------------------------------------------
// 7. The build command we tell a human to type.
//
// `npx eas build` is wrong and looks right. npm resolves `eas` to a package of
// that name which is not Expo's CLI and ships no executable, so it fails with
// "could not determine executable to run" — a message that names neither the
// package nor the mistake. The CLI is `eas-cli`; the binary inside it IS called
// `eas`, which is exactly why the wrong form reads as correct.
//
// This is checked rather than merely fixed because it has now been written
// wrongly twice, in two different sessions, in two different directories, and
// the only thing that catches it is a person hitting it on their own machine
// after a five-minute install. Documented commands are as much a part of this
// app as its code, and nothing else in the repository reads them.
//
// spikes/ is in scope despite this being the mobile harness: it is the same
// command, the same trap, and it was wrong there first.
// ---------------------------------------------------------------------------

const commandDocs = [
  join(MOBILE, 'README.md'),
  join(MOBILE, 'setup.sh'),
  join(REPO, 'spikes/webview-3d/README.md'),
  join(REPO, 'spikes/webview-3d/setup.sh'),
];

const badEasInvocations = [];
for (const file of commandDocs) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    // A spike can be deleted; a missing file is not a failure here.
    continue;
  }
  text.split('\n').forEach((line, i) => {
    // `eas` not followed by the `-cli` that makes it real, AND followed by an
    // actual subcommand. That second half is what keeps this from flagging the
    // prose in these very files, which has to quote the wrong form in order to
    // warn about it — a check that cannot survive its own explanation is a
    // check nobody keeps.
    if (/\bnpx\s+eas(?!-cli)\s+(build|submit|update|login|whoami|device)\b/.test(line)) {
      badEasInvocations.push(`${relative(REPO, file)}:${i + 1}: ${line.trim()}`);
    }
  });
}

check(
  'no documented command says `npx eas` instead of `npx eas-cli`',
  badEasInvocations.length === 0,
  badEasInvocations.map((line) => `        ${line}`).join('\n') +
    '\n        npm resolves `eas` to an unrelated package with no executable\n' +
    '        and fails with "could not determine executable to run", which\n' +
    '        names nothing. The package is eas-cli; its binary is `eas`.',
);

check(
  'the map screen does not derive tile templates on its own',
  !/replace\(String\(/.test(read(MOBILE, 'app/route/[id].tsx')),
  '        Found a local copy of the sentinel-substitution trick. It belongs in\n' +
    '        packages/core/src/offline/layers.ts beside the descriptors, so the\n' +
    '        web app and the phone cannot disagree about a tile URL.',
);

// ---------------------------------------------------------------------------
// 8. eas.json carries no comment keys.
//
// app.json tolerates them: `expo config` resolves the file and passes unknown
// members through untouched, which is verifiable by running it. eas.json does
// not. EAS validates it against a closed schema BEFORE the build starts and
// rejects every unknown key, so `"//appVersionSource"` next to
// `"appVersionSource"` aborts with seven `is not allowed` lines and no build.
//
// The lesson worth encoding is not "//-keys are bad" — they document app.json
// well. It is that the convention is per-file, and eas.json is the file where
// it costs a round trip to a build server to find out. This check makes the
// cost a local test run instead. The prose it displaces lives in README.md,
// under "What is in eas.json".
// ---------------------------------------------------------------------------
const commentKeys = [];
(function walk(node, path) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  for (const key of Object.keys(node)) {
    if (key.startsWith('//')) commentKeys.push(path + key);
    walk(node[key], `${path}${key}.`);
  }
})(easJson, '');

check(
  'eas.json has no `//` comment keys, which EAS rejects outright',
  commentKeys.length === 0,
  commentKeys.map((key) => `        ${key}`).join('\n') +
    '\n        EAS schema-validates eas.json before building and refuses unknown\n' +
    '        keys: "cli.//appVersionSource is not allowed". Unlike app.json,\n' +
    '        which passes them through. Document eas.json in README.md instead.',
);

// ---------------------------------------------------------------------------
// 9. Every native module the build will link is at the version Expo pinned.
//
// The expensive one, and the reason this section exists. Expo ships
// expo/bundledNativeModules.json: the exact version of each native module that
// SDK 57 was built and tested against. Nothing enforces it. `expo install` uses
// it for packages you ask for, and `expo install --fix` re-checks the ones in
// package.json — so a module that arrives WITHOUT being declared is audited by
// nobody, and `--fix` will report the project up to date while the tree holds a
// version Expo never shipped.
//
// That is not a corner case here, it is the default: pnpm auto-installs missing
// peer dependencies, expo-router and @expo/ui declare several native modules as
// peers, and pnpm resolves each to the newest version satisfying the PEER's
// range — not Expo's pin. That put react-native-worklets 0.12.1 in the tree
// against Expo's 0.10.1, and the symptom was a C++ compiler error inside a
// package nobody had touched, five minutes into a Gradle build, naming a method
// (WorkletRuntime::executeSync) rather than a version.
//
// HOW THIS ASKS, AND THE TWO WRONG ANSWERS IT GAVE FIRST. The question "which
// versions are in the tree" has no single answer under pnpm, and guessing at it
// produced a false positive and a false negative in the same afternoon:
//
//   - Scanning every directory under node_modules/.pnpm over-reports. pnpm
//     materialises one directory per PEER COMBINATION, so four expo-router
//     variants exist while only one is reachable, and the unreachable ones hold
//     versions no build loads. This reported gesture-handler 3.2.1 as a failure
//     on a tree whose native build had just succeeded.
//   - Walking the resolved graph from apps/mobile under-reported, then
//     over-reported. It first dead-ended, because under pnpm a package's
//     dependencies are its SIBLINGS rather than its children, so a deliberately
//     corrupted nested link went unnoticed and the check passed while claiming
//     28 packages verified. Fixing the traversal then made it reach
//     react-native-drawer-layout through @expo/cli — dev-server tooling that is
//     neither bundled nor compiled — and fail on versions that cannot affect a
//     build either.
//
// So it stops guessing and asks the resolvers that actually decide. Two of them
// run, because there are two autolinking systems and only one of them owns the
// packages that broke the build:
//
//   `expo-modules-autolinking resolve`             Expo modules (expo-location,
//                                                  expo-router, @expo/ui, ...)
//   `expo-modules-autolinking react-native-config` React Native community
//                                                  modules — gesture-handler,
//                                                  reanimated, worklets,
//                                                  screens, safe-area-context,
//                                                  MapLibre
//
// Their output is what Gradle compiles, so a version reported here is a version
// that really gets built, and one they omit cannot be. Together they take under
// two seconds. Note that this means the section shells out — it is the one part
// of this file that needs node_modules installed rather than only reading text.
//
// react and react-dom are excluded deliberately. apps/web runs a newer React
// than the phone, legitimately, and neither autolinker reports them anyway.
// ---------------------------------------------------------------------------
const EXCLUDED_FROM_PIN_CHECK = new Set(['react', 'react-dom']);
const PNPM_STORE = join(REPO, 'node_modules/.pnpm');

/** Expo's pin list, found via the installed expo package rather than a path. */
function bundledNativeModules() {
  if (!existsSync(PNPM_STORE)) return null;
  for (const dir of readdirSync(PNPM_STORE)) {
    if (!dir.startsWith('expo@')) continue;
    const file = join(PNPM_STORE, dir, 'node_modules/expo/bundledNativeModules.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  }
  return null;
}

/** Does `version` satisfy Expo's pin? Only ~, ^ and exact appear in that file. */
function satisfiesPin(version, pin) {
  const want = pin.replace(/^[~^]/, '').split('.');
  const got = version.split('.');
  if (pin.startsWith('~')) return got[0] === want[0] && got[1] === want[1];
  if (pin.startsWith('^')) return got[0] === want[0];
  return version === pin;
}

/** Run an autolinking subcommand in apps/mobile and parse its JSON. */
function autolinking(subcommand) {
  try {
    const stdout = execFileSync(
      'npx',
      ['expo-modules-autolinking', subcommand, '--platform', 'android', '--json'],
      { cwd: MOBILE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 },
    );
    return { ok: true, data: JSON.parse(stdout) };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

const pins = bundledNativeModules();
const expoModules = pins === null ? null : autolinking('resolve');
const rnModules = pins === null ? null : autolinking('react-native-config');

if (pins === null) {
  check(
    'every native module the build links matches expo/bundledNativeModules.json',
    false,
    '        Could not find expo/bundledNativeModules.json under\n' +
      '        node_modules/.pnpm. Run pnpm install. This check is skipped by\n' +
      '        nobody: a missing pin list means the tree is unverifiable, not fine.',
  );
} else if (!expoModules.ok || !rnModules.ok) {
  check(
    'every native module the build links matches expo/bundledNativeModules.json',
    false,
    '        Could not ask the autolinkers what they resolve:\n' +
      `        resolve:             ${expoModules.ok ? 'ok' : expoModules.error}\n` +
      `        react-native-config: ${rnModules.ok ? 'ok' : rnModules.error}\n` +
      '        Both run in apps/mobile and need node_modules installed. An\n' +
      '        unanswerable question is not a passing check.',
  );
} else {
  // name -> { version, source }. Both autolinkers report `expo` itself, and
  // they agree on it, so last-write-wins is harmless; a real disagreement would
  // surface as a mismatch against the pin rather than being hidden.
  const linked = new Map();

  for (const module of expoModules.data.modules ?? []) {
    const { packageName: name, packageVersion: version } = module;
    if (!name || !version) continue;
    linked.set(name, { version, source: 'expo autolinking' });
  }

  for (const [name, entry] of Object.entries(rnModules.data.dependencies ?? {})) {
    const manifest = join(entry.root ?? '', 'package.json');
    if (!existsSync(manifest)) continue;
    const { version } = JSON.parse(readFileSync(manifest, 'utf8'));
    if (!version) continue;
    linked.set(name, { version, source: 'react-native autolinking' });
  }

  const checked = [...linked].filter(
    ([name]) => name in pins && !EXCLUDED_FROM_PIN_CHECK.has(name),
  );
  const wrong = checked
    .filter(([name, { version }]) => !satisfiesPin(version, pins[name]))
    .map(
      ([name, { version, source }]) =>
        `${name}: Expo pins ${pins[name]}, ${source} resolved ${version}`,
    );

  // An empty list would mean the autolinkers answered but named nothing this
  // file pins, which is not a clean tree — it is a query that stopped working.
  check(
    `every native module the build links matches expo/bundledNativeModules.json (${checked.length} linked)`,
    wrong.length === 0 && checked.length > 0,
    (checked.length === 0
      ? '        The autolinkers reported no package that appears in\n' +
        '        bundledNativeModules.json. That is not a clean tree, it is a\n' +
        '        broken query — check the --json output shape has not changed.'
      : wrong.map((line) => `        ${line}`).join('\n') +
        '\n        These are what Gradle will compile, so a version Expo did not\n' +
        '        ship can fail in the C++ compiler regardless of what any\n' +
        '        JavaScript imports. Declare the package in\n' +
        '        apps/mobile/package.json at the pinned version and add a\n' +
        '        pnpm.overrides entry at the root, then pnpm install.'),
  );
}

// ---------------------------------------------------------------------------
// 10. No manifest carries a `//` comment key inside a dependency map.
//
// Section 8's lesson, one file over, learned the hard way a second time. The
// `//key` convention is per-FILE, and it is also per-LOCATION: pnpm reads the
// keys of `dependencies`, `devDependencies`, `peerDependencies` and
// `optionalDependencies` as package names. A `"//react-native-gesture-handler"`
// sitting above the entry it documents is not a comment, it is a request to
// install a package called `//react-native-gesture-handler`, and pnpm aborts
// the ENTIRE workspace install with ERR_PNPM_INVALID_PACKAGE_NAME — not just
// that package, not just that project.
//
// The root manifest has carried a written warning about exactly this since the
// better-auth pinning work, in `//dependencies`. apps/mobile/package.json broke
// it anyway, in a commit whose whole purpose was to pin native modules, and the
// failure surfaced on the user's machine rather than here. A rule that is
// written down but not enforced is a rule that gets broken by whoever is
// concentrating on something else, which is everyone eventually. Hence a test.
//
// Comments about dependencies belong at the top level of the manifest, where
// npm and pnpm both ignore unknown members: `//nativeModules`, `//dependencies`.
// ---------------------------------------------------------------------------
const DEPENDENCY_MAPS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

const manifests = [
  ['package.json', rootPkg],
  ['apps/mobile/package.json', mobilePkg],
];
for (const rel of ['apps/web/package.json', 'packages/core/package.json']) {
  const file = join(REPO, rel);
  if (existsSync(file)) manifests.push([rel, JSON.parse(readFileSync(file, 'utf8'))]);
}

const commentedDeps = [];
for (const [rel, manifest] of manifests) {
  for (const map of DEPENDENCY_MAPS) {
    for (const name of Object.keys(manifest[map] ?? {})) {
      if (name.startsWith('//')) commentedDeps.push(`${rel} → ${map}.${name}`);
    }
  }
}

check(
  `no manifest has a \`//\` key inside a dependency map (${manifests.length} checked)`,
  commentedDeps.length === 0,
  commentedDeps.map((line) => `        ${line}`).join('\n') +
    '\n        pnpm reads these as package names and fails the whole workspace\n' +
    '        install with ERR_PNPM_INVALID_PACKAGE_NAME. Move the comment to a\n' +
    '        top-level key such as "//dependencies", which both npm and pnpm\n' +
    '        ignore.',
);

// ---------------------------------------------------------------------------
// 11. Metro still resolves the way pnpm expects.
//
// This app is bundled by Metro out of a pnpm workspace, and the two disagree
// about where packages live unless metro.config.js says otherwise. The settings
// that matter are asserted here against the RESOLVED config — the file is
// require()d and the values read back — rather than by grepping the source, so
// a setting reintroduced through a spread, a helper or an Expo default is
// caught just the same.
//
// disableHierarchicalLookup is the one that has actually broken a build.
// Expo's monorepo documentation recommends it, which makes it look blessed, but
// that documentation assumes npm or yarn, where hoisting leaves the root
// node_modules flat and complete. pnpm instead gives every resolved package its
// own directory under node_modules/.pnpm holding exactly the dependencies that
// package should see. Turning off the upward walk makes those directories
// unreachable, so any module a DEPENDENCY imports — as opposed to one this app
// declares — fails to resolve. expo-router importing `@expo/metro-runtime`
// returned HTTP 500 from the dev server on a device, after a nine-minute native
// build, with the file present and correctly linked the whole time.
//
// watchFolders must include the workspace root or edits in packages/core do not
// reload, and nodeModulesPaths must name the app's own directory before the
// root's so a version this app pins beats a hoisted one.
// ---------------------------------------------------------------------------
let metroConfig = null;
let metroError = null;
try {
  metroConfig = require(join(MOBILE, 'metro.config.js'));
} catch (error) {
  metroError = error;
}

check(
  'metro.config.js loads',
  metroConfig !== null,
  `        require() threw: ${metroError?.message ?? 'unknown'}\n` +
    '        Metro reads this file on every bundle, so a config that does not\n' +
    '        load is a dev server that does not start.',
);

if (metroConfig !== null) {
  check(
    'Metro does not disable hierarchical lookup, which pnpm needs',
    metroConfig.resolver?.disableHierarchicalLookup !== true,
    '        config.resolver.disableHierarchicalLookup === true.\n' +
      '        Expo documents this for monorepos, but it assumes a hoisting\n' +
      '        package manager. Under pnpm it makes node_modules/.pnpm/<pkg>/\n' +
      '        unreachable, so anything a dependency imports rather than this\n' +
      '        app declaring it fails to resolve — expo-router importing\n' +
      '        @expo/metro-runtime returned a 500 from the dev server.\n' +
      '        See the comment in metro.config.js before changing this.',
  );

  const watched = (metroConfig.watchFolders ?? []).map((dir) => resolve(dir));
  check(
    'Metro watches the workspace root, so packages/core hot-reloads',
    watched.includes(resolve(REPO)),
    `        watchFolders: ${JSON.stringify(watched)}\n` +
      '        packages/core lives outside this app. Without the workspace root\n' +
      '        here, an edit there does not reload on the phone and a cold start\n' +
      "        reports the package missing.",
  );

  const modulePaths = (metroConfig.resolver?.nodeModulesPaths ?? []).map((dir) => resolve(dir));
  check(
    "Metro prefers this app's node_modules over the workspace root's",
    modulePaths.indexOf(resolve(MOBILE, 'node_modules')) === 0 &&
      modulePaths.includes(resolve(REPO, 'node_modules')),
    `        nodeModulesPaths: ${JSON.stringify(modulePaths)}\n` +
      "        Both must be present, app first: a version this app pins has to\n" +
      '        win over a hoisted one.',
  );
}

// ---------------------------------------------------------------------------
// 12. The phone and the dev Worker describe the same backend.
// ---------------------------------------------------------------------------
//
// The phone's default backend is the deployed dev Worker — `env.dev` in
// wrangler.jsonc, published as `fjellrute-dev`. Two files have to agree about
// it, in a way neither language can enforce: src/config/api.ts holds the URL as
// a string literal (nothing in a React Native bundle can read wrangler.jsonc),
// and wrangler.jsonc decides the Worker's name, which IS the first label of
// that URL. Rename the Worker and the phone keeps asking for a hostname that
// stopped resolving — presenting as the app's ordinary "could not reach the
// backend", i.e. as the failure it always shows when anything is wrong.
//
// The rest of this section is about the environment being a COMPLETE
// description rather than a partial one. Wrangler splits config into
// inheritable keys and non-inheritable ones, and an environment that omits a
// non-inheritable key gets nothing rather than the top-level value. Wrangler
// warns for `vars` specifically; it says nothing about a missing `assets`,
// `r2_buckets` or `d1_databases`. Those deploy in silence and fail at runtime —
// a Worker serving no static files at all, or with no database bound. Every one
// of them was written out by hand here, so every one of them can be forgotten
// by hand later, which is what this checks.

/** wrangler.jsonc, as an object. */
function parseJsonc(source) {
  // A real JSONC parser is a dependency this repo does not have, and wrangler's
  // own is not exposed. So: drop comments, drop trailing commas, JSON.parse.
  // The scanner is string-aware because it has to be — every https:// URL in
  // that file contains a '//', and a naive comment strip truncates the config
  // at the first one.
  let out = '';
  let i = 0;
  let inString = false;
  while (i < source.length) {
    const c = source[i];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += source[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

let wrangler = null;
let wranglerError = null;
try {
  wrangler = parseJsonc(read(REPO, 'wrangler.jsonc'));
} catch (error) {
  wranglerError = error?.message ?? String(error);
}

check(
  'wrangler.jsonc parses',
  wrangler !== null,
  `        ${wranglerError}\n` +
    '        Everything below reads this file. Note that the parser here is\n' +
    '        this harness\u2019s own comment-stripper, so a failure means either\n' +
    '        the config is genuinely malformed or the stripper met syntax it\n' +
    '        does not handle. `npx wrangler deploy --dry-run --env dev` is the\n' +
    '        authority on which.',
);

if (wrangler !== null) {
  const devEnv = wrangler.env?.dev ?? null;

  check(
    'wrangler.jsonc defines the `dev` environment the phone points at',
    devEnv !== null,
    '        Expected env.dev — the `fjellrute-dev` Worker. src/config/api.ts\n' +
      '        defaults DEVELOPMENT_TARGET to \u2019dev-worker\u2019, so without this\n' +
      '        environment there is nothing to deploy and the app has no backend.',
  );

  if (devEnv !== null) {
    const apiSource = read(MOBILE, 'src/config/api.ts');
    const declared = /const DEV_WORKER_API = '([^']+)'/.exec(apiSource);
    let devHost = null;
    try {
      devHost = declared === null ? null : new URL(declared[1]).hostname;
    } catch {
      devHost = null;
    }

    check(
      'src/config/api.ts declares DEV_WORKER_API as a parseable https URL',
      devHost !== null && declared[1].startsWith('https://'),
      `        Found: ${declared === null ? '(no DEV_WORKER_API)' : declared[1]}\n` +
        '        Expected a single-quoted absolute https URL. This is read by\n' +
        '        regex because the file imports React Native modules and cannot\n' +
        '        be require()d from Node, so the literal has to stay literal.',
    );

    if (devHost !== null) {
      check(
        `DEV_WORKER_API's hostname starts with the Worker's name (${devEnv.name})`,
        typeof devEnv.name === 'string' && devHost.startsWith(`${devEnv.name}.`),
        `        api.ts host: ${devHost}\n` +
          `        env.dev.name: ${devEnv.name}\n` +
          '        A workers.dev hostname is "<worker name>.<subdomain>". These\n' +
          '        two drifting apart is not a build error and not a lint error:\n' +
          '        the phone simply cannot resolve the host, which it reports as\n' +
          '        the same "could not reach the backend" it shows for every\n' +
          '        other cause.',
      );

      check(
        'DEV_WORKER_API is a workers.dev host, not the production domain',
        devHost.endsWith('.workers.dev'),
        `        api.ts host: ${devHost}\n` +
          '        env.dev has no custom domain (workers_dev: true is what gives\n' +
          '        it an address). A production hostname here would point the\n' +
          '        phone at the database holding real accounts, which is the one\n' +
          '        thing this environment exists to prevent.',
      );
    }

    // Non-inheritable keys, by name. `vars` is compared key by key rather than
    // wholesale because the VALUES are legitimately allowed to differ between
    // environments — that is what environments are for — while a var present in
    // one and absent from the other is almost always an oversight.
    const missingKeys = ['vars', 'd1_databases', 'r2_buckets', 'assets'].filter(
      (key) => wrangler[key] !== undefined && devEnv[key] === undefined,
    );
    check(
      'env.dev repeats every non-inheritable key the top level defines',
      missingKeys.length === 0,
      `        Missing from env.dev: ${missingKeys.join(', ')}\n` +
        '        These are NOT inherited. An environment that omits one gets\n' +
        '        nothing, not the top-level value — a Worker with no database\n' +
        '        bound, or one that serves no static files while answering\n' +
        '        /api/* perfectly. Wrangler warns about `vars` and is silent\n' +
        '        about the other three.',
    );

    const missingVars = Object.keys(wrangler.vars ?? {}).filter(
      (name) => !(name in (devEnv.vars ?? {})),
    );
    check(
      'env.dev.vars names every var production names',
      missingVars.length === 0,
      `        Missing from env.dev.vars: ${missingVars.join(', ')}\n` +
        '        Values may differ between environments; presence should not.\n' +
        '        If one is deliberately unset, say so in a comment there — and\n' +
        '        prefer withholding the matching SECRET, which does not make\n' +
        '        `wrangler deploy` print a warning on every run.',
    );

    const prodDb = wrangler.d1_databases?.[0] ?? {};
    const devDb = devEnv.d1_databases?.[0] ?? {};
    check(
      'env.dev binds a DIFFERENT D1 database from production',
      typeof devDb.database_name === 'string' &&
        devDb.database_name !== prodDb.database_name &&
        devDb.database_id !== prodDb.database_id,
      `        production: ${prodDb.database_name} (${prodDb.database_id})\n` +
        `        dev:        ${devDb.database_name} (${devDb.database_id})\n` +
        '        The separate database IS the reason this environment exists\n' +
        '        rather than the phone being pointed at fjellrute.no. Sharing\n' +
        '        it would put throwaway signups next to real accounts and GPS\n' +
        '        tracks, and there is no way to tell them apart afterwards.',
    );

    check(
      'env.dev binds D1 under the same name the Worker reads (DB)',
      devDb.binding === 'DB',
      `        env.dev binding: ${devDb.binding}\n` +
        '        worker/ reaches the database through env.DB throughout. A\n' +
        '        different binding name deploys fine and 500s on first query.',
    );

    check(
      'env.dev runs no cron',
      Array.isArray(devEnv.triggers?.crons) && devEnv.triggers.crons.length === 0,
      `        env.dev.triggers.crons: ${JSON.stringify(devEnv.triggers?.crons)}\n` +
        '        Must be an EMPTY array, not absent: `triggers` is inheritable,\n' +
        "        so omitting it gives this Worker production's 03:47 retention\n" +
        '        sweep. It would only ever touch its own database, so this is\n' +
        '        about a daily scheduled run against a database nobody watches\n' +
        '        looking like activity in the logs.',
    );

    // Not a failure. The id is a value only Cloudflare can produce, so the
    // committed state of this file is necessarily a placeholder, and a check
    // that failed on it would make `pnpm test` red for a step that has to be
    // done by hand with credentials this harness does not have. Saying so out
    // loud is the compromise — a placeholder that is never mentioned is one
    // that gets discovered by a deploy.
    if (typeof devDb.database_id === 'string' && !/^[0-9a-f-]{36}$/.test(devDb.database_id)) {
      console.log(
        `  note   env.dev's database_id is still a placeholder (${devDb.database_id}).\n` +
          '         The dev Worker cannot be deployed until it is real:\n' +
          '           npx wrangler d1 create fjellrute-db-dev-eu --jurisdiction eu\n' +
          '         then paste the printed id into wrangler.jsonc. Not a failure —\n' +
          '         only Cloudflare can produce that value.',
      );
    }
  }
}

console.log(
  failures === 0
    ? '\nAll mobile app checks passed.\n'
    : `\n${failures} mobile app check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
