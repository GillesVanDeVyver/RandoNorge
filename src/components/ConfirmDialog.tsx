import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from '../i18n/index.ts';
import styles from './ConfirmDialog.module.css';

interface Props {
  /**
   * Optional mark for the accent disc in the header — the icon of the thing
   * being switched to, so the question can be recognised from its shape before
   * the sentence is read. Purely decorative: the title carries the meaning.
   */
  icon?: ReactNode;
  title: string;
  /** One or two short sentences explaining the consequence of confirming. */
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  /**
   * Optional third action for questions where "no" is a real answer rather
   * than a cancellation — e.g. "reset the route?" where declining still goes
   * ahead with the switch that prompted the question. Omit for a plain
   * confirm/cancel pair, where Cancel and dismissing are the same thing.
   */
  declineLabel?: string;
  onDecline?: () => void;
  /** Esc, the backdrop and the × — always the "change nothing" escape hatch. */
  onDismiss: () => void;
  /** Styles the confirm button as destructive (used for route-wiping calls). */
  destructive?: boolean;
}

/**
 * Small modal question in the same glass panel language as SaveRouteDialog.
 * Used where a blocking answer is genuinely needed before an action can be
 * carried out — switching drawing style with a route already on the map, for
 * instance, where the app can't guess whether the existing line should be
 * kept or replaced.
 */
export function ConfirmDialog({
  icon,
  title,
  message,
  confirmLabel,
  onConfirm,
  declineLabel,
  onDecline,
  onDismiss,
  destructive = false,
}: Props) {
  const t = useT();
  // The safest answer takes focus, so a stray Enter never wipes anything:
  // "no" when it exists, otherwise Cancel.
  const safeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    safeRef.current?.focus();
  }, []);

  // Esc dismisses. Captured so the app-level Esc handler (which exits draw
  // mode) doesn't also fire behind the modal.
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

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className={styles.header}>
          {icon && (
            <span className={styles.badge} aria-hidden="true">
              {icon}
            </span>
          )}
          <div className={styles.heading}>
            <h2 className={styles.title}>{title}</h2>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onDismiss}
            aria-label={t('Lukk', 'Close')}
          >
            ×
          </button>
        </header>

        <p className={styles.message}>{message}</p>

        <footer className={styles.footer}>
          <button
            ref={safeRef}
            type="button"
            className={styles.secondaryBtn}
            onClick={declineLabel && onDecline ? onDecline : onDismiss}
          >
            {declineLabel ?? t('Avbryt', 'Cancel')}
          </button>
          <button
            type="button"
            className={`${styles.primaryBtn} ${destructive ? styles.destructiveBtn : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
