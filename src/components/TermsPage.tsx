import { useState } from 'react';
import { MountainIcon } from './icons';
import { TERMS, TERMS_VERSION, type TermsLang } from '../terms/content';
import styles from './TermsPage.module.css';

// Re-exported for callers that record which version was accepted. The terms
// text itself lives in src/terms/content.ts, shared with TermsDialog so the
// gate and the in-app reference can never drift apart.
export { TERMS_VERSION };

type Props = {
  /** The user read the terms and pressed Accept. */
  onAccept: () => void;
  /** The user declined — return to wherever they came from. */
  onDecline: () => void;
};

/**
 * Full-screen terms gate shown before sign-up (email or Google) and before
 * entering the app as a guest. Acceptance is deliberately not persisted:
 * sign-up simply cannot complete without it, and guests are asked on every
 * visit.
 */
export function TermsPage({ onAccept, onDecline }: Props) {
  const [lang, setLang] = useState<TermsLang>('en');
  const t = TERMS[lang];

  return (
    <div className={styles.page}>
      <div className={styles.scrim} aria-hidden="true" />

      <header className={styles.brand}>
        <span className={styles.brandIcon}>
          <MountainIcon />
        </span>
        <span className={styles.brandName}>Fjellrute</span>
      </header>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h1 className={styles.title}>{t.title}</h1>
            <p className={styles.updated}>
              {t.updated}: {TERMS_VERSION}
            </p>
          </div>
          <div
            className={styles.langToggle}
            role="group"
            aria-label="Language"
          >
            <button
              type="button"
              className={styles.langBtn}
              data-active={lang === 'en' || undefined}
              onClick={() => setLang('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={styles.langBtn}
              data-active={lang === 'no' || undefined}
              onClick={() => setLang('no')}
            >
              NO
            </button>
          </div>
        </div>

        <div className={styles.body}>
          <p className={styles.intro}>{t.intro}</p>
          {t.sections.map((section) => (
            <section key={section.heading}>
              <h2 className={styles.sectionHeading}>{section.heading}</h2>
              {section.body.map((paragraph, i) => (
                <p key={i} className={styles.paragraph}>
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <footer className={styles.footer}>
          <p className={styles.gateNote}>{t.gateNote}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.declineBtn}
              onClick={onDecline}
            >
              {t.declineLabel}
            </button>
            <button
              type="button"
              className={styles.acceptBtn}
              onClick={onAccept}
            >
              {t.acceptLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
