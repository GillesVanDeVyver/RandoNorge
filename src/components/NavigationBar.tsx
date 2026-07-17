// Floating recording bar shown top-center of the map during navigation
// mode. While recording/paused it shows the live stats (elapsed active
// time, travelled distance) with Pause/Resume and Finish; once finished it
// flips to a review state offering Save activity / Discard.

import { formatDate, formatDistance } from '../routes/format';
import { ArrowLeftIcon, FlagIcon, PauseIcon, PlayIcon } from './icons';
import styles from './NavigationBar.module.css';

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
            <button
              type="button"
              className={styles.btnFinish}
              onClick={onFinish}
              title="Finish and review your tour"
            >
              <FlagIcon />
              <span>Finish</span>
            </button>
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
  /** Name of the completed tour being reviewed. */
  name: string;
  /** ISO timestamp of when the tour was finished. */
  finishedAt: string;
  /** Active recording time in ms (null when the track predates duration). */
  elapsedMs: number | null;
  /** Recorded distance in meters (null when unknown). */
  distanceM: number | null;
  /** Back to the completed-routes list. */
  onBack: () => void;
}

/**
 * Review twin of the recording bar, shown when a completed route is opened
 * from the library. Same chip, same stats — but the session is over, so the
 * controls collapse to a single Back button and the note line identifies
 * the tour instead of surfacing recording problems.
 */
export function ReviewNavigationBar({
  name,
  finishedAt,
  elapsedMs,
  distanceM,
  onBack,
}: ReviewProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.bar} role="status">
        <button
          type="button"
          className={styles.btn}
          onClick={onBack}
          title="Back to your completed routes"
        >
          <ArrowLeftIcon />
          <span>Back</span>
        </button>
        <span className={styles.divider} aria-hidden />
        <span className={styles.stat}>
          <span className={styles.statValue}>
            {elapsedMs !== null ? formatElapsed(elapsedMs) : '–'}
          </span>
          <span className={styles.statLabel}>time</span>
        </span>
        <span className={styles.stat}>
          <span className={styles.statValue}>{formatDistance(distanceM)}</span>
          <span className={styles.statLabel}>travelled</span>
        </span>
      </div>
      <div className={styles.note}>
        {name} · Completed {formatDate(finishedAt)}
      </div>
    </div>
  );
}
