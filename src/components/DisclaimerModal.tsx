import { useEffect, useRef } from 'react';
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
// TODO(i18n): English only for now. The whole app still needs a Norwegian
// translation (see docs/TODO-i18n.md). When that lands, this copy should move
// into the shared string catalogue and follow the EN/NO language toggle the
// terms already use.

interface Props {
  /** The user acknowledged the disclaimer (or dismissed it). */
  onDismiss: () => void;
  /** Open the full Terms of Use / Privacy reference dialog. */
  onOpenTerms: () => void;
}

export function DisclaimerModal({ onDismiss, onOpenTerms }: Props) {
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
          Plan carefully — then trust the terrain
        </h2>
        <div id="disclaimer-body" className={styles.body}>
          <p className={styles.lead}>
            Fjellrute is a <strong>planning aid</strong> — not a substitute for
            avalanche training, your own judgement, or the official Varsom
            avalanche bulletin.
          </p>
          <p className={styles.paragraph}>
            Maps, steepness and runout models, snow, weather and avalanche data
            are estimates and forecasts. They can be wrong or out of date: real
            slopes can be steeper, and avalanches can run further than the map
            shows. You can see the full regional bulletin at{' '}
            <a
              href="https://varsom.no/"
              target="_blank"
              rel="noopener noreferrer"
            >
              varsom.no
            </a>
            . If what you see in the terrain disagrees with the app, trust the
            terrain.
          </p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={onOpenTerms}
          >
            Read the full terms
          </button>
          <button
            ref={buttonRef}
            type="button"
            className={styles.acceptBtn}
            onClick={onDismiss}
          >
            I understand
          </button>
        </div>
      </div>
    </div>
  );
}
