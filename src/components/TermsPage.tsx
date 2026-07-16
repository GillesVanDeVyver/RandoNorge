import { useState } from 'react';
import { MountainIcon } from './icons';
import { TERMS, TERMS_VERSION, type TermsLang } from '../terms/content';
import { PRIVACY, PRIVACY_VERSION } from '../terms/privacy';
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
 *
 * Two documents are presented in tabs — the terms of use and the privacy
 * policy (GDPR arts. 12–14 require the privacy information to be available
 * at the point where data collection starts, i.e. before sign-up) — and the
 * accept button covers both, as its label states.
 */
export function TermsPage({ onAccept, onDecline }: Props) {
  const [lang, setLang] = useState<TermsLang>('en');
  const [doc, setDoc] = useState<'terms' | 'privacy'>('terms');
  const t = TERMS[lang];
  const p = PRIVACY[lang];
  const active = doc === 'terms' ? t : p;
  const activeVersion = doc === 'terms' ? TERMS_VERSION : PRIVACY_VERSION;

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
            <h1 className={styles.title}>{active.title}</h1>
            <p className={styles.updated}>
              {active.updated}: {activeVersion}
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

        <div
          className={styles.docTabs}
          role="tablist"
          aria-label={lang === 'en' ? 'Document' : 'Dokument'}
        >
          <button
            type="button"
            role="tab"
            className={styles.docTab}
            aria-selected={doc === 'terms'}
            data-active={doc === 'terms' || undefined}
            onClick={() => setDoc('terms')}
          >
            {t.title}
          </button>
          <button
            type="button"
            role="tab"
            className={styles.docTab}
            aria-selected={doc === 'privacy'}
            data-active={doc === 'privacy' || undefined}
            onClick={() => setDoc('privacy')}
          >
            {p.title}
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.intro}>{active.intro}</p>
          {active.sections.map((section) => (
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
