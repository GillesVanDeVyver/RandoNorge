// Guards the two faults that together took sign-up and sign-in down from
// 2026-07-23 to 2026-08-06, neither of which any local run could have caught.
//
// THE FAULT. worker/password.js asked crypto.subtle for 600,000 PBKDF2
// iterations, following OWASP. Cloudflare caps PBKDF2 at 100,000 and rejects
// anything above it outright:
//
//   NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
//   supported
//
// Every sign-up and every sign-in hashes a password — sign-in does it even for
// an address that does not exist, to keep its timing constant — so both flows
// threw on every single attempt in production.
//
// WHY IT SURVIVED SO LONG. Two things hid it, and this script exists because
// of both.
//
// The cap is enforced only by the production runtime. `wrangler dev` runs a
// local workerd that computes 600,000 iterations quite happily, so sign-up
// worked perfectly on localhost the entire time it was broken for real users.
// No amount of local testing could have found it. Section 1 therefore checks
// the *number itself* against the documented cap rather than checking that
// hashing works, because locally it always does.
//
// And the error was invisible. It is a plain Error, not a Better Auth
// APIError, so better-call answered it with `new Response(null, {status:500})`
// — a 500 with no body. The client cannot parse that, so the form fell back to
// "Could not create the account. Please try again.", which names nothing. The
// server knew exactly what was wrong and said none of it. Section 3 checks the
// wiring that now turns that case into a logged line and a JSON body.
//
// Sections:
//   1. The iteration count is one the platform will actually accept.
//   2. Hashing and verification behave — round-trip, rejection, the stored
//      iteration count being honoured, and no throw on a hash we cannot check.
//   3. An unrecognised auth error reaches the client as readable JSON.
//   4. Controls proving each check fails on the code it exists for.
//
// Run with:  node scripts/verify-password-hash.mjs   (needs Node >= 22)
// Wired into `pnpm test:password`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pbkdf2Sync } from 'node:crypto';
import { stripComments } from './lib/strip-comments.mjs';
import { hashPassword, verifyPassword } from '../worker/password.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const passwordSource = read('worker/password.js');
const authSource = read('worker/auth.js');
const indexSource = read('worker/index.js');

// worker/password.js documents the cap it must respect, so its comments are
// full of the exact numbers and error text these checks look for. Scan code.
const passwordCode = stripComments(passwordSource);
const authCode = stripComments(authSource);
const indexCode = stripComments(indexSource);

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

/** The cap Cloudflare enforces. Not this repo's choice; do not "tune" it. */
const PLATFORM_CAP = 100_000;

/** Read a `const NAME = 123_000;` out of code, as a number. */
function constant(code, name) {
  const m = code.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9_]+)`));
  return m ? Number(m[1].replaceAll('_', '')) : null;
}

// ---------------------------------------------------------------------------
// 1. The iteration count is legal on the platform.
//
// This is the check that would have caught the outage on the day it was
// introduced, and the only kind that could have: it reads the constant instead
// of exercising it, because exercising it locally succeeds either way.
// ---------------------------------------------------------------------------
console.log('\n[1] the iteration count is one Cloudflare will accept');

const iterations = constant(passwordCode, 'ITERATIONS');
const declaredCap = constant(passwordCode, 'MAX_ITERATIONS');

check('worker/password.js declares ITERATIONS', iterations !== null);
check(
  `ITERATIONS (${iterations}) is within the ${PLATFORM_CAP} platform cap`,
  iterations !== null && iterations <= PLATFORM_CAP,
  'crypto.subtle rejects PBKDF2 above 100000 in production, and only in ' +
    'production — wrangler dev will not reproduce this.',
);
check(
  'ITERATIONS is a real work factor, not lowered for convenience',
  iterations !== null && iterations >= PLATFORM_CAP,
  'The cap is also the most the platform allows, so anything less is a ' +
    'weaker hash for no gain.',
);
check(
  `MAX_ITERATIONS records the cap as ${PLATFORM_CAP}`,
  declaredCap === PLATFORM_CAP,
);
check(
  'the module refuses to load if ITERATIONS ever exceeds the cap',
  /if\s*\(\s*ITERATIONS\s*>\s*MAX_ITERATIONS\s*\)/.test(passwordCode) &&
    /throw new Error/.test(passwordCode),
  'A load-time throw fails the deploy; without it the next person to raise ' +
    'this finds out from users.',
);

// ---------------------------------------------------------------------------
// 2. Behaviour.
//
// Node's WebCrypto is the same API the Worker uses, so the module runs here
// unmodified.
// ---------------------------------------------------------------------------
console.log('\n[2] hashing and verification behave');

const password = 'correct horse battery staple';
const stored = await hashPassword(password);
const parts = stored.split('$');

check(
  'a hash is the documented pbkdf2-sha256$iterations$salt$key',
  parts.length === 4 && parts[0] === 'pbkdf2-sha256',
  stored,
);
check(
  `the hash records the iteration count it was made with (${parts[1]})`,
  Number(parts[1]) === iterations,
);
check('the right password verifies', await verifyPassword({ hash: stored, password }));
check(
  'the wrong password does not',
  !(await verifyPassword({ hash: stored, password: password + 'x' })),
);
check(
  'two hashes of the same password differ (the salt is random)',
  (await hashPassword(password)) !== stored,
);
check(
  'a tampered key does not verify',
  !(await verifyPassword({
    hash: parts.slice(0, 3).concat(parts[3].replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))).join('$'),
    password,
  })),
);
for (const bad of ['', 'nonsense', 'scrypt$1$a$b', 'pbkdf2-sha256$0$a$b']) {
  check(
    `a malformed hash (${JSON.stringify(bad)}) is rejected, not thrown on`,
    !(await verifyPassword({ hash: bad, password })),
  );
}

// An account hashed before the count changed must still be able to log in;
// that is the entire point of storing the count in the hash. Every existing
// production account is a 100,000 one, so this is not hypothetical.
const legacyIterations = 50_000;
const legacySalt = Buffer.from('0123456789abcdef');
const legacyHash =
  `pbkdf2-sha256$${legacyIterations}$${legacySalt.toString('base64')}$` +
  pbkdf2Sync(password, legacySalt, legacyIterations, 32, 'sha256').toString('base64');
check(
  `a hash stored at ${legacyIterations} iterations still verifies`,
  await verifyPassword({ hash: legacyHash, password }),
  'The stored count must be honoured, not replaced by the current one.',
);
check(
  'and still rejects the wrong password',
  !(await verifyPassword({ hash: legacyHash, password: 'nope' })),
);

// A hash above the cap cannot be recomputed here at all. Answering "no" keeps
// it a failed login; throwing would make it another unreadable 500.
const uncomputable = `pbkdf2-sha256$600000$${legacySalt.toString('base64')}$AAAA`;
let threw = false;
let verified = null;
try {
  verified = await verifyPassword({ hash: uncomputable, password });
} catch {
  threw = true;
}
check(
  'a stored hash above the cap returns false instead of throwing',
  !threw && verified === false,
  threw
    ? 'It threw — which is exactly how this became an empty 500 before.'
    : `It returned ${verified}.`,
);

// ---------------------------------------------------------------------------
// 3. No unreadable 500 can reach the client.
//
// Independent of the cap: whatever fails inside Better Auth next time, the
// client must get something it can parse and the log must get the cause.
// ---------------------------------------------------------------------------
console.log('\n[3] an unrecognised auth error comes back as readable JSON');

check(
  'worker/auth.js sets onAPIError.throw so unknown errors escape the router',
  /onAPIError\s*:\s*\{[^}]*throw\s*:\s*true/.test(authCode),
  'Without it better-call answers `new Response(null, {status: 500})` and ' +
    'the cause never leaves the server.',
);
check(
  'worker/index.js defines runAuthHandler',
  /async function runAuthHandler\s*\(/.test(indexCode),
);

const guard = indexCode.slice(indexCode.indexOf('async function runAuthHandler'));
check(
  'runAuthHandler catches, logs, and answers with JSON',
  /catch\s*\(/.test(guard) &&
    /console\.error/.test(guard) &&
    /Response\.json/.test(guard) &&
    /AUTH_INTERNAL_ERROR/.test(guard),
);

// The guard is only worth anything if nothing bypasses it. Every call into
// Better Auth's HTTP handler must go through it.
const rawHandlerCalls = [...indexCode.matchAll(/getAuth\([^)]*\)\s*\.handler\(/g)];
check(
  'every getAuth().handler() call goes through runAuthHandler',
  rawHandlerCalls.length === 1,
  `${rawHandlerCalls.length} direct .handler( calls found; expected exactly ` +
    'the one inside runAuthHandler.',
);
check(
  'the one direct call is the one inside runAuthHandler',
  rawHandlerCalls.length === 1 &&
    rawHandlerCalls[0].index > indexCode.indexOf('async function runAuthHandler'),
);
check(
  'the gated sign-up path is guarded too',
  /const authResponse = await runAuthHandler\(/.test(indexCode),
  'Sign-up is the flow that broke; it must not be the one route that still ' +
    'calls the handler raw.',
);

// ---------------------------------------------------------------------------
// 4. Controls. Each plants the fault its check exists for and requires a
//    catch — otherwise a check that quietly matches nothing reads as a pass.
// ---------------------------------------------------------------------------
console.log('\n[4] control: each check fails on the code it exists for');

const withOwasp = passwordCode.replace(
  /const ITERATIONS = [0-9_]+;/,
  'const ITERATIONS = 600_000;',
);
check(
  'the 2026-07-23 change (600,000 iterations) is caught',
  withOwasp !== passwordCode && constant(withOwasp, 'ITERATIONS') > PLATFORM_CAP,
);

const weakened = passwordCode.replace(
  /const ITERATIONS = [0-9_]+;/,
  'const ITERATIONS = 1_000;',
);
check(
  'silently weakening the hash is caught',
  weakened !== passwordCode && constant(weakened, 'ITERATIONS') < PLATFORM_CAP,
);

const noGuard = passwordCode.replace(/if\s*\(\s*ITERATIONS\s*>\s*MAX_ITERATIONS\s*\)/, 'if (false)');
check(
  'removing the load-time guard is caught',
  noGuard !== passwordCode &&
    !/if\s*\(\s*ITERATIONS\s*>\s*MAX_ITERATIONS\s*\)/.test(noGuard),
);

const noThrow = authCode.replace(/onAPIError\s*:\s*\{[^}]*\},?/, '');
check(
  'dropping onAPIError.throw is caught',
  noThrow !== authCode && !/onAPIError\s*:\s*\{[^}]*throw\s*:\s*true/.test(noThrow),
);

const bypassed = indexCode.replace(
  'return runAuthHandler(env, url, request);',
  'return getAuth(env, url.origin).handler(request);',
);
check(
  'a route going straight to the handler again is caught',
  bypassed !== indexCode &&
    [...bypassed.matchAll(/getAuth\([^)]*\)\s*\.handler\(/g)].length !== 1,
);

// And the behavioural checks are exercising real crypto, not comparing
// undefined to undefined.
check(
  'the verifier rejects a hash of a different password',
  !(await verifyPassword({ hash: await hashPassword('one'), password: 'two' })),
);

console.log(
  failures === 0
    ? '\nALL CHECKS PASSED — passwords can be hashed on the platform, and a ' +
        'failure that cannot be would be readable'
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
