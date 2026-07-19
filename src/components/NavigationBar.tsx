// Floating recording bar shown top-center of the map during navigation
// mode. While recording/paused it shows the live stats (elapsed active
// time, travelled distance) with Pause/Resume and Finish; once finished it
// flips to a review state offering Save activity / Discard.

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDate, formatDistance } from '../routes/format';
import { ArrowLeftIcon, FlagIcon, PauseIcon, PlayIcon } from './icons';
import styles from './NavigationBar.module.css';

/** How long (ms) the Finish button must be held before the tour ends. */
const FINISH_HOLD_MS = 1200;

/**
 * Finish button that must be pressed and held for {@link FINISH_HOLD_MS}
 * before {@link onFinish} fires. A loader bar inside the button fills up to
 * reflect hold progress; releasing early cancels and resets it. This guards
 * against an accidental tap ending a tour mid-hike.
 */
function HoldToFinishButton({ onFinish }: { onFinish: () => void }) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setProgress(0);
  }, []);

  const start = useCallback(() => {
    if (rafRef.current !== null) return;
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

  // Clean up any pending frame if the button unmounts mid-hold.
  useEffect(() => stop, [stop]);

  return (
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
      title="Press and hold to finish and review your tour"
      aria-label="Press and hold to finish your tour"
    >
      <span
        className={styles.holdFill}
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden
      />
      <span className={styles.holdLabel}>
        <FlagIcon />
        <span>Finish</span>
      </span>
    </button>
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
              <span className={styles.statLabel}>time</span>
            </span>
            <span className={styles.stat}>
              <span className={styles.statValue}>
                {formatDistance(distanceM)}
              </span>
              <span className={styles.statLabel}>travelled</span>
            </span>
            <span className={styles.divider} aria-hidden />
            {status === 'recording' ? (
              <button
                type="button"
                className={styles.btn}
                onClick={onPause}
                title="Pause recording"
              >
                <PauseIcon />
                <span>Pause</span>
              </button>
            ) : (
              <button
                type="button"
                className={styles.btn}
                onClick={onResume}
                title="Resume recording"
              >
                <PlayIcon />
                <span>Resume</span>
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
              <span className={styles.statLabel}>time</span>
            </span>
            <span className={styles.stat}>
              <span className={styles.statValue}>
                {formatDistance(distanceM)}
              </span>
              <span className={styles.statLabel}>travelled</span>
            </span>
            <span className={styles.divider} aria-hidden />
            <button
              type="button"
              className={styles.btn}
              onClick={onDiscard}
              disabled={saving}
            >
              <span>Discard</span>
            </button>
            {canSave && (
              <button
                type="button"
                className={styles.btnFinish}
                onClick={onSave}
                disabled={saving}
                title="Save this tour to your completed routes"
              >
                <FlagIcon />
                <span>{saving ? 'Saving…' : 'Save activity'}</span>
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
  backLabel = 'Back',
}: ReviewProps) {
  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`${styles.btn} ${styles.backChip}`}
        onClick={onBack}
        title={backLabel}
      >
        <ArrowLeftIcon />
        <span>{backLabel}</span>
      </button>
      <div className={styles.note}>
        {name}
        {finishedAt ? ` · Completed ${formatDate(finishedAt)}` : ''}
        {owner ? ` · by ${owner}` : ''}
      </div>
    </div>
  );
}
