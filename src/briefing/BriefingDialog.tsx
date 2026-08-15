// Screen-side wrapper around the printable tour briefing.
//
// The dialog asks one question — what goes on the sheet — and answers it with
// a switch per section, listed one under another so the list reads as the
// order the sections print in. Everything else it used to ask has been taken
// away: the tour date is the day the planner is already showing, and the
// weather is printed for both ends of the route rather than one chosen end,
// because "which end?" is a planning question and this box is about
// composition.
//
// Print is held until the map canvas reports ready. A briefing whose map frame
// prints half-drawn is worse than no briefing — but only when the map is
// switched on; nothing else here waits on the network for a picture it is not
// going to print.
//
// PDF generation is the browser's: window.print() → "Save as PDF". No client
// -side PDF library, so nothing here can drift out of sync with what the user
// sees, and the app carries no extra dependency.

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { ProfileData } from '../elevation/profile';
import type { Route } from '../types';
import { ForecastContext } from '../forecast/snapshot';
import { todayLocalYMD, useAvalanche } from '../avalanche/useAvalanche';
import { useWeather, weatherCandidates } from '../weather/useWeather';
import { useSnow } from '../snow/useSnow';
import type { WeatherHour } from '../weather/api';
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
  /** Tour date (YYYY-MM-DD) the forecasts describe — the day the planner is
   *  showing, captured when the dialog opened. */
  date: string;
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
  date,
  routeName,
  routeDescription,
  onClose,
}: Props) {
  const t = useT();

  // Frozen snapshot of a saved/shared route: print the numbers its owner
  // captured, so a briefing handed out today matches the route page everyone
  // else is looking at.
  const forecastCtx = useContext(ForecastContext);
  const snapshot = forecastCtx?.snapshot ?? null;
  const avalancheSnap = snapshot?.avalanche ?? null;
  const weatherSnap = snapshot?.weather ?? null;
  const snowSnap = snapshot?.snow ?? null;

  const [options, setOptions] = useState<BriefingOptions>(loadOptions);
  const [mapReady, setMapReady] = useState(false);

  // The switches live behind the gear. Exporting the whole sheet is what almost
  // everyone wants, so the bar asks nothing and the choice is there for the
  // times it matters.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  /** Close the popover, returning focus to the gear only when the keyboard
   *  sent us back — a click elsewhere means the pointer has already moved on
   *  and stealing focus would fight it. */
  const closeSettings = useCallback((restoreFocus: boolean) => {
    setSettingsOpen(false);
    if (restoreFocus) gearRef.current?.focus();
  }, []);

  // A guide printing a stack of briefings sets the switches once.
  useEffect(() => {
    storeOptions(options);
  }, [options]);

  const setOption = useCallback((key: keyof BriefingOptions, on: boolean) => {
    // Switching the map back on remounts the canvas and re-fetches its tiles,
    // so readiness has to be earned again rather than inherited from the last
    // time it was drawn.
    if (key === 'map' && on) setMapReady(false);
    // withDependencies keeps steepness from being stranded without the profile
    // it colours.
    setOptions((prev) => withDependencies({ ...prev, [key]: on }));
  }, []);

  const candidates = useMemo(() => weatherCandidates(profile), [profile]);
  const low = candidates?.lowest ?? null;
  const high = candidates?.highest ?? null;

  // Frozen data only applies while the sheet stays on the captured date;
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

  // Escape closes, matching every other overlay in the app — but it peels one
  // layer at a time. Dismissing a popover should not also throw away the export
  // behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (settingsOpen) closeSettings(true);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, settingsOpen, closeSettings]);

  // A click anywhere outside the popover dismisses it, including on the sheet
  // behind — the preview is the thing being configured, so clicking it to look
  // closer should not be blocked by a panel in the way.
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: PointerEvent) => {
      const el = settingsRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        closeSettings(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [settingsOpen, closeSettings]);

  // Opening with the keyboard should land in the panel, not leave focus on a
  // button in front of a list the reader cannot reach.
  useEffect(() => {
    if (!settingsOpen) return;
    settingsRef.current
      ?.querySelector<HTMLInputElement>('input:not(:disabled)')
      ?.focus();
  }, [settingsOpen]);

  // Only wait on the sources that are actually going to be printed: a guide
  // who switched weather off should not be held at "Preparing…" by MET.
  const weatherLoading = weatherLow.loading || weatherHigh.loading;
  const canPrint =
    (!options.map || mapReady) &&
    !(options.avalanche && avalanche.loading) &&
    !(options.weather && weatherLoading) &&
    !(options.snow && snow.loading);

  const title = routeName?.trim() || t('Turbriefing', 'Tour briefing');

  const data: BriefingData = {
    routeName: title,
    routeDescription: routeDescription?.trim() || null,
    date,
    route,
    profile,
    options,
    avalancheLevel: avalanche.level,
    avalancheRegions: avalanche.regions,
    avalancheLoading: avalanche.loading,
    avalancheFetchedAt: avalanche.fetchedAt,
    weatherLow: {
      elevationM: low ? Math.round(low.elevation) : null,
      hours: hoursOnDate(weatherLow.hours, date),
      fetchedAt: weatherLow.fetchedAt,
    },
    weatherHigh: {
      elevationM: high ? Math.round(high.elevation) : null,
      hours: hoursOnDate(weatherHigh.hours, date),
      fetchedAt: weatherHigh.fetchedAt,
    },
    weatherLoading,
    snow: snow.snow,
    snowLoading: snow.loading,
    snowDate,
    snowIsFallback,
    onMapReady,
  };

  // The list the gear reveals, in the order the sections print. Built here
  // rather than inline so the popover markup stays readable at a glance.
  const switches = (
    <div
      className="briefingSwitches"
      role="group"
      aria-label={t('Innhold på arket', 'What the sheet includes')}
    >
      <span className="briefingBarLabel">{t('Ta med', 'Include')}</span>
      <Switch
        label={t('Kart', 'Map')}
        checked={options.map}
        onChange={(on) => setOption('map', on)}
      />
      <Switch
        label={t('Høydeprofil', 'Elevation')}
        checked={options.elevation}
        onChange={(on) => setOption('elevation', on)}
      />
      <Switch
        label={t('Bratthet', 'Steepness')}
        checked={options.steepness}
        disabled={!options.elevation}
        hint={
          options.elevation
            ? null
            : t(
                'Krever høydeprofilen den fargelegger',
                'Needs the elevation profile it colours',
              )
        }
        onChange={(on) => setOption('steepness', on)}
      />
      <Switch
        label={t('Snøskredvarsel', 'Avalanche forecast')}
        checked={options.avalanche}
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
    </div>
  );

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
        <div className="briefingBarHead">
          <h2 className="briefingBarTitle">
            {t('Eksporter tur', 'Export tour')}{' '}
            <span className="briefingBarRoute">{title}</span>
          </h2>
          <div className="briefingBarActions">
            <div className="briefingSettings" ref={settingsRef}>
              <button
                ref={gearRef}
                type="button"
                className="briefingBtn briefingBtnIcon"
                aria-haspopup="dialog"
                aria-expanded={settingsOpen}
                aria-label={t(
                  'Velg hva arket skal inneholde',
                  'Choose what the sheet includes',
                )}
                title={t(
                  'Velg hva arket skal inneholde',
                  'Choose what the sheet includes',
                )}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <GearIcon />
              </button>
              {settingsOpen && (
                <div
                  className="briefingSettingsPanel"
                  role="dialog"
                  aria-label={t('Innhold på arket', 'What the sheet includes')}
                >
                  {switches}
                </div>
              )}
            </div>
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
        </div>
      </div>
      <BriefingSheet data={data} />
    </div>,
    document.body,
  );
}

/** The gear. Drawn rather than imported: one icon does not justify a font or a
 *  dependency, and `currentColor` keeps it in step with the button around it.
 *  aria-hidden because the button it sits in carries the label. */
function GearIcon() {
  return (
    <svg
      className="briefingGear"
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.01a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" />
    </svg>
  );
}

/** A labelled on/off switch. A real checkbox underneath, so keyboard use,
 *  screen readers and the disabled state all behave without reimplementation.
 *  A disabled switch says why on the same line: greying a control out without
 *  a reason is how a tool comes to feel broken. */
function Switch({
  label,
  checked,
  disabled = false,
  hint = null,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string | null;
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
      <span className="briefingSwitchLabel">{label}</span>
      {hint && <span className="briefingSwitchHint">{hint}</span>}
    </label>
  );
}
