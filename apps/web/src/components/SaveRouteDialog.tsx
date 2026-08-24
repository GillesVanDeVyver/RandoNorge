import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useT } from '../i18n/index.ts';
import styles from './SaveRouteDialog.module.css';

interface Props {
  /** Prefilled when re-saving a route opened from the library. */
  initialName?: string;
  initialDescription?: string;
  /** True when saving updates an existing route instead of creating one. */
  isUpdate: boolean;
  /** Preformatted stats shown under the title, e.g. "12.4 km · 1 240 m ascent". */
  statsLabel: string | null;
  /** Resolves on success; a thrown error is shown inline. */
  onSave: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Modal shown by the toolbar's save button: name (required) + optional
 * notes, then hands off to the routes API. Same glass panel language as
 * TermsDialog. While the request is in flight the form is locked; errors
 * (network, validation) surface inline so nothing typed is ever lost.
 */
export function SaveRouteDialog({
  initialName = '',
  initialDescription = '',
  isUpdate,
  statsLabel,
  onSave,
  onClose,
}: Props) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Esc closes the dialog (capture phase, so the app-level Esc handler that
  // exits draw mode doesn't also fire). Ignored while a save is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!busy) onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, busy]);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed, description.trim());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Kunne ikke lagre ruta', 'Could not save the route'),
      );
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={
          isUpdate
            ? t('Lagre endringer i ruta', 'Save changes to route')
            : t('Lagre rute', 'Save route')
        }
        onSubmit={handleSubmit}
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 className={styles.title}>
              {isUpdate
                ? t('Lagre endringer', 'Save changes')
                : t('Lagre rute', 'Save route')}
            </h2>
            {statsLabel && <p className={`${styles.stats} tnum`}>{statsLabel}</p>}
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            disabled={busy}
            aria-label={t('Lukk', 'Close')}
          >
            ×
          </button>
        </header>

        <div className={styles.body}>
          <label className={styles.label} htmlFor="save-route-name">
            {t('Navn', 'Name')}
          </label>
          <input
            ref={nameRef}
            id="save-route-name"
            className={styles.input}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('f.eks. Storebjørn fra Krossbu', 'e.g. Storebjørn from Krossbu')}
            maxLength={120}
            required
            disabled={busy}
          />

          <label className={styles.label} htmlFor="save-route-description">
            {t('Notater', 'Notes')}{' '}
            <span className={styles.optional}>
              {t('(valgfritt)', '(optional)')}
            </span>
          </label>
          <textarea
            id="save-route-description"
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t(
              'Forhold, plan B, ting å huske …',
              'Conditions, plan B, things to remember…',
            )}
            rows={3}
            maxLength={2000}
            disabled={busy}
          />

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onClose}
            disabled={busy}
          >
            {t('Avbryt', 'Cancel')}
          </button>
          <button
            type="submit"
            className={styles.primaryBtn}
            disabled={busy || !name.trim()}
          >
            {busy
              ? t('Lagrer …', 'Saving…')
              : isUpdate
                ? t('Lagre endringer', 'Save changes')
                : t('Lagre rute', 'Save route')}
          </button>
        </footer>
      </form>
    </div>
  );
}
