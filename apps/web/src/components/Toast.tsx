import type { ReactNode } from 'react';
import { UndoIcon } from './icons';
import { useT } from '../i18n/index.ts';
import styles from './Toast.module.css';

interface Props {
  message: string;
  actionLabel?: string;
  /** Icon shown before the action label. Defaults to the undo arrow; pass
   *  null to render a plain text action. */
  actionIcon?: ReactNode;
  onAction?: () => void;
  onDismiss: () => void;
}

// A single transient glass toast pinned bottom-centre, above the profile
// card. Used for the non-destructive "Route cleared — Undo" pattern that
// replaces the old blocking window.confirm() dialog.
export function Toast({
  message,
  actionLabel,
  actionIcon = <UndoIcon />,
  onAction,
  onDismiss,
}: Props) {
  const t = useT();
  return (
    <div className={styles.toast} role="status">
      <span className={styles.message}>{message}</span>
      {actionLabel && onAction && (
        <button type="button" className={styles.action} onClick={onAction}>
          {actionIcon}
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        className={styles.dismiss}
        onClick={onDismiss}
        aria-label={t('Lukk', 'Dismiss')}
      >
        ×
      </button>
    </div>
  );
}
