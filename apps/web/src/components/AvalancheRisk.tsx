import { useContext, useEffect, useMemo, useState } from 'react';
import type { ProfileData } from '@fjellrute/core/elevation/profile';
import type { AvalancheWarning } from '@fjellrute/core/avalanche/api';
import { todayLocalYMD, useAvalanche } from '@fjellrute/core/avalanche/useAvalanche';
import { DANGER_LEVELS, dangerLevelLabel } from '@fjellrute/core/avalanche/dangerScale';
import { ForecastContext } from '@fjellrute/core/forecast/snapshot';
// The chip labels and the day arithmetic are core's since Phase 3 of
// docs/mobile-web-parity-plan.md, because the phone's avalanche card wears the
// same chips and a second implementation of "Today / Tomorrow / Yesterday"
// would eventually disagree with this one where nobody could see both.
import { dayDate, dayLabel, shiftYMD } from '@fjellrute/core/time/calendar';
import { DatePopover } from './DatePopover';
import { AvalancheProblems } from './AvalancheProblems';
import { useT } from '@fjellrute/core/i18n';
import styles from './AvalancheRisk.module.css';

interface Props {
  profile: ProfileData;
}

// Quick-select window around the day chosen in the date tool: two days
// before through two days after. Varsom forecasts only reach two days ahead
// (a nowcast plus the next two days), so a third day would never be assessed.
const WINDOW_OFFSETS = [-2, -1, 0, 1, 2];

// The EAWS / Varsom danger colours and level names live in
// avalanche/dangerScale.ts, shared with the printable tour briefing.
const LEVELS = DANGER_LEVELS;
const levelLabel = dangerLevelLabel;

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
