// Client-side password policy, following NIST SP 800-63B: length is the
// only hard rule (min 8, max 128), no forced composition classes, but
// very common passwords are rejected. The server independently enforces
// the length limits (worker/auth.js); this module exists for instant
// feedback in the sign-up form.

import { translate } from '../i18n/locale.ts';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

// Excerpt of the most-used passwords (SecLists / NCSC "top" lists),
// pre-normalised to lowercase. Checked against the lowercased input so
// "Password1!" style variants of trivial passwords still pass length
// checks but the worst offenders are caught.
const COMMON_PASSWORDS = new Set([
  '123456', '12345678', '123456789', '1234567890', 'password', 'password1',
  'password123', 'passord', 'passord1', 'qwerty', 'qwerty123', 'qwertyuiop',
  '111111', '123123', '000000', 'abc123', '1q2w3e4r', 'iloveyou', 'admin',
  'welcome', 'welcome1', 'monkey', 'dragon', 'letmein', 'sunshine',
  'princess', 'football', 'baseball', 'superman', 'batman', 'trustno1',
  'master', 'shadow', 'michael', 'jennifer', 'computer', 'whatever',
  'summer', 'winter', 'hello123', 'freedom', 'starwars', 'pokemon',
  '654321', '666666', '696969', '112233', '121212', '789456', 'aa123456',
  'a123456', 'secret', 'norge123', 'fjellrute',
]);

export type PasswordCheck =
  | { ok: true; strength: 'fair' | 'good' | 'strong' }
  | { ok: false; error: string };

/** Validate a candidate password and estimate its strength. */
export function checkPassword(password: string): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: translate(
        `Bruk minst ${MIN_PASSWORD_LENGTH} tegn.`,
        `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      ),
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: translate(
        `Bruk høyst ${MAX_PASSWORD_LENGTH} tegn.`,
        `Use at most ${MAX_PASSWORD_LENGTH} characters.`,
      ),
    };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return {
      ok: false,
      error: translate(
        'Dette passordet er for vanlig. Velg noe som er vanskeligere å gjette.',
        'That password is too common. Pick something less guessable.',
      ),
    };
  }
  // Rough strength hint: reward length and character variety. Purely
  // advisory; only the checks above are blocking.
  const classes =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^a-zA-Z0-9]/.test(password));
  const score = password.length + classes * 3;
  return {
    ok: true,
    strength: score >= 26 ? 'strong' : score >= 17 ? 'good' : 'fair',
  };
}
