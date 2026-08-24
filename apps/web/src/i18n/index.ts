/**
 * React bindings for the bilingual (Norwegian / English) UI.
 *
 * Usage inside a component:
 *
 *   const t = useT();
 *   return <button>{t('Lagre', 'Save')}</button>;
 *
 * `t(no, en)` returns the string for the active locale and the component
 * re-renders automatically when the user switches languages.
 *
 * To read or change the locale (e.g. a language switcher):
 *
 *   const { locale, setLocale } = useLocale();
 */

import { useCallback, useSyncExternalStore } from 'react';
import {
  getLocale,
  setLocale as setLocaleStore,
  subscribeLocale,
  type Locale,
} from './locale.ts';

export type { Locale } from './locale.ts';
export {
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  translate,
  pick,
  getLocale,
} from './locale.ts';

/** Subscribe a React component to the active locale. */
export function useCurrentLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/**
 * Returns a translator bound to the active locale. The returned `t`
 * function is referentially stable per locale, so it is safe to include in
 * dependency arrays.
 */
export type Translate = (no: string, en: string) => string;

export function useT(): Translate {
  const locale = useCurrentLocale();
  return useCallback(
    (no: string, en: string) => (locale === 'no' ? no : en),
    [locale],
  );
}

/** Read and set the active locale. */
export function useLocale(): {
  locale: Locale;
  setLocale: (locale: Locale) => void;
} {
  const locale = useCurrentLocale();
  return { locale, setLocale: setLocaleStore };
}
