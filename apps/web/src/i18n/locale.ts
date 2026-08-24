/**
 * Core locale store for the app's bilingual (Norwegian / English) UI.
 *
 * This layer is intentionally React-free so that non-component modules
 * (formatters, API helpers, etc.) can read the active locale too. React
 * components should use the `useT` / `useLocale` hooks from `./index.ts`,
 * which subscribe to this store and re-render on change.
 *
 * The translation model is deliberately simple: instead of a separate
 * dictionary keyed by ids, callers pass both strings inline via
 * `t(no, en)`. For a two-language app this keeps each translation next to
 * where it is used and avoids drift between keys and copy.
 */

export type Locale = 'no' | 'en';

export const LOCALES: readonly Locale[] = ['no', 'en'] as const;

/** Human-readable labels for the language switcher. */
export const LOCALE_LABELS: Record<Locale, string> = {
  no: 'Norsk',
  en: 'English',
};

/** Short labels (e.g. for a compact NO/EN toggle). */
export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  no: 'NO',
  en: 'EN',
};

const STORAGE_KEY = 'randonorge:lang';

/** App default: Norwegian, since this is a Norway-focused hiking app. */
const DEFAULT_LOCALE: Locale = 'no';

function isLocale(value: unknown): value is Locale {
  return value === 'no' || value === 'en';
}

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // localStorage can throw in private-mode / sandboxed contexts.
  }
  return DEFAULT_LOCALE;
}

let currentLocale: Locale = readStoredLocale();

const listeners = new Set<(locale: Locale) => void>();

/** Current active locale. */
export function getLocale(): Locale {
  return currentLocale;
}

/** Change the active locale, persist it, and notify subscribers. */
export function setLocale(locale: Locale): void {
  if (!isLocale(locale) || locale === currentLocale) return;
  currentLocale = locale;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignore persistence failures; in-memory locale still updates.
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'no' ? 'nb' : 'en';
  }
  for (const listener of listeners) listener(locale);
}

/** Subscribe to locale changes. Returns an unsubscribe function. */
export function subscribeLocale(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Translate an inline pair using the current locale. Safe to call from
 * non-React code. React components should prefer the `useT` hook so they
 * re-render when the locale changes.
 */
export function translate(no: string, en: string): string {
  return currentLocale === 'no' ? no : en;
}

/** Pick a value by locale (useful for non-string values). */
export function pick<T>(no: T, en: T): T {
  return currentLocale === 'no' ? no : en;
}
