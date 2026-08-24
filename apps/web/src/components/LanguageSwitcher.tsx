import {
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  useLocale,
  useT,
} from '@fjellrute/core/i18n';
import { GlobeIcon } from './icons';
import styles from './LanguageSwitcher.module.css';

type Props = {
  /**
   * Surface the switcher sits on:
   *  - `dark`    (default) glass on a photo/dark background (login page)
   *  - `light`   pale/solid panels (the account chip popover)
   *  - `surface` map chrome — matches the glass tokens used by the
   *              toolbar, view toggle and info button.
   */
  variant?: 'dark' | 'light' | 'surface';
  /**
   * `quiet` (default) is the compact NO | EN pill used inside menus and
   * map chrome, where the user is already looking. `prominent` adds a
   * globe icon, spells the languages out and sits on a solid pill — for
   * places like the login page where the control has to be findable at a
   * glance against a busy photo.
   */
  emphasis?: 'quiet' | 'prominent';
  className?: string;
};

const VARIANT_CLASS = {
  dark: '',
  light: styles.light,
  surface: styles.surface,
} as const;

/**
 * Compact NO | EN language toggle. Persists the choice (via the i18n store)
 * and switches the whole UI between Norwegian and English on click.
 */
export function LanguageSwitcher({
  variant = 'dark',
  emphasis = 'quiet',
  className,
}: Props) {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const prominent = emphasis === 'prominent';

  return (
    <div
      className={[
        styles.switcher,
        VARIANT_CLASS[variant],
        prominent ? styles.prominent : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="group"
      aria-label={t('Velg språk', 'Choose language')}
    >
      {prominent && (
        <span className={styles.icon} aria-hidden="true">
          <GlobeIcon />
        </span>
      )}
      {LOCALES.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            className={`${styles.option} ${active ? styles.optionActive : ''}`}
            aria-pressed={active}
            // The visible text is sometimes just "NO"/"EN", so the full
            // language name carries the accessible name either way. It is
            // deliberately not translated: "English" should read as English
            // to someone who cannot read the current language.
            aria-label={LOCALE_LABELS[code]}
            title={LOCALE_LABELS[code]}
            onClick={() => setLocale(code)}
          >
            {prominent ? (
              // Both labels are rendered and CSS picks one, so the pill can
              // fall back to NO/EN on narrow phones without the component
              // needing to know the viewport width.
              <>
                <span className={styles.labelFull}>{LOCALE_LABELS[code]}</span>
                <span className={styles.labelShort}>
                  {LOCALE_SHORT_LABELS[code]}
                </span>
              </>
            ) : (
              LOCALE_SHORT_LABELS[code]
            )}
          </button>
        );
      })}
    </div>
  );
}
