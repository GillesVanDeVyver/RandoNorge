import { useEffect, useRef, useState } from 'react';
import { MAX_FEEDBACK_LENGTH, sendFeedback } from '../feedback/api.ts';
import { useT } from '@fjellrute/core/i18n';
import styles from './FeedbackDialog.module.css';

// In-app feedback form, opened from the account overview.
//
// It replaces a mailto: link, and the whole point of the change is that
// nothing about sending feedback should require leaving the app: no mail
// client, no subject line, no address to copy. So the dialog asks for one
// thing — the message — and prefills the reply address from the account,
// which the user may change or clear.
//
// The message is sent to /api/feedback (worker/feedback.js), which stores it
// and emails it on. A message the server accepted but could not email is
// still a success here: it is stored, it will be read, and there is nothing
// the user could usefully do about our mail provider. A failure to reach the
// server at all keeps the dialog open with the text intact, because losing
// what someone just wrote is the one outcome worth avoiding.

interface Props {
  /** Prefill for the reply address — the signed-in account's own email. */
  accountEmail: string;
  /** Close the dialog (Escape, backdrop, cancel, or after a send). */
  onClose: () => void;
}

export function FeedbackDialog({ accountEmail, onClose }: Props) {
  const t = useT();
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState(accountEmail);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Escape closes. Capture phase + stopPropagation so the planner's own
  // Escape handling (exit draw/erase mode) can't fire underneath — same
  // reasoning as DisclaimerModal.
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

  // Focus the message box on open: the dialog exists to be typed in.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const trimmed = message.trim();
  const tooLong = trimmed.length > MAX_FEEDBACK_LENGTH;
  const canSend = trimmed.length > 0 && !tooLong && !sending;

  async function submit() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await sendFeedback(trimmed, replyTo.trim());
      setSent(true);
    } catch (err) {
      // The typed text stays in state, so nothing is lost on a retry.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
      >
        {sent ? (
          // Confirmation state. Deliberately explicit that a human reads it:
          // the alpha runs on testers bothering to write in, and "thanks,
          // received" is the least we owe someone who did.
          <>
            <h2 id="feedback-title" className={styles.title}>
              {t('Takk for tilbakemeldingen!', 'Thank you for your feedback!')}
            </h2>
            <p className={styles.intro}>
              {t(
                'Meldingen er mottatt, og den blir lest. Trenger vi flere detaljer, tar vi kontakt.',
                'Your message has been received, and it will be read. If we need more detail, we will get in touch.',
              )}
            </p>
            <div className={styles.actions}>
              <span />
              <button
                type="button"
                className={styles.sendBtn}
                onClick={onClose}
                autoFocus
              >
                {t('Lukk', 'Close')}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="feedback-title" className={styles.title}>
              {t('Send tilbakemelding', 'Send feedback')}
            </h2>
            <p className={styles.intro}>
              {t(
                'Fant du en feil, mangler det noe, eller er noe forvirrende? Skriv det her — det går rett til utvikleren.',
                'Found a bug, is something missing, or is something confusing? Write it here — it goes straight to the developer.',
              )}
            </p>

            <label className={styles.label} htmlFor="feedback-message">
              {t('Melding', 'Message')}
            </label>
            <textarea
              id="feedback-message"
              ref={textareaRef}
              className={styles.textarea}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              maxLength={MAX_FEEDBACK_LENGTH}
              disabled={sending}
              placeholder={t(
                'Beskriv hva du opplevde, og hva du forventet …',
                'Describe what happened, and what you expected…',
              )}
            />
            <div className={styles.counter}>
              <span className="tnum">
                {trimmed.length} / {MAX_FEEDBACK_LENGTH}
              </span>
            </div>

            <label className={styles.label} htmlFor="feedback-reply">
              {t('Svaradresse', 'Reply address')}
              <span className={styles.optional}>
                {t('valgfritt', 'optional')}
              </span>
            </label>
            <input
              id="feedback-reply"
              type="email"
              className={styles.input}
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              disabled={sending}
              autoComplete="email"
              placeholder={accountEmail}
            />
            <p className={styles.hint}>
              {t(
                'Vi bruker denne kun for å svare deg. Tøm feltet hvis du ikke vil ha svar.',
                'We use this only to reply to you. Clear the field if you would rather not have a reply.',
              )}
            </p>

            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={onClose}
                disabled={sending}
              >
                {t('Avbryt', 'Cancel')}
              </button>
              <button
                type="button"
                className={styles.sendBtn}
                onClick={() => void submit()}
                disabled={!canSend}
              >
                {sending
                  ? t('Sender …', 'Sending…')
                  : t('Send', 'Send')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
