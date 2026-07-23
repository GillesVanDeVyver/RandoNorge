import { useEffect, useRef } from 'react';
import { useT } from '../i18n/index.ts';
import styles from './DisclaimerModal.module.css';

// First-run safety disclaimer, shown once per session before planning. It is
// deliberately lightweight (a single acknowledgement) and separate from the
// full Terms of Use gate (TermsPage) and the in-app reference (TermsDialog):
// its job is to put the core safety framing in front of the user every
// session — Fjellrute is a planning aid, not a substitute for avalanche
// training, judgement, or the official Varsom bulletin — not to collect legal
// acceptance. The wording deliberately mirrors §1 and §3 of the Terms of Use
// (src/terms/content.ts) so the two can never appear to contradict each other.
//
// Copy follows the app-wide locale via useT, so it matches the rest of the
// UI and the terms gate. The wording still mirrors §1 and §3 of the Terms of
// Use in both languages.

interface Props {
  /** The user acknowledged the disclaimer (or dismissed it). */
  onDismiss: () => void;
  /** Open the full Terms of Use / Privacy reference dialog. */
  onOpenTerms: () => void;
}

export function DisclaimerModal({ onDismiss, onOpenTerms }: Props) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Esc dismisses. Capture-phase + stopPropagation so the app-level Esc
  // handler (which exits draw/erase mode) doesn't also fire underneath.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDismiss]);

  // Move focus onto the acknowledge button when the modal opens.
  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="disclaimer-title"
        aria-describedby="disclaimer-body"
        tabIndex={-1}
      >
        <h2 id="disclaimer-title" className={styles.title}>
          {t('Planlegg nøye – stol så på terrenget', 'Plan carefully — then trust the terrain')}
        </h2>
        <div id="disclaimer-body" className={styles.body}>
          <p className={styles.lead}>
            {t('Fjellrute er et ', 'Fjellrute is a ')}
            <strong>{t('planleggingsverktøy', 'planning aid')}</strong>
            {t(
              ' – ikke en erstatning for skredopplæring, dine egne vurderinger eller det offisielle snøskredvarselet fra Varsom.',
              ' — not a substitute for avalanche training, your own judgement, or the official Varsom avalanche bulletin.',
            )}
          </p>
          <p className={styles.paragraph}>
            {t(
              'Kart, bratthets- og utløpsmodeller, snø-, vær- og skreddata er estimater og prognoser. De kan være feil eller utdaterte: virkelige heng kan være brattere, og skred kan gå lenger enn kartet viser. Du kan se hele det regionale varselet på ',
              'Maps, steepness and runout models, snow, weather and avalanche data are estimates and forecasts. They can be wrong or out of date: real slopes can be steeper, and avalanches can run further than the map shows. You can see the full regional bulletin at ',
            )}
            <a
              href="https://varsom.no/"
              target="_blank"
              rel="noopener noreferrer"
            >
              varsom.no
            </a>
            {t(
              '. Stemmer ikke terrenget med appen, stol på terrenget.',
              '. If what you see in the terrain disagrees with the app, trust the terrain.',
            )}
          </p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={onOpenTerms}
          >
            {t('Les de fullstendige vilkårene', 'Read the full terms')}
          </button>
          <button
            ref={buttonRef}
            type="button"
            className={styles.acceptBtn}
            onClick={onDismiss}
          >
            {t('Jeg forstår', 'I understand')}
          </button>
        </div>
      </div>
    </div>
  );
}
