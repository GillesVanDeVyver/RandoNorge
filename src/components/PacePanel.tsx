// Pace statistics for the recorded ("actual") route in navigation mode.
// Sits next to the elevation profile in the summary rail and describes how
// the tour was moved through time: elapsed vs. moving time, average / moving
// average / max speed, and the moving pace. All values derive from the live
// tracking session, so they keep ticking while recording and freeze on
// Finish.

import { formatDuration, formatPace, formatSpeed } from '../routes/format';
import styles from './PacePanel.module.css';

interface Props {
  /** Active recording time in ms (pauses excluded). */
  elapsedMs: number;
  /** Time actually spent moving, ms. */
  movingMs: number;
  /** Travelled distance in meters. */
  distanceM: number;
  /** Fastest observed speed, m/s (null until the first measurable move). */
  maxSpeedMps: number | null;
  /** True while no GPS line has been recorded yet. */
  waiting: boolean;
}

export function PacePanel({
  elapsedMs,
  movingMs,
  distanceM,
  maxSpeedMps,
  waiting,
}: Props) {
  // Average over the whole active recording (pauses excluded, stops
  // included) vs. average over the time actually spent moving.
  const avgSpeedMps = elapsedMs > 0 ? distanceM / (elapsedMs / 1000) : null;
  const movingSpeedMps = movingMs > 0 ? distanceM / (movingMs / 1000) : null;

  if (waiting) {
    return (
      <p className={styles.empty}>
        Waiting for GPS — your pace stats appear here as you move.
      </p>
    );
  }

  return (
    <div className={styles.grid}>
      <Stat label="Time elapsed" value={formatDuration(elapsedMs)} />
      <Stat label="Time in motion" value={formatDuration(movingMs)} />
      <Stat label="Avg speed" value={formatSpeed(avgSpeedMps)} />
      <Stat label="Avg moving speed" value={formatSpeed(movingSpeedMps)} />
      <Stat label="Max speed" value={formatSpeed(maxSpeedMps)} />
      <Stat label="Pace" value={formatPace(movingSpeedMps)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}
