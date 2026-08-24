// Guards the policy-acceptance mechanism (migration 0007, worker/policies.js,
// the re-acceptance gate in src/Root.tsx).
//
// Privacy policy §8 promises that a material change to the terms or the
// privacy policy is put in front of the user again instead of taking effect
// quietly. Keeping that promise depends on a handful of invariants spread over
// six files, none of which a type checker or a build can notice breaking:
//
//   * the version the Worker records must be the version the app displays,
//   * the version must come from the server, never from the request,
//   * the migration must not default the columns to the current version,
//     which would silently manufacture consent for existing accounts,
//   * and an unknown answer must not gate, or a lost connection locks people
//     out of their own route library.
//
// Each of those has a plausible, quiet failure mode — bump one version
// constant and forget the other and every signed-in user is either permanently
// gated or never gated again — so each gets a check here.
//
// Run with:  node scripts/verify-policy-acceptance.mjs   (needs Node >= 22)
// Wired into `pnpm test:policies`, alongside the SQL half in
// scripts/verify-policy-sql.py.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, WEB } from './lib/tree.mjs';
import { ensureTypeStripping } from './lib/type-stripping.mjs';

// Before the first `await import` of a .ts file below. See the helper.
ensureTypeStripping();

const root = REPO;
const read = (p) => readFileSync(join(REPO, p), 'utf8');
// src/ lives in apps/web since the workspace split; worker/ and migrations/
// stayed at the root. See scripts/lib/tree.mjs.
const readWeb = (p) => readFileSync(join(WEB, p), 'utf8');

const authJs = read('worker/auth.js');
const policiesJs = read('worker/policies.js');
const indexJs = read('worker/index.js');
const apiTs = readWeb('src/public/api.ts');
const rootTsx = readWeb('src/Root.tsx');
const migration = read('migrations/0007_policy_acceptance.sql');

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
// 1. The two copies of each version string.
//
// The Worker cannot import the TypeScript documents, so it keeps its own copy
// (worker/policyVersions.js) and the two are shipped by the same deploy. In
// the repository they drift trivially: bumping the text without bumping the
// Worker means the app shows a new policy and records the old version, so the
// gate never clears — every signed-in user is stuck on it forever.
//
// Both TypeScript modules are imported for real (Node strips the types) rather
// than pattern-matched, so this compares the values the app actually uses.
// ---------------------------------------------------------------------------
console.log('\n[versions] the Worker and the app agree on what is current');

const { TERMS_VERSION: appTerms } = await import(
  join(WEB, 'src/terms/content.ts')
);
const { PRIVACY_VERSION: appPrivacy } = await import(
  join(WEB, 'src/terms/privacy.ts')
);
const { TERMS_VERSION: workerTerms, PRIVACY_VERSION: workerPrivacy } =
  await import(join(root, 'worker/policyVersions.js'));

check(
  `TERMS_VERSION matches (${appTerms})`,
  appTerms === workerTerms,
  `src/terms/content.ts: ${appTerms} — worker/policyVersions.js: ${workerTerms}`,
);
check(
  `PRIVACY_VERSION matches (${appPrivacy})`,
  appPrivacy === workerPrivacy,
  `src/terms/privacy.ts: ${appPrivacy} — worker/policyVersions.js: ${workerPrivacy}`,
);
// A version that is not a date is not necessarily wrong, but every one so far
// is, and a stray empty string would compare unequal to every stored value and
// gate everyone permanently.
for (const [what, v] of [
  ['terms', appTerms],
  ['privacy', appPrivacy],
]) {
  check(
    `the ${what} version is a non-empty date-shaped label (${v})`,
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
  );
}

// ---------------------------------------------------------------------------
// 2. The server decides what was accepted.
//
// If the client could name the version it was accepting, it could name one
// whose text it never showed, and the gate would clear without the change ever
// being seen — precisely the promise this feature exists to keep.
// ---------------------------------------------------------------------------
console.log('\n[authority] the accepted version comes from the server');

const FIELDS = [
  'acceptedTermsVersion',
  'acceptedPrivacyVersion',
  'policiesAcceptedAt',
];

for (const field of FIELDS) {
  // `input: false` is what stops Better Auth accepting the field from a
  // sign-up request body.
  const declared = new RegExp(
    `${field}:\\s*\\{[^}]*input:\\s*false[^}]*\\}`,
    's',
  ).test(authJs);
  check(`worker/auth.js declares ${field} with input: false`, declared);
}

check(
  'the create hook stamps all three fields from the Worker constants',
  /acceptedTermsVersion:\s*TERMS_VERSION/.test(authJs) &&
    /acceptedPrivacyVersion:\s*PRIVACY_VERSION/.test(authJs) &&
    /policiesAcceptedAt:\s*new Date\(\)\.toISOString\(\)/.test(authJs),
);
check(
  'worker/auth.js imports the versions from policyVersions.js',
  /import\s*\{[^}]*TERMS_VERSION[^}]*\}\s*from\s*'\.\/policyVersions\.js'/.test(
    authJs,
  ),
);

// The PUT handler must not read the body at all. Anything it read would be a
// claim about what the user saw, made by the thing that decides what to send.
check(
  'worker/policies.js never reads the request body',
  !/request\.json\(\)|request\.text\(\)/.test(policiesJs),
  'a body means the client is asserting which version it accepted',
);
check(
  'the UPDATE binds the imported constants',
  /\.bind\(\s*TERMS_VERSION,\s*PRIVACY_VERSION,/.test(policiesJs),
);
check(
  'worker/index.js routes /api/me/policies',
  /pathname === '\/api\/me\/policies'/.test(indexJs) &&
    /handlePoliciesApi\(request, env, url\)/.test(indexJs),
);
check(
  'the endpoint requires a session',
  /getSession\(/.test(policiesJs) &&
    /status: 401/.test(policiesJs) &&
    policiesJs.indexOf('getSession(') < policiesJs.indexOf('request.method'),
  'the session check must precede any method dispatch',
);
check(
  'the endpoint rejects methods other than GET and PUT',
  /status: 405/.test(policiesJs) && /Allow: 'GET, PUT'/.test(policiesJs),
);
// A promise merely *returned* from inside a try settles outside it, so a D1
// failure during the write would skip the catch: no log line, and a response
// shaped by the runtime rather than the { error } body acceptCurrentPolicies()
// looks for. The client turns a non-ok response into a thrown error and
// restores the gate, so this only ever cost an error message — but it is
// invisible until the day the write fails.
check(
  'the PUT dispatch is awaited, so a failed write hits the catch',
  /return await acceptCurrent\(/.test(policiesJs),
  'return acceptCurrent(...) settles after the try block has exited',
);

// ---------------------------------------------------------------------------
// 3. The migration does not manufacture consent.
//
// A DEFAULT on these columns would hand every pre-existing account an
// acceptance of the current text that nobody ever gave. Null is the honest
// value for "no acceptance on record", and the staleness rule treats it as
// needing acceptance.
// ---------------------------------------------------------------------------
console.log('\n[migration] existing accounts start with no acceptance');

for (const field of FIELDS) {
  check(
    `0007 adds "${field}"`,
    new RegExp(`add column "${field}" text`).test(migration),
  );
}
check(
  'no column is given a DEFAULT',
  !/add column[^;]*default/i.test(migration),
  'a default would fabricate an acceptance for accounts created before this',
);
check(
  'no column is NOT NULL',
  !/add column[^;]*not\s+null/i.test(migration),
  'SQLite cannot add a NOT NULL column without a default, and a default is exactly what must not be there',
);

// ---------------------------------------------------------------------------
// 4. An unknown answer must not gate.
//
// This is a planning tool used on bad connections, sometimes deliberately
// offline. A failed version check that walls someone off from their saved
// routes would be a worse outcome than a re-acceptance deferred to the next
// successful load.
// ---------------------------------------------------------------------------
console.log('\n[fail-open] an unknown answer does not lock anyone out');

check(
  'getMyPolicies returns null on a non-ok response',
  /if \(!res\.ok\) return null;/.test(apiTs),
);
check(
  'getMyPolicies returns null on a thrown request',
  /catch \{\s*return null;\s*\}/.test(apiTs),
  'without the catch, an offline fetch rejects and the caller sees an error instead of "unknown"',
);
check(
  'acceptCurrentPolicies sends no request body',
  /fetch\('\/api\/me\/policies',\s*\{\s*method:\s*'PUT'\s*\}\)/.test(apiTs),
);
check(
  'acceptCurrentPolicies throws when the write failed',
  /if \(!res\.ok\) \{[\s\S]{0,400}throw new Error/.test(apiTs),
  'a silent failure would let someone through on an acceptance that was never stored',
);

// The gate condition itself. `policies?.stale` is truthy only for a known
// stale answer; null (in flight, or failed) falls through to the app.
const gate = /if \(session && ([^)]*)\) \{\s*return \(\s*<TermsPage/.exec(
  rootTsx,
);
check(
  'Root gates on a known-stale answer only',
  gate !== null && gate[1].trim() === 'policies?.stale',
  gate ? `condition reads: ${gate[1].trim()}` : 'gate branch not found',
);
check(
  'Root clears the acceptance state on sign-out',
  /setPolicies\(null\);/.test(rootTsx),
  'left stale, the next account signing in would be judged by the previous one',
);
check(
  'declining signs out rather than dropping into the guest planner',
  /onDecline=\{\(\) => void authClient\.signOut\(\)\}/.test(rootTsx),
);
check(
  'a failed write restores the gate',
  /\.catch\(\(\) => setPolicies\(previous\)\)/.test(rootTsx),
);

// ---------------------------------------------------------------------------
// Negative controls. These checks are string-shaped, so the real risk is a
// regex that silently stops matching anything and reports success forever.
// Each control plants the regression the check exists for and requires it to
// be seen.
// ---------------------------------------------------------------------------
console.log('\n[control] the checks detect the regressions they exist for');
{
  const bumped = read('worker/policyVersions.js').replace(
    workerPrivacy,
    '2099-01-01',
  );
  check(
    'a drifted Worker version would be caught',
    bumped !== read('worker/policyVersions.js') &&
      /PRIVACY_VERSION = '2099-01-01'/.test(bumped) &&
      appPrivacy !== '2099-01-01',
  );

  const clientTrusted = policiesJs.replace(
    'const now = new Date().toISOString();',
    'const body = await request.json();',
  );
  check(
    'a body read in the PUT handler would be caught',
    clientTrusted !== policiesJs &&
      /request\.json\(\)/.test(clientTrusted),
  );

  const unawaited = policiesJs.replace(
    'return await acceptCurrent(env, userId);',
    'return acceptCurrent(env, userId);',
  );
  check(
    'dropping the await on the write would be caught',
    unawaited !== policiesJs && !/return await acceptCurrent\(/.test(unawaited),
  );

  const inputOpened = authJs.replace(
    /acceptedTermsVersion: \{\s*type: 'string',\s*required: false,\s*input: false,\s*\}/,
    "acceptedTermsVersion: { type: 'string', required: false, input: true }",
  );
  check(
    'acceptedTermsVersion turned into an input field would be caught',
    inputOpened !== authJs &&
      !new RegExp(
        `acceptedTermsVersion:\\s*\\{[^}]*input:\\s*false[^}]*\\}`,
        's',
      ).test(inputOpened),
  );

  const defaulted = migration.replace(
    'add column "acceptedTermsVersion" text;',
    "add column \"acceptedTermsVersion\" text default '2026-07-16';",
  );
  check(
    'a DEFAULT planted in the migration would be caught',
    defaulted !== migration && /add column[^;]*default/i.test(defaulted),
  );

  const failClosed = rootTsx.replace(
    'if (session && policies?.stale) {',
    'if (session && (!policies || policies.stale)) {',
  );
  const reGate = /if \(session && ([^)]*)\) \{\s*return \(\s*<TermsPage/.exec(
    failClosed,
  );
  check(
    'a fail-closed gate would be caught',
    failClosed !== rootTsx &&
      (reGate === null || reGate[1].trim() !== 'policies?.stale'),
  );
}

console.log(
  failures === 0
    ? '\nALL CHECKS PASSED — acceptance is recorded, server-decided, and fails open'
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
