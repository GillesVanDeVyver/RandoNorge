// The two things the locale store does to its host, behind an interface.
//
// The store itself is plain state and needs no platform. What it needed was a
// browser: `window.localStorage` to remember the choice across launches, and
// `document.documentElement.lang` so that screen readers and the browser's own
// hyphenation follow the switch. Neither exists on React Native, and neither is
// visible to a Node verification harness — the store already guarded both with
// `typeof window === 'undefined'`, which is the shape of this file made
// explicit and typed.
//
// Nothing about the browser's behaviour changes. The defaults below resolve to
// exactly the globals the store used to reach for, and they are read at module
// load in the same order and with the same try/catch, so a private-mode browser
// that throws on localStorage still falls back to the in-memory locale.
//
// On React Native, Phase 2 installs a persistence adapter over AsyncStorage:
//
//   setLocaleEnvironment({
//     read: () => stored,              // hydrated before the app renders
//     write: (v) => void AsyncStorage.setItem(KEY, v),
//     setDocumentLanguage: undefined,  // no document to label
//   });
//
// The read is synchronous on purpose: the store resolves the starting locale at
// module load so that the first render is already in the right language, and a
// promise there would mean every screen flashing Norwegian first.

/** What the locale store needs from its host. Every member is optional: a
 *  platform that can do none of it gets an in-memory locale, which is what the
 *  server-side harnesses have always had. */
export interface LocaleEnvironment {
  /** The remembered locale, or null. Must be synchronous — see above. */
  read?: () => string | null;
  /** Persist a locale. Failures must be swallowed by the implementation. */
  write?: (value: string) => void;
  /** Label the host document, e.g. `<html lang="nb">`. */
  setDocumentLanguage?: (bcp47: string) => void;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface DocumentLike {
  documentElement: { lang: string };
}

const STORAGE_KEY = 'randonorge:lang';

// Reached through globalThis with a locally declared shape, rather than through
// the DOM lib, because this package compiles without it — that absence is what
// stops a module elsewhere in core from quietly depending on a browser.
const g = globalThis as {
  localStorage?: StorageLike;
  document?: DocumentLike;
};

const browserEnvironment: LocaleEnvironment = {
  read: () => {
    try {
      return g.localStorage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      // localStorage throws, not returns null, in private-mode and sandboxed
      // contexts. Reading it must never be what stops the app starting.
      return null;
    }
  },
  write: (value) => {
    try {
      g.localStorage?.setItem(STORAGE_KEY, value);
    } catch {
      // Ignore persistence failures; the in-memory locale still updates.
    }
  },
  setDocumentLanguage: g.document
    ? (bcp47) => {
        const doc = g.document;
        if (doc) doc.documentElement.lang = bcp47;
      }
    : undefined,
};

let environment: LocaleEnvironment = browserEnvironment;

/** Replace the host bindings. Pass null to restore the platform default. */
export function setLocaleEnvironment(next: LocaleEnvironment | null): void {
  environment = next ?? browserEnvironment;
}

export function readStoredLocaleValue(): string | null {
  return environment.read?.() ?? null;
}

export function writeStoredLocaleValue(value: string): void {
  environment.write?.(value);
}

export function setDocumentLanguage(bcp47: string): void {
  environment.setDocumentLanguage?.(bcp47);
}
