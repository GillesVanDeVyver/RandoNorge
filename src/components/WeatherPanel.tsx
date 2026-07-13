import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProfileData } from '../elevation/profile';
import type { WeatherHour } from '../weather/api';
import { useWeather, weatherCandidates } from '../weather/useWeather';
import { WeatherSymbol, WindArrowIcon } from './WeatherIcons';
import { ChevronDownIcon } from './icons';
import { SourceAttribution, NLOD } from './SourceAttribution';
import styles from './WeatherPanel.module.css';

interface Props {
  profile: ProfileData;
}

type LocationKey = 'lowest' | 'highest';
const LOC_KEYS: LocationKey[] = ['lowest', 'highest'];
const LOC_LABELS: Record<LocationKey, string> = {
  lowest: 'Lowest point',
  highest: 'Highest point',
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const toYMDLocal = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Date label for the day-selector chips. "Today" / "Tomorrow" for the first
// two days, then short weekday name for the rest.
function dayLabel(d: Date, todayYMD: string): string {
  const ymd = toYMDLocal(d);
  if (ymd === todayYMD) return 'Today';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (ymd === toYMDLocal(tomorrow)) return 'Tomorrow';
  return DOW_SHORT[d.getDay()];
}

// Short date suffix, e.g. "Jun 21".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// Group the forecast timeseries by the local calendar day so each chip
// selects a flat list of hours to display. Days with no hours are omitted.
function groupByDay(hours: WeatherHour[]): Map<string, WeatherHour[]> {
  const map = new Map<string, WeatherHour[]>();
  for (const h of hours) {
    const d = new Date(h.time);
    const ymd = toYMDLocal(d);
    const arr = map.get(ymd);
    if (arr) arr.push(h);
    else map.set(ymd, [h]);
  }
  return map;
}

function fmtPrecip(h: WeatherHour): string | null {
  const lo = h.precipMinMm;
  const hi = h.precipMaxMm;
  const mid = h.precipMm;
  // Only show precipitation when something is actually forecast. The min/max
  // band collapses to a single number when the forecast is confident.
  if ((lo == null || lo === 0) && (hi == null || hi === 0) && (mid == null || mid === 0)) {
    return null;
  }
  if (typeof lo === 'number' && typeof hi === 'number' && hi !== lo) {
    return `${lo.toFixed(lo < 1 ? 1 : 0)}–${hi.toFixed(hi < 10 ? 1 : 0)}`;
  }
  if (typeof mid === 'number') return mid.toFixed(mid < 10 ? 1 : 0);
  return null;
}

export function WeatherPanel({ profile }: Props) {
  const candidates = useMemo(() => weatherCandidates(profile), [profile]);
  const [locKey, setLocKey] = useState<LocationKey>('lowest');
  const point = candidates ? candidates[locKey] : null;
  const { hours, loading, error } = useWeather(point);

  const today = useMemo(() => toYMDLocal(new Date()), []);
  const grouped = useMemo(() => (hours ? groupByDay(hours) : null), [hours]);
  const days = useMemo(() => {
    if (!grouped) return [];
    return [...grouped.keys()].sort();
  }, [grouped]);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedDay && days.length > 0) {
      setSelectedDay(days.includes(today) ? today : days[0]);
    } else if (selectedDay && days.length > 0 && !days.includes(selectedDay)) {
      // The previously selected day fell off the end of the forecast window.
      setSelectedDay(days[0]);
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
      <span className={styles.locPrefix}>Showing weather forecast for:</span>
      <div
        className={styles.locSwitch}
        role="radiogroup"
        aria-label="Forecast location"
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
            <span className={styles.locLabel}>{LOC_LABELS[k]}</span>
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
        {topRow(<div className={styles.status}>Weather unavailable</div>)}
      </div>
    );
  }
  if ((loading && !hours) || !hours || days.length === 0) {
    return (
      <div className={styles.panel}>
        {topRow(<div className={styles.status}>Loading forecast…</div>)}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {topRow(
        <div className={styles.dayBar} role="tablist" aria-label="Forecast day">
        {days.map((ymd) => {
          // ymd is a local-date string; parse it back as a local Date so the
          // day-of-week label doesn't drift across timezones.
          const [y, m, d] = ymd.split('-').map(Number);
          const date = new Date(y, m - 1, d);
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
              <span className={styles.dayLabel}>{dayLabel(date, today)}</span>
              <span className={styles.dayDate}>{dayDate(date)}</span>
            </button>
          );
        })}
        </div>,
      )}
      <div className={styles.tableWrap}>
        <div className={styles.header}>
          <span>Time</span>
          <span>Sky</span>
          <span>Temp.</span>
          <span>Precip. mm</span>
          <span>Wind m/s</span>
        </div>
        <div className={styles.scroll} ref={scrollRef}>
          {rows.map((h) => {
            const t = new Date(h.time);
            const hh = pad2(t.getHours());
            const precip = fmtPrecip(h);
            const cold = h.temperature <= 0;
            // wind_from_direction is the bearing the wind is coming FROM.
            // Our arrow points right (east = 90°) by default, so to render
            // "where the wind is blowing TO" we rotate by (from + 180) − 90.
            const rot = h.windFromDeg + 180 - 90;
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
      <SourceAttribution
        what="Weather forecast"
        source={{ label: 'MET Norway', href: 'https://www.met.no/en' }}
        license={NLOD}
      />
    </div>
  );
}
