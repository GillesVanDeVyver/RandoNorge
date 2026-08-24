// Floating recording bar shown top-center of the map during navigation
// mode. While recording/paused it shows the live stats (elapsed active
// time, travelled distance) with Pause/Resume and Finish; once finished it
// flips to a review state offering Save activity / Discard.

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDate, formatDistance } from '../routes/format';
import { ArrowLeftIcon, FlagIcon, PauseIcon, PlayIcon } from './icons';
import { useT } from '../i18n/index.ts';
import styles from './NavigationBar.module.css';

/** How long (ms) the Finish button must be held before the tour ends. */
const FINISH_HOLD_MS = 1200;

/** How long (ms) the "Hold to finish" nudge stays up after an early release. */
const HINT_VISIBLE_MS = 2000;

/**
 * Finish button that must be pressed and held for {@link FINISH_HOLD_MS}
 * before {@link onFinish} fires. A loader bar inside the button fills up to
 * reflect hold progress; releasing early cancels and resets it. This guards
 * against an accidental tap ending a tour mid-hike.
 *
 * When a press is released before the hold completes, a subtle "Hold to
 * finish" hint pops up briefly so the user learns why their tap did nothing.
 */
function HoldToFinishButton({ onFinish }: { onFinish: () => void }) {
  const t = useT();
  const [progress, setProgress] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const hintTimerRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    // rafRef is still set only when the hold was in flight and hadn't reached
    // completion — i.e. the user let go early. On completion the tick clears
    // rafRef itself before onFinish, so a genuine finish never nudges.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setShowHint(true);
      if (hintTimerRef.current !== null) clearTimeout(hintTimerRef.current);
      hintTimerRef.current = window.setTimeout(
        () => setShowHint(false),
        HINT_VISIBLE_MS,
      );
    }
    setProgress(0);
  }, []);

  const start = useCallback(() => {
    if (rafRef.current !== null) return;
    // A fresh press supersedes any lingering nudge from the last early release.
    setShowHint(false);
    if (hintTimerRef.current !== null) {
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
    startRef.current = performance.now();

    const tick = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / FINISH_HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        rafRef.current = null;
        setProgress(0);
        onFinish();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [onFinish]);

  // Clean up any pending frame / hint timer if the button unmounts mid-hold.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (hintTimerRef.current !== null) clearTimeout(hintTimerRef.current);
    };
  }, []);

  return (
    <span className={styles.holdWrap}>
      <button
        type="button"
        className={`${styles.btnFinish} ${styles.btnHold}`}
        onPointerDown={(e) => {
          // Ignore secondary mouse buttons; respond to primary click / touch.
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          // Suppress the long-press callout / text selection / synthetic mouse
          // events that on touch devices can trigger a spurious pointercancel
          // and kill the hold before it completes.
          e.preventDefault();
          e.currentTarget.setPointerCapture?.(e.pointerId);
          start();
        }}
        onPointerUp={stop}
        // No onPointerLeave: pointer capture (set above) guarantees pointerup /
        // pointercancel are delivered here even if the finger drifts off the
        // button, so cancelling on leave only served to break the hold on touch
        // where a stationary press can emit a spurious leave.
        onPointerCancel={stop}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
            e.preventDefault();
            start();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === 'Enter' || e.key === ' ') stop();
        }}
        title={t(
          'Trykk og hold for å avslutte og gjennomgå turen',
          'Press and hold to finish and review your tour',
        )}
        aria-label={t(
          'Trykk og hold for å avslutte turen',
          'Press and hold to finish your tour',
        )}
      >
        <span
          className={styles.holdFill}
          style={{ transform: `scaleX(${progress})` }}
          aria-hidden
        />
        <span className={styles.holdLabel}>
          <FlagIcon />
          <span>{t('Avslutt', 'Finish')}</span>
        </span>
      </button>
      <span
        className={`${styles.holdHint} ${showHint ? styles.holdHintShow : ''}`}
        role="status"
        aria-hidden={!showHint}
      >
        {t('Hold for å avslutte', 'Hold to finish')}
      </span>
    </span>
  );
}

/** ms → "1:23:45" (or "23:45" under an hour). */
function formatElapsed(ms: number): string {
  const totalS = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

interface Props {
  status: 'recording' | 'paused' | 'finished';
  elapsedMs: number;
  /** Travelled distance in meters (client-side, live). */
  distanceM: number;
  /** Geolocation problem to surface (permission, no signal, …). */
  error: string | null;
  /** True when the finished track can be saved (signed in + enough data). */
  canSave: boolean;
  /** Why saving is unavailable (shown in the review state when !canSave). */
  cantSaveReason?: string;
  /** True while the save request is in flight. */
  saving: boolean;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onSave: () => void;
  onDiscard: () => void;
}

export function NavigationBar({
  status,
  elapsedMs,
  distanceM,
  error,
  canSave,
  cantSaveReason,
  saving,
  onPause,
  onResume,
  onFinish,
  onSave,
  onDiscard,
}: Props) {
  const t = useT();
  return (
    <div className={styles.wrap}>
      <div className={styles.bar} role="status">
        {status !== 'finished' ? (
          <>
            <span
              className={
                status === 'recording' ? styles.dotLive : styles.dotPaused
              }
              aria-hidden
            />
            <span className={styles.stat}>
              <span className={styles.statValue}>
                {formatElapsed(elapsedMs)}
              </span>
              <span className={styles.statLabel}>{t('tid', 'time')}</span>
            </span>
            <span className={styles.stat}>
              <span className={styles.statValue}>
                {formatDistance(distanceM)}
              </span>
              <span className={styles.statLabel}>{t('tilbakelagt', 'travelled')}</span>
            </span>
            <span className={styles.divider} aria-hidden />
            {status === 'recording' ? (
              <button
                type="button"
                className={styles.btn}
                onClick={onPause}
                title={t('Sett opptak på pause', 'Pause recording')}
              >
                <PauseIcon />
                <span>{t('Pause', 'Pause')}</span>
              </button>
            ) : (
              <button
                type="button"
                className={styles.btn}
                onClick={onResume}
                title={t('Fortsett opptak', 'Resume recording')}
              >
                <PlayIcon />
                <span>{t('Fortsett', 'Resume')}</span>
              </button>
            )}
            <HoldToFinishButton onFinish={onFinish} />
          </>
        ) : (
          <>
            <span className={styles.stat}>
              <span className={styles.statValue}>
                {formatElapsed(elapsedMs)}
              </span>
              <span className={styles.statLabel}>{t('tid', 'time')}</span>
            </span>
            <span className={styles.stat}>
              <span className={styles.statValue}>
                {formatDistance(distanceM)}
              </span>
              <span className={styles.statLabel}>{t('tilbakelagt', 'travelled')}</span>
            </span>
            <span className={styles.divider} aria-hidden />
            <button
              type="button"
              className={styles.btn}
              onClick={onDiscard}
              disabled={saving}
            >
              <span>{t('Forkast', 'Discard')}</span>
            </button>
            {canSave && (
              <button
                type="button"
                className={styles.btnFinish}
                onClick={onSave}
                disabled={saving}
                title={t(
                  'Lagre denne turen blant dine fullførte ruter',
                  'Save this tour to your completed routes',
                )}
              >
                <FlagIcon />
                <span>
                  {saving
                    ? t('Lagrer …', 'Saving…')
                    : t('Lagre aktivitet', 'Save activity')}
                </span>
              </button>
            )}
          </>
        )}
      </div>
      {status === 'finished' && !canSave && cantSaveReason && (
        <div className={styles.note}>{cantSaveReason}</div>
      )}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}

interface ReviewProps {
  /** Name of the completed tour (or shared route) being viewed. */
  name: string;
  /** ISO timestamp of when the tour was finished. Omitted for a shared
   *  planned route, which has no completion date. */
  finishedAt?: string;
  /** Back to the completed-routes list (or the owner's public profile). */
  onBack: () => void;
  /** Public owner's display name, shown as "by <owner>" when present. */
  owner?: string;
  /** Overrides the back button's label/tooltip (e.g. "Back to profile"). */
  backLabel?: string;
}

/**
 * Review twin of the recording bar, shown when a completed route is opened
 * from the library — and reused, read-only, for a public route/tour opened
 * from a share link. The session is over, so the chip collapses to a single
 * Back button and the note line identifies the item (its completion date
 * when it's a tour, the owner when it's someone else's shared item).
 */
export function ReviewNavigationBar({
  name,
  finishedAt,
  onBack,
  owner,
  backLabel,
}: ReviewProps) {
  const t = useT();
  const label = backLabel ?? t('Tilbake', 'Back');
  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`${styles.btn} ${styles.backChip}`}
        onClick={onBack}
        title={label}
      >
        <ArrowLeftIcon />
        <span>{label}</span>
      </button>
      <div className={styles.note}>
        {name}
        {finishedAt ? ` · ${t('Fullført', 'Completed')} ${formatDate(finishedAt)}` : ''}
        {owner ? ` · ${t('av', 'by')} ${owner}` : ''}
      </div>
    </div>
  );
}
