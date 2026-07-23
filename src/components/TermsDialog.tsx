import { useEffect, useRef, useState } from 'react';
import { TERMS, TERMS_VERSION, type TermsLang } from '../terms/content';
import { PRIVACY, PRIVACY_VERSION } from '../terms/privacy';
import { useLocale } from '../i18n/index.ts';
import styles from './TermsDialog.module.css';

// In-app reference view of the terms of use and the privacy policy, shown
// in a modal (opened from the ⓘ button). The texts live in
// src/terms/content.ts and src/terms/privacy.ts and are the SAME texts the
// user accepted on the TermsPage gate — the two must never diverge, so this
// component only provides the modal chrome.

interface Props {
  onClose: () => void;
}

export function TermsDialog({ onClose }: Props) {
  // Language follows the app-wide locale so the terms match the rest of the
  // UI and the NO/EN toggle here stays in sync with the global switcher.
  const { locale, setLocale } = useLocale();
  const lang: TermsLang = locale;
  const [doc, setDoc] = useState<'terms' | 'privacy'>('terms');
  const panelRef = useRef<HTMLDivElement>(null);
  const t = TERMS[lang];
  const p = PRIVACY[lang];
  const active = doc === 'terms' ? t : p;
  const activeVersion = doc === 'terms' ? TERMS_VERSION : PRIVACY_VERSION;

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
          <h2 className={styles.title}>{active.title}</h2>
          <div
            className={styles.langToggle}
            role="group"
            aria-label={lang === 'en' ? 'Language' : 'Språk'}
          >
            <button
              type="button"
              className={lang === 'en' ? styles.langActive : ''}
              onClick={() => setLocale('en')}
              aria-pressed={lang === 'en'}
            >
              EN
            </button>
            <button
              type="button"
              className={lang === 'no' ? styles.langActive : ''}
              onClick={() => setLocale('no')}
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
        <div
          className={styles.docTabs}
          role="tablist"
          aria-label={lang === 'en' ? 'Document' : 'Dokument'}
        >
          <button
            type="button"
            role="tab"
            aria-selected={doc === 'terms'}
            className={doc === 'terms' ? styles.docActive : ''}
            onClick={() => setDoc('terms')}
          >
            {t.title}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={doc === 'privacy'}
            className={doc === 'privacy' ? styles.docActive : ''}
            onClick={() => setDoc('privacy')}
          >
            {p.title}
          </button>
        </div>
        <div className={styles.body}>
          <p className={styles.updated}>
            {active.updated}: {activeVersion}
          </p>
          {active.sections.map((s) => (
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
