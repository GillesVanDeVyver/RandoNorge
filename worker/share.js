// Helpers shared by the sharing/public endpoints (worker/routes.js,
// worker/tracks.js, worker/public.js).

// URL-safe alphabet without look-alikes (no 0/O/1/l/I): a share link is
// meant to be unguessable but also occasionally read aloud or typed.
const SLUG_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';
const SLUG_LENGTH = 12; // ~60 bits of entropy — not enumerable.

/**
 * A fresh, unguessable share slug. Drawn from crypto random bytes so slugs
 * can't be predicted from one another; length gives enough entropy that a
 * collision is astronomically unlikely (the unique index is the backstop).
 */
export function newShareSlug() {
  const bytes = crypto.getRandomValues(new Uint8Array(SLUG_LENGTH));
  let out = '';
  for (const b of bytes) out += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
  return out;
}

/** Coerce a JSON value to a strict boolean, or return null if it isn't one. */
export function toBool(value) {
  if (value === true || value === false) return value;
  return null;
}
