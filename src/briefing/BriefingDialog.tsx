// Screen-side wrapper around the printable tour briefing.
//
// The sheet itself is print-only in spirit, but showing it on screen first
// matters: the guide sets the tour date, decides what belongs on the page, and
// watches the map actually render before committing paper. Print is held until
// the map canvas reports ready, because a briefing whose map frame prints
// half-drawn is worse than no briefing.
//
// Composition is by switches, not by pickers. A briefing is handed to someone
// for a purpose, and the purposes differ — a skredkurs wall wants terrain and
// the day's warning, a client handout is mostly route and weather. Asking
// "which end of the route should the weather describe?" put a planning
// question where an include/exclude question belonged; both ends are printed
// side by side now, and the only question left is whether to print them.
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
import { useSnow } from '../snow/useSnow';
import type { WeatherHour } from '../weather/api';
import { DatePopover } from '../components/DatePopover';
import { BriefingSheet, type BriefingData } from './BriefingSheet';
import {
  loadOptions,
  storeOptions,
  withDependencies,
  type BriefingOptions,
} from './options';
import { useT } from '../i18n/index.ts';
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
  const snowSnap = snapshot?.snow ?? null;

  const [date, setDate] = useState(() => avalancheSnap?.date ?? todayLocalYMD());
  const [options, setOptions] = useState<BriefingOptions>(loadOptions);
  const [mapReady, setMapReady] = useState(false);

  // A guide printing a stack of briefings sets the switches once.
  useEffect(() => {
    storeOptions(options);
  }, [options]);

  const setOption = useCallback((key: keyof BriefingOptions, on: boolean) => {
    // withDependencies keeps avalanche terrain from being stranded without the
    // slope angles it has to be read against.
    setOptions((prev) => withDependencies({ ...prev, [key]: on }));
  }, []);

  const candidates = useMemo(() => weatherCandidates(profile), [profile]);
  const low = candidates?.lowest ?? null;
  const high = candidates?.highest ?? null;

  // Frozen data only applies while the viewer stays on the captured date;
  // anything else falls through to a live fetch, exactly as the on-screen
  // panels behave.
  const frozenAvalanche =
    avalancheSnap && avalancheSnap.date === date
      ? {
          level: avalancheSnap.level,
          regions: avalancheSnap.regions,
          fetchedAt: avalancheSnap.fetchedAt,
        }
      : null;

  // seNorge models snow that has already fallen; it has no forecast. Asking it
  // about a tour three days out returns nothing, so the sheet asks for the tour
  // date when that date is in the past and for the most recent modelled day
  // otherwise — and says on the page which it got.
  const today = todayLocalYMD();
  const snowIsFallback = date > today;
  const snowDate = snowIsFallback ? today : date;
  const frozenSnow =
    snowSnap && snowSnap.date === snowDate ? snowSnap : undefined;

  const avalanche = useAvalanche(profile, date, frozenAvalanche);
  const weatherLow = useWeather(low, weatherSnap?.lowest ?? null);
  const weatherHigh = useWeather(high, weatherSnap?.highest ?? null);
  const snow = useSnow(options.snow ? profile : null, snowDate, frozenSnow);

  const onMapReady = useCallback(() => setMapReady(true), []);

  // Escape closes, matching every other overlay in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Only wait on the sources that are actually going to be printed: a guide
  // who switched weather off should not be held at "Preparing…" by MET.
  const weatherLoading = weatherLow.loading || weatherHigh.loading;
  const canPrint =
    mapReady &&
    !(options.avalanche && avalanche.loading) &&
    !(options.weather && weatherLoading) &&
    !(options.snow && snow.loading);

  const data: BriefingData = {
    routeName: routeName?.trim() || t('Turbriefing', 'Tour briefing'),
    routeDescription: routeDescription?.trim() || null,
    date,
    route,
    profile,
    options,
    avalancheLevel: avalanche.level,
    avalancheRegions: avalanche.regions,
    avalancheLoading: avalanche.loading,
    weatherLow: {
      elevationM: low ? Math.round(low.elevation) : null,
      hours: hoursOnDate(weatherLow.hours, date),
    },
    weatherHigh: {
      elevationM: high ? Math.round(high.elevation) : null,
      hours: hoursOnDate(weatherHigh.hours, date),
    },
    weatherLoading,
    snow: snow.snow,
    snowLoading: snow.loading,
    snowDate,
    snowIsFallback,
    onMapReady,
  };

  // The overlay is portaled to <body> so the print stylesheet can hide every
  // other top-level node with one rule, instead of fighting the planner's
  // scroll-locked flex layout for control of the printed page.
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

        <div
          className="briefingSwitches"
          role="group"
          aria-label={t('Innhold på arket', 'What the sheet includes')}
        >
          <span className="briefingBarLabel">{t('Ta med', 'Include')}</span>
          {/* Stated, not offered: the map is what makes the sheet legible as
              "this tour" rather than "a tour". A disabled switch here would
              invite clicking something inert. */}
          <span className="briefingAlways">
            <span className="briefingAlwaysMark" aria-hidden>
              ✓
            </span>
            {t('Kart (alltid med)', 'Map (always included)')}
          </span>
          <Switch
            label={t('Bratthet', 'Steepness')}
            checked={options.steepness}
            onChange={(on) => setOption('steepness', on)}
          />
          <Switch
            label={t('Skredterreng', 'Avalanche terrain')}
            checked={options.avalanche}
            disabled={!options.steepness}
            onChange={(on) => setOption('avalanche', on)}
          />
          <Switch
            label={t('Snødybde', 'Snow depth')}
            checked={options.snow}
            onChange={(on) => setOption('snow', on)}
          />
          <Switch
            label={t('Vær', 'Weather')}
            checked={options.weather}
            onChange={(on) => setOption('weather', on)}
          />
          <Switch
            label={t('Notatfelt', 'Notes')}
            checked={options.notes}
            onChange={(on) => setOption('notes', on)}
          />
          {!options.steepness && (
            <p className="briefingSwitchHint">
              {t(
                'Skredterreng krever bratthet — utløpssoner og faregrad betyr lite uten hellingene de gjelder for.',
                'Avalanche terrain needs steepness — runout zones and a danger level mean little without the slope angles they apply to.',
              )}
            </p>
          )}
        </div>
      </div>
      <BriefingSheet data={data} />
    </div>,
    document.body,
  );
}

/** A labelled on/off switch. A real checkbox underneath, so keyboard use,
 *  screen readers and the disabled state all behave without reimplementation. */
function Switch({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label
      className={`briefingSwitch ${disabled ? 'briefingSwitchDisabled' : ''}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="briefingSwitchTrack" aria-hidden />
      {label}
    </label>
  );
}
