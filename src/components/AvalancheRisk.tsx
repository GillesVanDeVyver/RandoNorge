import type { ProfileData } from '../elevation/profile';
import { useAvalanche } from '../avalanche/useAvalanche';
import styles from './AvalancheRisk.module.css';

interface Props {
  profile: ProfileData;
}

// EAWS / Varsom danger levels, translated from the Norwegian "snøskredfare"
// scale shown on senorge.no. Colours mirror the senorge legend.
interface LevelInfo {
  label: string; // English translation
  color: string; // badge background
  onColor: string; // text on the badge
}
const LEVELS: Record<number, LevelInfo> = {
  1: { label: 'Low avalanche danger', color: '#6dbe45', onColor: '#0a2a06' },
  2: { label: 'Moderate avalanche danger', color: '#f4d63f', onColor: '#3a3000' },
  3: { label: 'Considerable avalanche danger', color: '#f0922f', onColor: '#3a1e00' },
  4: { label: 'High avalanche danger', color: '#e23c34', onColor: '#ffffff' },
  5: { label: 'Very high avalanche danger', color: '#3a464e', onColor: '#ffffff' },
};

// Full danger scale, including the "not rated" state, for the reference
// legend shown beneath the route's current risk.
const SCALE: { level: number; symbol: string }[] = [
  { level: 0, symbol: '?' },
  { level: 1, symbol: '1' },
  { level: 2, symbol: '2' },
  { level: 3, symbol: '3' },
  { level: 4, symbol: '4' },
  { level: 5, symbol: '5' },
];

function Legend() {
  return (
    <div className={styles.legend}>
      {SCALE.map(({ level, symbol }) => {
        const info = LEVELS[level];
        const style = info
          ? { background: info.color, color: info.onColor }
          : undefined;
        return (
          <div key={level} className={styles.legendItem}>
            <span
              className={`${styles.legendBadge} ${info ? '' : styles.badgeUnrated}`}
              style={style}
            >
              {symbol}
            </span>
            <span className={styles.legendLabel}>
              {info ? info.label : 'Not rated'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function AvalancheRisk({ profile }: Props) {
  const { level, regions, loading, error } = useAvalanche(profile);

  let current: React.ReactNode;
  if (error && level === 0 && regions.length === 0) {
    current = <div className={styles.status}>Avalanche risk unavailable</div>;
  } else if (loading && level === 0) {
    current = <div className={styles.status}>Loading avalanche risk…</div>;
  } else if (level === 0) {
    // No assessed region along the route — typically outside the winter
    // forecasting season. Mirrors senorge's "Ikke vurdert" state.
    current = (
      <div className={styles.row}>
        <div className={`${styles.badge} ${styles.badgeUnrated}`} aria-hidden>
          –
        </div>
        <div className={styles.info}>
          <span className={styles.label}>Not assessed</span>
          <span className={styles.regions}>
            No avalanche warning for this area
          </span>
        </div>
      </div>
    );
  } else {
    const info = LEVELS[level];
    const names = regions.map((r) => r.regionName);
    const regionText =
      names.length > 1
        ? `Highest of ${names.length} regions: ${names.join(', ')}`
        : names[0];
    current = (
      <div className={styles.row}>
        <div
          className={styles.badge}
          style={{ background: info.color, color: info.onColor }}
          aria-label={`Avalanche danger level ${level} of 5`}
        >
          {level}
        </div>
        <div className={styles.info}>
          <span className={styles.label}>{info.label}</span>
          {regionText && <span className={styles.regions}>{regionText}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {current}
      <Legend />
    </div>
  );
}
