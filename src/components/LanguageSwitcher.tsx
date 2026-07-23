import { LOCALES, LOCALE_SHORT_LABELS, useLocale, useT } from '../i18n/index.ts';
import styles from './LanguageSwitcher.module.css';

type Props = {
  /** Use the light variant for pale/solid backgrounds. Default: dark (for
   *  photo/glass backgrounds like the account overview and login page). */
  variant?: 'dark' | 'light';
  className?: string;
};

/**
 * Compact NO | EN language toggle. Persists the choice (via the i18n store)
 * and switches the whole UI between Norwegian and English on click.
 */
export function LanguageSwitcher({ variant = 'dark', className }: Props) {
  const { locale, setLocale } = useLocale();
  const t = useT();

  return (
    <div
      className={[
        styles.switcher,
        variant === 'light' ? styles.light : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="group"
      aria-label={t('Velg språk', 'Choose language')}
    >
      {LOCALES.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            className={`${styles.option} ${active ? styles.optionActive : ''}`}
            aria-pressed={active}
            onClick={() => setLocale(code)}
          >
            {LOCALE_SHORT_LABELS[code]}
          </button>
        );
      })}
    </div>
  );
}
