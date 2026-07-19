// Shared username (public handle) rules, used both when a handle is chosen
// at sign-up (worker/auth.js) and when it is set/changed later
// (worker/username.js). Keeping the rules in one place means the /u/<name>
// profile URL always points at something validated the same way.

export const MIN_LENGTH = 3;
export const MAX_LENGTH = 30;

// Letters/digits, with single internal hyphens or underscores; must start
// and end alphanumeric. Keeps handles readable and unambiguous in a URL.
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/;

// Would collide with a top-level app path or look official. Public profiles
// live under /u/<name> so these can't actually shadow a route, but reserving
// them avoids confusing or impersonating links.
export const RESERVED = new Set([
  'admin', 'api', 'auth', 'fjellrute', 'help', 'login', 'logout', 'me',
  'planner', 'profile', 'root', 'settings', 'signup', 'support', 'u',
]);

/**
 * Validate a raw username. Returns `{ ok: true, username }` with the
 * normalized (trimmed, lower-cased) handle, or `{ ok: false, error }` with a
 * user-facing message. Uniqueness is checked separately (needs the DB).
 */
export function validateUsername(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'username required' };
  }
  const username = raw.trim().toLowerCase();
  if (username.length < MIN_LENGTH || username.length > MAX_LENGTH) {
    return {
      ok: false,
      error: `username must be ${MIN_LENGTH}–${MAX_LENGTH} characters`,
    };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      error:
        'use letters, numbers, hyphens and underscores; ' +
        'start and end with a letter or number',
    };
  }
  if (RESERVED.has(username)) {
    return { ok: false, error: 'that username is reserved' };
  }
  return { ok: true, username };
}

/** True if some other account already holds this handle (case-insensitive).
 *  `exceptUserId` lets an account keep its own handle when changing it. */
export async function isUsernameTaken(env, username, exceptUserId = null) {
  const row = exceptUserId
    ? await env.DB.prepare(
        'select 1 from "user" where lower(username) = ? and id <> ? limit 1',
      )
        .bind(username, exceptUserId)
        .first()
    : await env.DB.prepare(
        'select 1 from "user" where lower(username) = ? limit 1',
      )
        .bind(username)
        .first();
  return Boolean(row);
}

/** A URL-safe base handle derived from an email's local part, padded/trimmed
 *  to satisfy the length + shape rules (used as a seed for social sign-ups,
 *  which don't ask for a handle). */
function baseFromEmail(email) {
  const local = String(email || '').split('@')[0].toLowerCase();
  let base = local.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (base.length < MIN_LENGTH) base = `${base || 'user'}`.padEnd(MIN_LENGTH, '0');
  if (base.length > 20) base = base.slice(0, 20);
  // Guarantee alphanumeric start/end after slicing.
  base = base.replace(/^[-_]+|[-_]+$/g, '');
  if (base.length < MIN_LENGTH) base = base.padEnd(MIN_LENGTH, '0');
  return base;
}

/**
 * Produce a unique handle for an account that didn't choose one (e.g. Google
 * sign-in). Starts from the email's local part and appends a numeric suffix
 * until it's free. Falls back to a random suffix after a few collisions.
 */
export async function deriveUniqueUsername(env, email) {
  const base = baseFromEmail(email);
  const candidates = [base];
  for (let i = 2; i <= 6; i++) candidates.push(`${base}-${i}`);
  for (const candidate of candidates) {
    const c = candidate.slice(0, MAX_LENGTH);
    if (!RESERVED.has(c) && !(await isUsernameTaken(env, c))) return c;
  }
  // Very unlikely fall-through: a random tail keeps sign-up from failing.
  const rand = Math.random().toString(36).slice(2, 7);
  return `${base.slice(0, MAX_LENGTH - rand.length - 1)}-${rand}`;
}
