// Password hashing for Cloudflare Workers.
//
// Better Auth's default hasher is scrypt implemented in pure JS, which
// costs ~80 ms of CPU — well over the 10 ms CPU budget of the Workers
// free plan, so sign-ups would be killed mid-request. Instead we use
// PBKDF2-SHA-256 through the Worker's *native* WebCrypto
// (crypto.subtle.deriveBits), which is NIST-approved and runs in native
// code, keeping CPU time within the free-plan budget.
//
// Stored format (all parameters travel with the hash, so ITERATIONS can
// be raised without breaking existing accounts — an old hash still verifies
// at whatever count it was written with):
//   pbkdf2-sha256$<iterations>$<salt base64>$<derived key base64>
//
// ITERATIONS follows the current OWASP guidance for PBKDF2-HMAC-SHA256
// (600,000). Native WebCrypto runs this in a few ms of CPU; if it ever
// pushes a sign-up over the plan's CPU budget, that's a signal to move to
// the paid Workers plan (50 ms) rather than to weaken the hash. Existing
// 100k-iteration hashes keep verifying and are upgraded the next time the
// user changes their password.

const ITERATIONS = 600_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

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

  const salt = fromB64(parts[2]);
  const expected = fromB64(parts[3]);
  const actual = new Uint8Array(await derive(password, salt, iterations));

  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
