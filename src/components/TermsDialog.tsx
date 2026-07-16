import { useEffect, useRef, useState } from 'react';
import { TERMS, TERMS_VERSION, type TermsLang } from '../terms/content';
import styles from './TermsDialog.module.css';

// In-app reference view of the terms of use, shown in a modal (opened from
// the ⓘ button). The text itself lives in src/terms/content.ts and is the
// SAME text the user accepted on the TermsPage gate — the two must never
// diverge, so this component only provides the modal chrome.

interface Props {
  onClose: () => void;
}

export function TermsDialog({ onClose }: Props) {
  const [lang, setLang] = useState<TermsLang>('en');
  const panelRef = useRef<HTMLDivElement>(null);
  const t = TERMS[lang];

  // Esc closes the dialog. Stop propagation so the app-level Esc handler
  // (which exits draw/erase mode) doesn't also fire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Move focus into the dialog when it opens.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>{t.title}</h2>
          <div
            className={styles.langToggle}
            role="group"
            aria-label="Language"
          >
            <button
              type="button"
              className={lang === 'en' ? styles.langActive : ''}
              onClick={() => setLang('en')}
              aria-pressed={lang === 'en'}
            >
              EN
            </button>
            <button
              type="button"
              className={lang === 'no' ? styles.langActive : ''}
              onClick={() => setLang('no')}
              aria-pressed={lang === 'no'}
            >
              NO
            </button>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={lang === 'en' ? 'Close' : 'Lukk'}
          >
            ×
          </button>
        </header>
        <div className={styles.body}>
          <p className={styles.updated}>
            {t.updated}: {TERMS_VERSION}
          </p>
          {t.sections.map((s) => (
            <section key={s.heading}>
              <h3 className={styles.sectionHeading}>{s.heading}</h3>
              {s.body.map((p, i) => (
                <p key={i} className={styles.paragraph}>
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
