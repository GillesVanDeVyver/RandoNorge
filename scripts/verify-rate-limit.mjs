// Guards the fix for the 2026-08-06 sign-up freeze.
//
// Better Auth rate-limits every /api/auth/* request from its router's
// onRequest hook, which better-call runs BEFORE it matches a route. With
// `rateLimit.storage: "database"` that hook ran Better Auth's own storage
// wrapper, whose consume() re-calls itself — `return consume(key, rule)` —
// whenever its guarded UPDATE reports no changed row, with no attempt counter
// and no ceiling. On D1 through kysely-d1 that condition is reachable (the
// driver returns `numAffectedRows: undefined` rather than 0, and the
// transactional fallback throws "Transactions are not supported yet"), so the
// loop never ended. Every sign-up hung before Better Auth's own code ran —
// which is why no verification email was ever attempted, and why the earlier
// Resend timeout fix could not have helped. See docs/SIGNUP_FREEZE_DEBUGGING.md.
//
// The replacement is worker/rateLimit.js `betterAuthRateLimitStorage()`: one
// D1 upsert, no loop. Nothing in the type system says that storage must
// terminate, or that worker/auth.js must keep using it, so this script checks
// both, plus the client-side belt and braces:
//
//   1. Behaviour — the real storage, run against an in-memory SQLite stand-in
//      for D1. It must terminate, enforce the cap, expire its window, keep
//      buckets separate, round-trip get/set, and fail OPEN on a dead database.
//   2. The wiring — worker/auth.js passes customStorage and has not drifted
//      back to `storage: "database"`; the per-route caps survive.
//   3. The form — LoginPage.tsx clears `busy` in a finally and bounds both of
//      its requests, so even a server that hangs again cannot reproduce the
//      endless "One moment…".
//   4. A control section proving each check fails on the code it exists for.
//
// Run with:  node scripts/verify-rate-limit.mjs   (needs Node >= 22)
// Wired into `pnpm test:ratelimit`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { betterAuthRateLimitStorage } from '../worker/rateLimit.js';
import { stripComments } from './lib/strip-comments.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const limiterSource = readFileSync(join(root, 'worker/rateLimit.js'), 'utf8');
const authSource = readFileSync(join(root, 'worker/auth.js'), 'utf8');
const loginSource = readFileSync(
  join(root, 'src/components/LoginPage.tsx'),
  'utf8',
);
const migration = readFileSync(
  join(root, 'migrations/0005_rate_limit.sql'),
  'utf8',
);

// The files under test explain themselves at length, and those comments name
// the very things the checks below look for (`storage: "database"` appears in
// worker/auth.js as the warning not to go back to it). Match against code
// only.
// The helper is order-sensitive in a way that can silently blank out the code
// being checked; the reasoning lives with it.
const authCode = stripComments(authSource);
const loginCode = stripComments(loginSource);

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
const section = (name) => console.log(`\n${name}`);

// ---------------------------------------------------------------------------
// A D1 stand-in. Same surface the Worker uses (prepare/bind/first/run) over
// node:sqlite, and the same two tables, read out of the real migration so the
// schema under test cannot drift from the deployed one.
// ---------------------------------------------------------------------------
function makeEnv() {
  const db = new DatabaseSync(':memory:');
  const sql = migration.replace(/^\s*--.*$/gm, '');
  for (const stmt of sql.split(';')) {
    if (stmt.trim()) db.exec(stmt);
  }
  const env = {
    DB: {
      prepare(sql) {
        // D1 uses numbered placeholders (?1, ?2 …) which may appear in any
        // order; node:sqlite binds positionally, so map each occurrence back
        // to the argument it names.
        const order = [...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]));
        const stmt = db.prepare(sql.replace(/\?(\d+)/g, '?'));
        let args = [];
        const ordered = () => order.map((n) => args[n - 1]);
        const api = {
          bind(...a) {
            args = a;
            return api;
          },
          first: () => stmt.get(...ordered()) ?? null,
          run: () => ({ meta: { changes: Number(stmt.run(...ordered()).changes) } }),
        };
        return api;
      },
    },
  };
  return { env, db };
}

// ---------------------------------------------------------------------------
section('[storage] the limiter Better Auth now calls on every auth request');
// ---------------------------------------------------------------------------
{
  const { env, db } = makeEnv();
  const store = betterAuthRateLimitStorage(env);
  const rule = { max: 3, window: 300 };

  // The freeze itself: consume() must return. If the recursion ever comes
  // back this loop is where the test suite stops responding.
  const hits = [];
  for (let i = 0; i < 5; i += 1) {
    hits.push(await store.consume('1.2.3.4:/sign-in/email', rule));
  }
  check('consume() returns — no unbounded recursion', hits.length === 5);
  check(
    'hits within the cap are allowed',
    hits.slice(0, 3).every((r) => r.allowed === true),
  );
  check(
    'hits past the cap are refused',
    hits.slice(3).every((r) => r.allowed === false),
  );
  check(
    'a refusal carries a retryAfter within the window',
    hits[3].retryAfter > 0 && hits[3].retryAfter <= rule.window,
  );
  check('an allowed hit carries no retryAfter', hits[0].retryAfter === null);

  // Per-client and per-route isolation. Without the real IP (advanced
  // .ipAddressHeaders in worker/auth.js) every caller would share one bucket,
  // which both fails to isolate an attacker and locks everyone out together.
  check(
    'a different client gets its own bucket',
    (await store.consume('9.9.9.9:/sign-in/email', rule)).allowed === true,
  );
  check(
    'a different route gets its own bucket',
    (await store.consume('1.2.3.4:/sign-up/email', rule)).allowed === true,
  );

  // Auth buckets share the table with the app's own ("account-exists:<ip>",
  // "invite-signup:<ip>"); the namespace is what keeps them from colliding.
  const keys = db
    .prepare('select "key" from "app_rate_limit"')
    .all()
    .map((r) => r.key);
  check(
    'auth buckets are namespaced under "auth:"',
    keys.length === 3 && keys.every((k) => k.startsWith('auth:')),
    `keys were ${JSON.stringify(keys)}`,
  );

  // Fixed window: once resetAt passes the count starts over. (Better Auth's
  // own backend rolls the window forward instead; the difference is
  // deliberate and immaterial for throttling credential stuffing.)
  db.prepare('update "app_rate_limit" set "resetAt" = ?').run(Date.now() - 1000);
  check(
    'the count restarts once the window has passed',
    (await store.consume('1.2.3.4:/sign-in/email', rule)).allowed === true,
  );
}

// ---------------------------------------------------------------------------
section('[legacy path] get/set are implemented, not stubbed');
// ---------------------------------------------------------------------------
{
  // Better Auth uses consume() when present. If a future version stopped
  // doing so, a no-op get() would silently disable rate limiting on
  // /api/auth/* altogether — worse than the freeze, and invisible.
  const { env, db } = makeEnv();
  const store = betterAuthRateLimitStorage(env);

  check('get() on an unknown key is null', (await store.get('nobody')) === null);
  await store.set('1.2.3.4:/sign-in/email', { count: 7, lastRequest: 1234 });
  const first = await store.get('1.2.3.4:/sign-in/email');
  check(
    'set() then get() returns what was written',
    first?.count === 7 && first?.lastRequest === 1234,
    `read back ${JSON.stringify(first)}`,
  );
  check(
    'get() answers under the namespaced key',
    first?.key === 'auth:1.2.3.4:/sign-in/email',
  );
  // The "rateLimit" table's unique constraint is on "id", not "key"
  // (migration 0005), so an ON CONFLICT("key") upsert would have nothing to
  // conflict against and would insert a second row every time.
  await store.set('1.2.3.4:/sign-in/email', { count: 8, lastRequest: 5678 });
  const second = await store.get('1.2.3.4:/sign-in/email');
  check(
    'a second set() updates the row rather than duplicating it',
    second?.count === 8 &&
      db.prepare('select count(*) as c from "rateLimit"').get().c === 1,
  );
}

// ---------------------------------------------------------------------------
section('[fail open] a broken database must not lock anyone out');
// ---------------------------------------------------------------------------
{
  const dead = betterAuthRateLimitStorage({
    DB: {
      prepare() {
        throw new Error('D1 unavailable');
      },
    },
  });
  console.log('        (the three logged errors below are the point)');
  check('consume() allows the request', (await dead.consume('k', { max: 1, window: 60 })).allowed === true);
  check('get() returns null instead of throwing', (await dead.get('k')) === null);
  let threw = false;
  try {
    await dead.set('k', { count: 1, lastRequest: 1 });
  } catch {
    threw = true;
  }
  check('set() swallows the failure', threw === false);
}

// ---------------------------------------------------------------------------
section('[wiring] worker/auth.js uses this storage and not the database one');
// ---------------------------------------------------------------------------
{
  check(
    'auth.js imports betterAuthRateLimitStorage',
    /import\s*\{[^}]*betterAuthRateLimitStorage[^}]*\}\s*from\s*'\.\/rateLimit\.js'/.test(
      authCode,
    ),
  );
  check(
    'it is passed as rateLimit.customStorage',
    /customStorage:\s*betterAuthRateLimitStorage\(env\)/.test(authCode),
  );
  check(
    'rate limiting is still enabled',
    /rateLimit:\s*\{[\s\S]*?enabled:\s*true/.test(authCode),
  );
  // The regression this whole file exists for: a well-meaning "use the
  // documented option" edit puts the freeze straight back.
  check(
    'storage: "database" has not come back',
    !/storage:\s*['"]database['"]/.test(authCode),
    'Better Auth\'s database storage recurses without a ceiling on D1',
  );
  // Better Auth resolves the rule (window, max) before calling the storage,
  // so customRules keep working — but only if they are still there.
  for (const route of [
    '/sign-in/email',
    '/sign-up/email',
    '/forget-password',
    '/reset-password',
  ]) {
    check(
      `the stricter cap on ${route} survives`,
      new RegExp(`'${route}':\\s*\\{\\s*window:\\s*\\d+,\\s*max:\\s*\\d+`).test(
        authCode,
      ),
    );
  }
  // Per-client bucketing depends on Better Auth finding the real IP; on
  // Workers only CF-Connecting-IP carries it.
  check(
    'the caller IP is read from CF-Connecting-IP',
    /ipAddressHeaders:\s*\[\s*'cf-connecting-ip'/.test(authCode),
  );
  // One upsert, no self-call: the property that makes the hang impossible.
  const limiterCode = stripComments(limiterSource);
  const storageBody = limiterCode.slice(
    limiterCode.indexOf('export function betterAuthRateLimitStorage'),
  );
  check(
    'the storage never calls itself',
    !/betterAuthRateLimitStorage\s*\(/.test(storageBody.slice(60)),
  );
}

// ---------------------------------------------------------------------------
section('[form] the sign-up button cannot spin for ever again');
// ---------------------------------------------------------------------------
{
  // Even with the server fixed: performSignup is invoked as `void
  // performSignup()`, so a rejection is swallowed. If setBusy(false) is not in
  // a finally, one thrown request leaves "One moment…" on screen permanently.
  check(
    'busy is cleared in a finally',
    /setBusy\(true\);\s*try\s*\{[\s\S]*?\}\s*finally\s*\{\s*setBusy\(false\);\s*\}/.test(
      loginCode,
    ),
  );
  check(
    'the /api/account-exists pre-check has an abort signal',
    /account-exists[\s\S]{0,400}?signal:\s*AbortSignal\.timeout\(ACCOUNT_EXISTS_TIMEOUT_MS\)/.test(
      loginCode,
    ),
  );
  check(
    'the sign-up call passes a timeout to better-fetch',
    /signUp\.email\([\s\S]*?\{\s*timeout:\s*SIGNUP_TIMEOUT_MS\s*\}/.test(
      loginCode,
    ),
  );
  check(
    'a thrown sign-up becomes a visible error',
    /catch\s*\{\s*setError\(\s*translate\(\s*\n?\s*'Registreringen svarte ikke/.test(
      loginCode,
    ),
  );
  const timeouts = [
    ...loginCode.matchAll(/const (\w+_TIMEOUT_MS) = (\d+);/g),
  ].map((m) => Number(m[2]));
  check(
    'every timeout is set to something a human will wait for',
    timeouts.length >= 3 && timeouts.every((t) => t >= 5000 && t <= 60000),
    `found ${JSON.stringify(timeouts)}`,
  );

  // Sign-up was the reported freeze, but every other button on this page
  // (sign in, resend, forgot, reset, Google) posts to the same /api/auth/*
  // handler and would have hung in exactly the same way. They all go through
  // authRequest, which is where the bound and the catch live.
  check(
    'authRequest bounds the call and catches a throw',
    /const authRequest = async \([\s\S]*?call\(\{\s*timeout:\s*AUTH_TIMEOUT_MS\s*\}\)[\s\S]*?\}\s*catch\s*\{/.test(
      loginCode,
    ),
  );
  const rawCalls = [...loginCode.matchAll(/await authClient\.[\w.]+\(/g)].map(
    (m) => m[0],
  );
  check(
    'no auth call bypasses authRequest except the sign-up one',
    rawCalls.length === 1 && rawCalls[0].includes('signUp.email'),
    `unbounded-looking calls: ${JSON.stringify(rawCalls)}`,
  );
  const busySet = (loginCode.match(/setBusy\(true\)/g) ?? []).length;
  const busyInFinally = (
    loginCode.match(/finally\s*\{\s*setBusy\(false\);\s*\}/g) ?? []
  ).length;
  check(
    'every handler that sets busy also clears it in a finally',
    // handleGoogle is the one exception and says so: on success the browser
    // leaves for Google, so clearing the flag would flash the button back.
    busySet - busyInFinally === 1 &&
      /No try\/finally here[\s\S]{0,400}?signIn\.social/.test(loginSource),
    `${busySet} setBusy(true) vs ${busyInFinally} finally blocks`,
  );
}

// ---------------------------------------------------------------------------
section('[control] the checks catch the regressions they exist for');
// ---------------------------------------------------------------------------
{
  const reverted = authCode.replace(
    /customStorage:\s*betterAuthRateLimitStorage\(env\)/,
    "storage: 'database'",
  );
  check(
    'reverting to storage: "database" is caught',
    reverted !== authCode &&
      /storage:\s*['"]database['"]/.test(reverted) &&
      !/customStorage:/.test(reverted),
  );

  // replaceAll, not replace: with several handlers now wrapped, mutating one
  // of them would leave the others to satisfy the check — which is how a
  // control quietly stops controlling anything.
  const noFinally = loginCode.replaceAll(
    /\}\s*finally\s*\{\s*setBusy\(false\);\s*\}/g,
    '}\n    setBusy(false);',
  );
  check(
    'moving setBusy(false) out of the finally is caught',
    noFinally !== loginCode &&
      !/setBusy\(true\);\s*try\s*\{[\s\S]*?\}\s*finally\s*\{\s*setBusy\(false\);\s*\}/.test(
        noFinally,
      ) &&
      (noFinally.match(/finally\s*\{\s*setBusy\(false\);\s*\}/g) ?? []).length ===
        0,
  );

  const noTimeout = loginCode.replace(/\{\s*timeout:\s*SIGNUP_TIMEOUT_MS\s*\}/, '');
  check(
    'dropping the sign-up timeout is caught',
    noTimeout !== loginCode &&
      !/signUp\.email\([\s\S]*?\{\s*timeout:\s*SIGNUP_TIMEOUT_MS\s*\}/.test(
        noTimeout,
      ),
  );

  // And the behavioural checks, so the [storage] section above is not passing
  // vacuously. A limiter that let everything through, and one that let nothing
  // through, must each fail an assertion made up there.
  const alwaysAllows = { consume: async () => ({ allowed: true, retryAfter: null }) };
  const leaky = [];
  for (let i = 0; i < 5; i += 1) {
    leaky.push(await alwaysAllows.consume());
  }
  check(
    'a limiter that ignored its cap would be caught',
    leaky.slice(3).some((r) => r.allowed === true),
  );

  const alwaysRefuses = { consume: async () => ({ allowed: false, retryAfter: 60 }) };
  check(
    'a limiter that failed closed on a dead database would be caught',
    (await alwaysRefuses.consume()).allowed === false,
  );
}

console.log(
  failures === 0
    ? '\nALL CHECKS PASSED — the auth limiter terminates, is wired in, and the form can recover'
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
