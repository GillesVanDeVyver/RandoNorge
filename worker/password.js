// Password hashing for Cloudflare Workers.
//
// Better Auth's default hasher is scrypt implemented in pure JS, which
// costs ~80 ms of CPU — well over the 10 ms CPU budget of the Workers
// free plan, so sign-ups would be killed mid-request. Instead we use
// PBKDF2-SHA-256 through the Worker's *native* WebCrypto
// (crypto.subtle.deriveBits), which is NIST-approved and runs in native
// code, keeping CPU time within the free-plan budget.
//
// Stored format — every parameter travels with the hash, so changing
// ITERATIONS never invalidates existing accounts; an old hash still verifies
// at whatever count it was written with:
//   pbkdf2-sha256$<iterations>$<salt base64>$<derived key base64>
//
// ITERATIONS is pinned to the platform ceiling, NOT to OWASP guidance.
//
// OWASP currently recommends 600,000 iterations for PBKDF2-HMAC-SHA256, and
// this file asked for exactly that between 2026-07-23 and 2026-08-06. It could
// never work: Cloudflare caps PBKDF2 at 100,000 iterations to stop a request
// from burning unbounded CPU, and `crypto.subtle.deriveBits` rejects anything
// above it with
//
//   NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
//   supported
//
// That rejection is a plain error, not a Better Auth APIError, so it escaped as
// an empty-bodied HTTP 500 and broke every sign-up and every sign-in for two
// weeks. The full account is in docs/SIGNUP_FREEZE_DEBUGGING.md §6.
//
// It cannot be caught in development: the cap is enforced by the production
// runtime, and `wrangler dev`'s local workerd happily computes 600,000
// iterations. Local success says nothing about whether this value is legal.
// That is what MAX_ITERATIONS below is for — it fails loudly, everywhere,
// instead of only in production.
//
// Raising the work factor beyond the cap means chaining derivations (feeding
// one 100,000-iteration output in as the next call's input), which multiplies
// CPU time by the number of rounds. Measured on ordinary hardware a single
// 100,000-iteration hash costs ~20 ms of CPU, so six chained rounds would cost
// ~120 ms — far past the Workers free plan's 10 ms CPU budget, and past the
// paid plan's 50 ms default too. So this is a real ceiling, not a lazy one:
// clearing it needs a paid plan with a raised CPU limit *and* chaining, and it
// needs measuring, not assuming. Until then 100,000 is what the platform
// allows, and it is what every existing account is already hashed with.

/** Cloudflare Workers refuses PBKDF2 above this. Not a tuning knob. */
const MAX_ITERATIONS = 100_000;

const ITERATIONS = 100_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

// Fail at module load — in `wrangler dev`, in CI, and in the deploy's startup
// check — rather than at the first sign-up on production, which is how this
// last went wrong. `scripts/verify-password-hash.mjs` checks the same thing
// statically, so `pnpm test` catches it without running the Worker at all.
if (ITERATIONS > MAX_ITERATIONS) {
  throw new Error(
    `ITERATIONS (${ITERATIONS}) exceeds the Cloudflare Workers PBKDF2 cap ` +
      `of ${MAX_ITERATIONS}; crypto.subtle would reject every hash in ` +
      `production. See the comment above.`,
  );
}

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_BYTES * 8,
  );
}

/** Hash a password for storage. */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const bits = await derive(password, salt, ITERATIONS);
  return `pbkdf2-sha256$${ITERATIONS}$${toB64(salt)}$${toB64(bits)}`;
}

/** Constant-time verification against a stored hash. */
export async function verifyPassword({ hash, password }) {
  const parts = hash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1) return false;

  // A stored hash above the platform cap cannot be recomputed here, so there
  // is no way to tell whether the password matches. Answer "no" rather than
  // throwing: a throw leaves Better Auth's router with an error it has no
  // response for and the caller gets an unreadable empty 500, which is the
  // exact failure this file caused before. "No" is also what the user
  // experiences either way, except that a password reset can now fix it.
  // Nothing should ever write such a hash — `crypto.subtle` would reject it —
  // but a row written from a runtime without the cap would otherwise lock the
  // account behind a 500 forever.
  if (iterations > MAX_ITERATIONS) {
    console.error(
      `Stored password hash uses ${iterations} PBKDF2 iterations, above the ` +
        `Workers cap of ${MAX_ITERATIONS}; it cannot be verified. The account ` +
        `must reset its password.`,
    );
    return false;
  }

  const salt = fromB64(parts[2]);
  const expected = fromB64(parts[3]);
  const actual = new Uint8Array(await derive(password, salt, iterations));

  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
