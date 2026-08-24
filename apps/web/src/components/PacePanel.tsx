// Pace statistics for the recorded ("actual") route in navigation mode.
// Sits next to the elevation profile in the summary rail and describes how
// the tour was moved through time: elapsed vs. moving time, average / moving
// average / max speed, and the moving pace. All values derive from the live
// tracking session, so they keep ticking while recording and freeze on
// Finish.

import { formatDuration, formatPace, formatSpeed } from '../routes/format';
import { useT } from '../i18n/index.ts';
import styles from './PacePanel.module.css';

interface Props {
  /** Active recording time in ms (pauses excluded); null when unknown
   *  (e.g. reviewing a saved track that predates duration recording). */
  elapsedMs: number | null;
  /** Time actually spent moving, ms; null when unknown (saved tracks only
   *  store the total active time, not the moving/standing split). */
  movingMs: number | null;
  /** Travelled distance in meters. */
  distanceM: number;
  /** Fastest observed speed, m/s (null until the first measurable move,
   *  or unknown when reviewing a saved track). */
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
  const t = useT();
  // Average over the whole active recording (pauses excluded, stops
  // included) vs. average over the time actually spent moving.
  const avgSpeedMps =
    elapsedMs !== null && elapsedMs > 0 ? distanceM / (elapsedMs / 1000) : null;
  const movingSpeedMps =
    movingMs !== null && movingMs > 0 ? distanceM / (movingMs / 1000) : null;

  if (waiting) {
    return (
      <p className={styles.empty}>
        {t(
          'Venter på GPS – tempostatistikken din vises her etter hvert som du beveger deg.',
          'Waiting for GPS — your pace stats appear here as you move.',
        )}
      </p>
    );
  }

  return (
    <div className={styles.grid}>
      <Stat label={t('Medgått tid', 'Time elapsed')} value={formatDuration(elapsedMs)} />
      <Stat label={t('Tid i bevegelse', 'Time in motion')} value={formatDuration(movingMs)} />
      <Stat label={t('Snittfart', 'Avg speed')} value={formatSpeed(avgSpeedMps)} />
      <Stat label={t('Snittfart i bevegelse', 'Avg moving speed')} value={formatSpeed(movingSpeedMps)} />
      <Stat label={t('Maksfart', 'Max speed')} value={formatSpeed(maxSpeedMps)} />
      <Stat label={t('Tempo', 'Pace')} value={formatPace(movingSpeedMps)} />
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
