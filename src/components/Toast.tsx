import { UndoIcon } from './icons';
import styles from './Toast.module.css';

interface Props {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

// A single transient glass toast pinned bottom-centre, above the profile
// card. Used for the non-destructive "Route cleared — Undo" pattern that
// replaces the old blocking window.confirm() dialog.
export function Toast({ message, actionLabel, onAction, onDismiss }: Props) {
  return (
    <div className={styles.toast} role="status">
      <span className={styles.message}>{message}</span>
      {actionLabel && onAction && (
        <button type="button" className={styles.action} onClick={onAction}>
          <UndoIcon />
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        className={styles.dismiss}
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
