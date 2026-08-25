// Teach @fjellrute/core's locale store how to remember a language on a phone.
//
// Core's store is platform-free state; the only two things it ever needed a
// browser for are behind the LocaleEnvironment interface in
// packages/core/src/i18n/environment.ts. On the web those resolve to
// localStorage and `<html lang>`. Here, the first becomes SecureStore and the
// second is dropped: there is no document to label, and nothing on the phone
// reads a language attribute.
//
// WHY SecureStore FOR SOMETHING THAT IS NOT A SECRET. Because core's `read`
// must be SYNCHRONOUS, and it says so: the store resolves the starting locale
// at module load so the first frame is already in the right language. Every
// ordinary key/value store on React Native — AsyncStorage, MMKV's async API,
// expo-sqlite — returns a promise, and a promise there means the app opens in
// Norwegian and then visibly flips to English one frame later, on every launch,
// for every English-speaking user. expo-secure-store's `getItem`/`setItem` are
// the synchronous pair, the app already depends on it for the session, and a
// language preference costs nothing to keep in the Keychain. If a synchronous
// general-purpose store is added later this can move to it unchanged.
//
// WHY setLocale IS CALLED AFTERWARDS. `currentLocale` in core's locale.ts is
// initialised at module load, which on this platform happens before this
// function runs — the import graph is resolved before any app code executes. So
// installing the environment alone would persist future choices but not restore
// the stored one. Re-applying it explicitly is the fix, and it is a no-op when
// the stored value already matches (core's setLocale early-returns), so the
// common case costs nothing.

import * as SecureStore from 'expo-secure-store';
import { setLocaleEnvironment } from '@fjellrute/core/i18n/environment';
import { LOCALES, setLocale, type Locale } from '@fjellrute/core/i18n/locale';

/**
 * Same key the web uses, deliberately: it is the same preference, and one name
 * for it means one thing to search for when it misbehaves. SecureStore keys may
 * only contain alphanumerics, '.', '-' and '_' — a ':' is rejected at runtime —
 * so the separator differs from the web's `randonorge:lang`.
 */
const STORAGE_KEY = 'randonorge.lang';

/** In-memory fallback, so a device where SecureStore is unavailable still switches language for the session instead of refusing to. */
let memory: string | null = null;

function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

let installed = false;

/**
 * The stored language tag, or the in-memory fallback, or null.
 *
 * Named rather than inlined because it is read from two places — as core's
 * `read` adapter, and once more below to re-apply the stored choice — and those
 * two must agree about what "stored" means. Written twice, they would drift the
 * first time the fallback behaviour changed, and the symptom would be an app
 * that persists a language but opens in the wrong one.
 */
function readStored(): string | null {
  try {
    return SecureStore.getItem(STORAGE_KEY) ?? memory;
  } catch {
    // A locked or unavailable keychain must never be what stops the app
    // starting — same reasoning as the web's private-mode localStorage.
    return memory;
  }
}

export function installLocaleStorage(): void {
  if (installed) return;
  installed = true;

  setLocaleEnvironment({
    read: readStored,
    write: (value) => {
      memory = value;
      try {
        SecureStore.setItem(STORAGE_KEY, value);
      } catch {
        // Ignore; the in-memory value still holds for this session.
      }
    },
    // No document, nothing to label.
    setDocumentLanguage: undefined,
  });

  const stored = readStored();
  if (isLocale(stored)) setLocale(stored);
}
