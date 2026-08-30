import {
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ProfileData } from '@fjellrute/core/elevation/profile';
import { useWeather, weatherCandidates } from '@fjellrute/core/weather/useWeather';
// Grouping, precipitation and the wind-arrow angle are core's since Phase 3 of
// docs/mobile-web-parity-plan.md — see weather/format.ts for why fmtPrecip in
// particular is not a formatting detail — and so are the day-chip labels.
import {
  fmtPrecip,
  groupByDay,
  windArrowRotation,
} from '@fjellrute/core/weather/format';
import { dayDate, dayLabel, pad2, toYMD } from '@fjellrute/core/time/calendar';
import { ForecastContext } from '@fjellrute/core/forecast/snapshot';
import { WeatherSymbol, WindArrowIcon } from './WeatherIcons';
import { ChevronDownIcon } from './icons';
import { SourceAttribution, NLOD } from './SourceAttribution';
import { translate } from '@fjellrute/core/i18n/locale';
import { useT } from '@fjellrute/core/i18n';
import styles from './WeatherPanel.module.css';

interface Props {
  profile: ProfileData;
}

type LocationKey = 'lowest' | 'highest';
const LOC_KEYS: LocationKey[] = ['lowest', 'highest'];
function locLabel(k: LocationKey): string {
  return k === 'lowest'
    ? translate('Laveste punkt', 'Lowest point')
    : translate('Høyeste punkt', 'Highest point');
}

export function WeatherPanel({ profile }: Props) {
  const t = useT();
  const candidates = useMemo(() => weatherCandidates(profile), [profile]);
  // Frozen snapshot (saved/shared route) — render its data instead of fetching,
  // and open on the anchor/day the owner had selected.
  const forecastCtx = useContext(ForecastContext);
  const weatherSnap = forecastCtx?.snapshot?.weather ?? null;
  const [locKey, setLocKey] = useState<LocationKey>(
    weatherSnap?.selectedLoc ?? 'lowest',
  );
  const point = candidates ? candidates[locKey] : null;
  const frozen = weatherSnap
    ? locKey === 'lowest'
      ? weatherSnap.lowest
      : weatherSnap.highest
    : null;
  const { hours, loading, error, fetchedAt } = useWeather(point, frozen);

  // Publish the current selection so a save can capture exactly what's shown.
  useEffect(() => {
    forecastCtx?.publish({ weatherLoc: locKey });
  }, [forecastCtx, locKey]);

  const today = useMemo(() => toYMD(new Date()), []);
  const grouped = useMemo(() => (hours ? groupByDay(hours) : null), [hours]);
  const days = useMemo(() => {
    if (!grouped) return [];
    return [...grouped.keys()].sort();
  }, [grouped]);

  const [selectedDay, setSelectedDay] = useState<string | null>(
    weatherSnap?.selectedDay ?? null,
  );

  // Keep the captured "selected day" in sync for snapshotting.
  useEffect(() => {
    forecastCtx?.publish({ weatherDay: selectedDay });
  }, [forecastCtx, selectedDay]);
  useEffect(() => {
    if (!selectedDay && days.length > 0) {
      startTransition(() => {
        setSelectedDay(days.includes(today) ? today : days[0]);
      });
    } else if (selectedDay && days.length > 0 && !days.includes(selectedDay)) {
      // The previously selected day fell off the end of the forecast window.
      startTransition(() => {
        setSelectedDay(days[0]);
      });
    }
  }, [days, selectedDay, today]);

  const rows = useMemo(() => {
    if (!grouped || !selectedDay) return [];
    return grouped.get(selectedDay) ?? [];
  }, [grouped, selectedDay]);

  // Track whether the list has more rows below the scroll viewport so we
  // can show the overflow chevron only when it's actually meaningful.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const more = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
      setOverflow(more);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [rows]);

  if (!candidates) return null;

  const locSwitch = (
    <div className={styles.locGroup}>
      <div
        className={styles.locSwitch}
        role="radiogroup"
        aria-label={t('Værsted', 'Forecast location')}
      >
      {LOC_KEYS.map((k) => {
        const c = candidates[k];
        const active = k === locKey;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={active}
            className={`${styles.locOption} ${active ? styles.locOptionActive : ''}`}
            onClick={() => setLocKey(k)}
          >
            <span className={styles.locLabel}>{locLabel(k)}</span>
            <span className={styles.locElev}>{Math.round(c.elevation)} m</span>
          </button>
        );
      })}
      </div>
    </div>
  );

  const topRow = (children: React.ReactNode) => (
    <div className={styles.topRow}>
      {locSwitch}
      <div className={styles.topRowRight}>{children}</div>
    </div>
  );

  if (error && !hours) {
    return (
      <div className={styles.panel}>
        {topRow(<div className={styles.status}>{t('Vær utilgjengelig', 'Weather unavailable')}</div>)}
      </div>
    );
  }
  if ((loading && !hours) || !hours || days.length === 0) {
    return (
      <div className={styles.panel}>
        {topRow(<div className={styles.status}>{t('Laster værvarsel …', 'Loading forecast…')}</div>)}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {topRow(
        <div className={styles.dayBar} role="tablist" aria-label={t('Værdag', 'Forecast day')}>
        {days.map((ymd) => {
          const active = ymd === selectedDay;
          return (
            <button
              key={ymd}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.dayBtn} ${active ? styles.dayBtnActive : ''}`}
              onClick={() => setSelectedDay(ymd)}
            >
              <span className={styles.dayLabel}>{dayLabel(ymd, today)}</span>
              <span className={styles.dayDate}>{dayDate(ymd)}</span>
            </button>
          );
        })}
        </div>,
      )}
      <div className={styles.tableWrap}>
        <div className={styles.header}>
          <span>{t('Tid', 'Time')}</span>
          <span>{t('Himmel', 'Sky')}</span>
          <span>{t('Temp.', 'Temp.')}</span>
          <span>{t('Nedbør mm', 'Precip. mm')}</span>
          <span>{t('Vind m/s', 'Wind m/s')}</span>
        </div>
        <div className={styles.scroll} ref={scrollRef}>
          {rows.map((h) => {
            const dt = new Date(h.time);
            const hh = pad2(dt.getHours());
            const precip = fmtPrecip(h);
            const cold = h.temperature <= 0;
            const rot = windArrowRotation(h.windFromDeg);
            return (
              <div key={h.time} className={styles.row}>
                <span className={styles.time}>{hh}</span>
                <span className={styles.icon}>
                  <WeatherSymbol code={h.symbolCode} size={26} />
                </span>
                <span className={`${styles.temp} ${cold ? styles.tempCold : ''}`}>
                  {Math.round(h.temperature)}°
                </span>
                <span className={precip ? styles.precip : styles.precipEmpty}>
                  {precip ?? ''}
                </span>
                <span className={styles.wind}>
                  {Math.round(h.windSpeed)}
                  {h.windGust != null && (
                    <span className={styles.windGust}>
                      ({Math.round(h.windGust)})
                    </span>
                  )}
                  <span
                    className={styles.windArrow}
                    style={{ transform: `rotate(${rot}deg)` }}
                    aria-hidden
                  >
                    <WindArrowIcon />
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        <div
          className={`${styles.overflow} ${overflow ? styles.overflowVisible : ''}`}
          aria-hidden
        >
          <ChevronDownIcon />
        </div>
      </div>
      <div className={styles.attributionWrap}>
      <SourceAttribution
        what={t('Værvarsel', 'Weather forecast')}
        source={{ label: 'MET Norway', href: 'https://www.met.no/en' }}
        license={NLOD}
        note={
          fetchedAt != null && (
            <>
              {t('Varsel hentet ', 'Forecast retrieved ')}
              {new Date(fetchedAt).toLocaleString([], {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
              .{' '}
            </>
          )
        }
      />
      </div>
    </div>
  );
}
