import { useContext, useEffect, useMemo, useState } from 'react';
import type { ProfileData } from '../elevation/profile';
import type { AvalancheWarning } from '../avalanche/api';
import { todayLocalYMD, useAvalanche } from '../avalanche/useAvalanche';
import { ForecastContext } from '../forecast/snapshot';
import { DatePopover } from './DatePopover';
import { AvalancheProblems } from './AvalancheProblems';
import { translate } from '../i18n/locale.ts';
import { useT } from '../i18n/index.ts';
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

const DOW_SHORT_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_SHORT_NO = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_NO = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

// "Yesterday" / "Today" / "Tomorrow" for the immediate neighbours of the
// real calendar day, otherwise the short weekday name.
function dayLabel(ymd: string, todayYMD: string): string {
  if (ymd === todayYMD) return translate('I dag', 'Today');
  if (ymd === shiftYMD(todayYMD, 1)) return translate('I morgen', 'Tomorrow');
  if (ymd === shiftYMD(todayYMD, -1)) return translate('I går', 'Yesterday');
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return translate(DOW_SHORT_NO[dow], DOW_SHORT_EN[dow]);
}
function dayDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return translate(`${d}. ${MONTHS_NO[m - 1]}`, `${MONTHS_EN[m - 1]} ${d}`);
}

// EAWS / Varsom danger levels, translated from the Norwegian "snøskredfare"
// scale shown on senorge.no. Colours mirror the senorge legend.
interface LevelInfo {
  color: string; // badge background
  onColor: string; // text on the badge
}
const LEVELS: Record<number, LevelInfo> = {
  1: { color: '#6dbe45', onColor: '#0a2a06' },
  2: { color: '#f4d63f', onColor: '#3a3000' },
  3: { color: '#f0922f', onColor: '#3a1e00' },
  4: { color: '#e23c34', onColor: '#ffffff' },
  5: { color: '#3a464e', onColor: '#ffffff' },
};

// Localized danger-level label. Level 0 (or unknown) is the "not assessed"
// state used by the legend and the no-forecast row.
function levelLabel(level: number): string {
  switch (level) {
    case 1:
      return translate('Liten skredfare', 'Low avalanche danger');
    case 2:
      return translate('Moderat skredfare', 'Moderate avalanche danger');
    case 3:
      return translate('Betydelig skredfare', 'Considerable avalanche danger');
    case 4:
      return translate('Stor skredfare', 'High avalanche danger');
    case 5:
      return translate('Meget stor skredfare', 'Very high avalanche danger');
    default:
      return translate('Ikke vurdert', 'Not assessed');
  }
}

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
              {levelLabel(level)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function AvalancheRisk({ profile }: Props) {
  const t = useT();
  const today = useMemo(() => todayLocalYMD(), []);
  // Frozen snapshot (saved/shared route): open on the owner's chosen date and
  // render the captured data for it. Switching to another day falls through to
  // a live fetch (only the chosen date was frozen).
  const forecastCtx = useContext(ForecastContext);
  const avalancheSnap = forecastCtx?.snapshot?.avalanche ?? null;
  const initialDate = avalancheSnap?.date ?? today;
  // `anchor` is the day chosen in the date tool and centres the quick-select
  // window; `selected` is the day actually shown (one of the window chips).
  const [anchor, setAnchor] = useState(initialDate);
  const [selected, setSelected] = useState(initialDate);
  const frozen =
    avalancheSnap && avalancheSnap.date === selected
      ? {
          level: avalancheSnap.level,
          regions: avalancheSnap.regions,
          fetchedAt: avalancheSnap.fetchedAt,
        }
      : null;
  const { level, regions, loading, error, fetchedAt } = useAvalanche(
    profile,
    selected,
    frozen,
  );

  // Publish the shown date so a save captures the owner's avalanche selection.
  useEffect(() => {
    forecastCtx?.publish({ avalancheDate: selected });
  }, [forecastCtx, selected]);

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
        <span className={styles.dateLabel}>{t('Varseldag', 'Forecast day')}</span>
        <DatePopover value={anchor} onChange={pickAnchor} />
      </div>
      <div className={styles.dayBar} role="tablist" aria-label={t('Varseldag', 'Forecast day')}>
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
    current = <div className={styles.status}>{t('Skredfare utilgjengelig', 'Avalanche risk unavailable')}</div>;
  } else if (loading && level === 0) {
    current = <div className={styles.status}>{t('Laster skredfare …', 'Loading avalanche risk…')}</div>;
  } else if (level === 0) {
    // No assessed region along the route — typically outside the winter
    // forecasting season. Mirrors senorge's "Ikke vurdert" state.
    current = (
      <div className={styles.row}>
        <div className={`${styles.badge} ${styles.badgeUnrated}`} aria-hidden>
          ?
        </div>
        <div className={styles.info}>
          <span className={styles.label}>{t('Ikke vurdert', 'Not assessed')}</span>
          <span className={styles.regions}>
            {t('Ingen skredvarsel for dette området', 'No avalanche warning for this area')}
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
            {t('Varsel hentet ', 'Forecast retrieved ')}
            {new Date(fetchedAt).toLocaleString([], {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {t(
              '. Sjekk alltid det nyeste varselet før du drar ut. ',
              '. Always check the latest bulletin before heading out. ',
            )}
          </>
        )}
        {t('Skredvarsel ©', 'Avalanche forecast ©')}{' '}
        <a
          href="https://www.varsom.no/"
          target="_blank"
          rel="noopener noreferrer"
        >
          NVE / Varsom.no
        </a>
        {t(', lisensiert under ', ', licensed under ')}
        <a
          href="https://data.norge.no/nlod/en/2.0"
          target="_blank"
          rel="noopener noreferrer"
        >
          NLOD
        </a>
        {t('. Data leveres «som de er».', '. Data provided “as is”.')}
      </p>
    </div>
  );
}

// A single region's avalanche report: its danger level, region name, the
// forecaster's headline advisory (MainText), and the avalanche problems
// Varsom identified for it, with a link to the full bulletin on varsom.no.
function RegionReport({ region }: { region: AvalancheWarning }) {
  const t = useT();
  const info = LEVELS[region.dangerLevel];
  const varsomUrl = `https://www.varsom.no/snoskredvarsling/varsel/${encodeURIComponent(region.regionName)}/`;
  return (
    <div className={styles.report}>
      <div className={styles.row}>
        <div
          className={styles.badge}
          style={{ background: info.color, color: info.onColor }}
          aria-label={t(
            `Skredfaregrad ${region.dangerLevel} av 5`,
            `Avalanche danger level ${region.dangerLevel} of 5`,
          )}
        >
          {region.dangerLevel}
        </div>
        <div className={styles.info}>
          <span className={styles.label}>{levelLabel(region.dangerLevel)}</span>
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
        {t(
          `Fullstendig varsel for ${region.regionName} på varsom.no →`,
          `Full bulletin for ${region.regionName} on varsom.no →`,
        )}
      </a>
    </div>
  );
}
