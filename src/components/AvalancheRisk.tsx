import { useMemo, useState } from 'react';
import type { ProfileData } from '../elevation/profile';
import type { AvalancheWarning } from '../avalanche/api';
import { todayLocalYMD, useAvalanche } from '../avalanche/useAvalanche';
import { DatePopover } from './DatePopover';
import { AvalancheProblems } from './AvalancheProblems';
import styles from './AvalancheRisk.module.css';

interface Props {
  profile: ProfileData;
}

// Quick-select window around the day chosen in the date tool: two days
// before through two days after. Varsom forecasts only reach two days ahead
// (a nowcast plus the next two days), so a third day would never be assessed.
const WINDOW_OFFSETS = [-2, -1, 0, 1, 2];

const pad2 = (n: number) => String(n).padStart(2, '0');
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function shiftYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return toYMD(date);
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Yesterday" / "Today" / "Tomorrow" for the immediate neighbours of the
// real calendar day, otherwise the short weekday name.
function dayLabel(ymd: string, todayYMD: string): string {
  if (ymd === todayYMD) return 'Today';
  if (ymd === shiftYMD(todayYMD, 1)) return 'Tomorrow';
  if (ymd === shiftYMD(todayYMD, -1)) return 'Yesterday';
  const [y, m, d] = ymd.split('-').map(Number);
  return DOW_SHORT[new Date(y, m - 1, d).getDay()];
}
function dayDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
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
              {info ? info.label : 'Not assessed'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function AvalancheRisk({ profile }: Props) {
  const today = useMemo(() => todayLocalYMD(), []);
  // `anchor` is the day chosen in the date tool and centres the quick-select
  // window; `selected` is the day actually shown (one of the window chips).
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const { level, regions, loading, error, fetchedAt } = useAvalanche(
    profile,
    selected,
  );

  const windowDays = useMemo(
    () => WINDOW_OFFSETS.map((off) => shiftYMD(anchor, off)),
    [anchor],
  );

  const pickAnchor = (v: string) => {
    setAnchor(v);
    setSelected(v);
  };

  const dateControls = (
    <div className={styles.controls}>
      <div className={styles.dateField}>
        <span className={styles.dateLabel}>Forecast day</span>
        <DatePopover value={anchor} onChange={pickAnchor} />
      </div>
      <div className={styles.dayBar} role="tablist" aria-label="Forecast day">
        {windowDays.map((ymd) => {
          const active = ymd === selected;
          return (
            <button
              key={ymd}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.dayBtn} ${active ? styles.dayBtnActive : ''}`}
              onClick={() => setSelected(ymd)}
            >
              <span className={styles.dayLabel}>{dayLabel(ymd, today)}</span>
              <span className={styles.dayDate}>{dayDate(ymd)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

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
          ?
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
    // One report per assessed region the route crosses, highest danger first.
    // A single region renders as one report; several stack under each other.
    current = (
      <div className={styles.reports}>
        {regions.map((r) => (
          <RegionReport key={r.regionId} region={r} />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {dateControls}
      {current}
      <Legend />
      <p className={styles.attribution}>
        {fetchedAt != null && Number.isFinite(fetchedAt) && (
          <>
            Forecast retrieved{' '}
            {new Date(fetchedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
            . Always check the latest bulletin before heading out.{' '}
          </>
        )}
        Avalanche forecast ©{' '}
        <a
          href="https://www.varsom.no/"
          target="_blank"
          rel="noopener noreferrer"
        >
          NVE / Varsom.no
        </a>
        , licensed under{' '}
        <a
          href="https://data.norge.no/nlod/en/2.0"
          target="_blank"
          rel="noopener noreferrer"
        >
          NLOD
        </a>
        . Data provided “as is”.
      </p>
    </div>
  );
}

// A single region's avalanche report: its danger level, region name, the
// forecaster's headline advisory (MainText), and the avalanche problems
// Varsom identified for it, with a link to the full bulletin on varsom.no.
function RegionReport({ region }: { region: AvalancheWarning }) {
  const info = LEVELS[region.dangerLevel];
  const varsomUrl = `https://www.varsom.no/snoskredvarsling/varsel/${encodeURIComponent(region.regionName)}/`;
  return (
    <div className={styles.report}>
      <div className={styles.row}>
        <div
          className={styles.badge}
          style={{ background: info.color, color: info.onColor }}
          aria-label={`Avalanche danger level ${region.dangerLevel} of 5`}
        >
          {region.dangerLevel}
        </div>
        <div className={styles.info}>
          <span className={styles.label}>{info.label}</span>
          <span className={styles.regions}>{region.regionName}</span>
        </div>
      </div>
      {region.mainText && (
        <p className={styles.mainText}>{region.mainText}</p>
      )}
      {region.problems.length > 0 && (
        <AvalancheProblems problems={region.problems} />
      )}
      <a
        className={styles.regionLink}
        href={varsomUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        Full bulletin for {region.regionName} on varsom.no →
      </a>
    </div>
  );
}
