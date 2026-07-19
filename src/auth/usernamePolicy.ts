// Client-side username (public handle) policy — the mirror of the server's
// rules in worker/usernameRules.js. The handle is chosen at sign-up and
// becomes the account's /u/<username> profile URL, so it is validated to a
// conservative, URL-safe shape. This module exists for instant feedback in
// the sign-up form; the worker validates independently and owns uniqueness.

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 30;

// Letters/digits, with single internal hyphens or underscores; must start
// and end alphanumeric.
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/;

// Reserved handles that collide with app paths or look official.
const RESERVED = new Set([
  'admin', 'api', 'auth', 'fjellrute', 'help', 'login', 'logout', 'me',
  'planner', 'profile', 'root', 'settings', 'signup', 'support', 'u',
]);

export type UsernameCheck =
  | { ok: true; username: string }
  | { ok: false; error: string };

/** Validate a candidate handle, returning the normalized (lower-cased,
 *  trimmed) value or a user-facing error message. */
export function checkUsername(raw: string): UsernameCheck {
  const username = raw.trim().toLowerCase();
  if (
    username.length < MIN_USERNAME_LENGTH ||
    username.length > MAX_USERNAME_LENGTH
  ) {
    return {
      ok: false,
      error: `Username must be ${MIN_USERNAME_LENGTH}–${MAX_USERNAME_LENGTH} characters.`,
    };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      error:
        'Use letters, numbers, hyphens and underscores; start and end with a letter or number.',
    };
  }
  if (RESERVED.has(username)) {
    return { ok: false, error: 'That username is reserved.' };
  }
  return { ok: true, username };
}
