// Screen-side wrapper around the printable tour briefing.
//
// The sheet itself is print-only in spirit, but showing it on screen first
// matters: the guide gets to check the tour date, pick which end of the route
// the weather column describes, and see the map actually render before
// committing paper. Print is held until the map canvas reports ready, because
// a briefing whose map frame prints half-drawn is worse than no briefing.
//
// PDF generation is the browser's: window.print() → "Save as PDF". No client
// -side PDF library, so nothing here can drift out of sync with what the user
// sees, and the app carries no extra dependency.

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProfileData } from '../elevation/profile';
import type { Route } from '../types';
import { ForecastContext } from '../forecast/snapshot';
import { todayLocalYMD, useAvalanche } from '../avalanche/useAvalanche';
import { useWeather, weatherCandidates } from '../weather/useWeather';
import type { WeatherHour } from '../weather/api';
import { DatePopover } from '../components/DatePopover';
import { BriefingSheet, type BriefingData } from './BriefingSheet';
import { useT } from '../i18n/index.ts';
import { translate } from '../i18n/locale.ts';
// A plain stylesheet, not a CSS module: the print rules have to reach the
// document root and hide the rest of the app, which needs stable, unhashed
// selectors. See briefing.css.
import './briefing.css';

interface Props {
  route: Route;
  profile: ProfileData;
  /** Saved routes carry a name and description; an unsaved working route
   *  falls back to a generic title so the sheet never prints "undefined". */
  routeName?: string | null;
  routeDescription?: string | null;
  onClose: () => void;
}

type AnchorKey = 'lowest' | 'highest';

const pad2 = (n: number) => String(n).padStart(2, '0');
const toYMDLocal = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Hours of the forecast that fall on the tour date, in local time — the same
 *  local-day grouping the weather panel uses, so the printed table and the
 *  on-screen chart agree about which hours belong to the day. */
function hoursOnDate(hours: WeatherHour[] | null, ymd: string): WeatherHour[] {
  if (!hours) return [];
  return hours.filter((h) => toYMDLocal(new Date(h.time)) === ymd);
}

export function BriefingDialog({
  route,
  profile,
  routeName,
  routeDescription,
  onClose,
}: Props) {
  const t = useT();

  // Frozen snapshot of a saved/shared route: open on the date its owner chose
  // and print their captured numbers, so a briefing handed out today matches
  // the route page everyone else is looking at.
  const forecastCtx = useContext(ForecastContext);
  const snapshot = forecastCtx?.snapshot ?? null;
  const avalancheSnap = snapshot?.avalanche ?? null;
  const weatherSnap = snapshot?.weather ?? null;

  const [date, setDate] = useState(() => avalancheSnap?.date ?? todayLocalYMD());
  // Which end of the route the weather column describes. The summit is the
  // default: it is where the decision gets made and where the wind actually
  // is, whereas the valley reading mostly tells you about the drive in.
  const [anchor, setAnchor] = useState<AnchorKey>(
    weatherSnap?.selectedLoc ?? 'highest',
  );
  const [mapReady, setMapReady] = useState(false);

  const candidates = useMemo(() => weatherCandidates(profile), [profile]);
  const point = candidates ? candidates[anchor] : null;

  // Frozen data only applies while the viewer stays on the captured date /
  // anchor; anything else falls through to a live fetch, exactly as the
  // on-screen panels behave.
  const frozenAvalanche =
    avalancheSnap && avalancheSnap.date === date
      ? {
          level: avalancheSnap.level,
          regions: avalancheSnap.regions,
          fetchedAt: avalancheSnap.fetchedAt,
        }
      : null;
  const frozenWeather = weatherSnap ? weatherSnap[anchor] : null;

  const avalanche = useAvalanche(profile, date, frozenAvalanche);
  const weather = useWeather(point, frozenWeather);

  const onMapReady = useCallback(() => setMapReady(true), []);

  // Escape closes, matching every other overlay in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The overlay is portaled to <body> so the print stylesheet can hide every
  // other top-level node with one rule, instead of fighting the planner's
  // scroll-locked flex layout for control of the printed page.
  const hours = hoursOnDate(weather.hours, date);
  const forecastReady = !avalanche.loading && !weather.loading;
  const canPrint = mapReady && forecastReady;

  const data: BriefingData = {
    routeName: routeName?.trim() || t('Turbriefing', 'Tour briefing'),
    routeDescription: routeDescription?.trim() || null,
    date,
    route,
    profile,
    avalancheLevel: avalanche.level,
    avalancheRegions: avalanche.regions,
    avalancheLoading: avalanche.loading,
    weatherHours: hours,
    weatherLabel:
      anchor === 'highest'
        ? translate('Høyeste punkt', 'Highest point')
        : translate('Laveste punkt', 'Lowest point'),
    weatherLoading: weather.loading,
    weatherElevationM: point ? Math.round(point.elevation) : null,
    onMapReady,
  };

  return createPortal(
    <div
      className="briefingOverlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('Turbriefing for utskrift', 'Printable tour briefing')}
    >
      <div className="briefingBar">
        <div className="briefingBarGroup">
          <span className="briefingBarLabel">{t('Turdato', 'Tour date')}</span>
          <DatePopover value={date} onChange={setDate} />
        </div>
        <div
          className="briefingBarGroup"
          role="group"
          aria-label={t('Værpunkt', 'Weather point')}
        >
          <span className="briefingBarLabel">{t('Vær ved', 'Weather at')}</span>
          {(['lowest', 'highest'] as AnchorKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`briefingChip ${anchor === key ? 'briefingChipActive' : ''}`}
              aria-pressed={anchor === key}
              onClick={() => setAnchor(key)}
            >
              {key === 'highest'
                ? t('Høyeste punkt', 'Highest point')
                : t('Laveste punkt', 'Lowest point')}
            </button>
          ))}
        </div>
        <div className="briefingBarSpacer" />
        <button type="button" className="briefingBtn" onClick={onClose}>
          {t('Lukk', 'Close')}
        </button>
        <button
          type="button"
          className="briefingBtn briefingBtnPrimary"
          onClick={() => window.print()}
          disabled={!canPrint}
          title={
            canPrint
              ? t(
                  'Skriv ut, eller velg «Lagre som PDF» i utskriftsdialogen',
                  'Print, or choose “Save as PDF” in the print dialog',
                )
              : t('Forbereder briefingen …', 'Preparing the briefing…')
          }
        >
          {canPrint
            ? t('Skriv ut / PDF', 'Print / PDF')
            : t('Forbereder …', 'Preparing…')}
        </button>
      </div>
      <BriefingSheet data={data} />
    </div>,
    document.body,
  );
}
