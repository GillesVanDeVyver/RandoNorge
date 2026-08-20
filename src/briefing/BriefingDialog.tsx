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
// Print is held until every picture on the sheet is actually there: the map
// canvas has to report ready, and the weather table's sky icons have to have
// loaded. A briefing whose map frame prints half-drawn is worse than no
// briefing, and a print fired in the same moment the icons were requested comes
// out with a column of holes. Both waits are conditional on the section being
// switched on; nothing here waits on the network for a picture it is not going
// to print.
//
// PDF generation is the browser's: window.print() → "Save as PDF". No client
// -side PDF library, so nothing here can drift out of sync with what the user
// sees, and the app carries no extra dependency. The one thing the browser
// gets wrong on its own is the file name, which it takes from the document
// title — so the title is swapped for "<tour>_Fjellrute" for the duration of
// the print and put back afterwards.
//
// Two of the switches are not sections but ways of drawing one — steepness
// colours the elevation profile, and 3D swaps the flat map for the planner's
// terrain view — so they sit under what they modify and go out with it.
//
// One switch decides for itself: snow depth turns off when seNorge says there
// is none along the route, because a page of zeroes is worse than no page. It
// stays a switch, not a lock — the guide can turn it back on, and doing so is
// what stops the sheet second-guessing them again.

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
import { hasSnowOnRoute, summariseSnow } from './snowSummary';
import { briefingFileName } from './fileName';
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
  /** Day (YYYY-MM-DD) the weather table should cover, captured from the weather
   *  panel's own day selection. Null when the panel has not published one, in
   *  which case the tour date stands in. */
  weatherDate?: string | null;
  /** Saved routes carry a name and description; an unsaved working route
   *  falls back to a generic title so the sheet never prints "undefined". */
  routeName?: string | null;
  routeDescription?: string | null;
  onClose: () => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const toYMDLocal = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Hours of the forecast that fall on the given date, in local time — the same
 *  local-day grouping the weather panel uses, so the printed table and the
 *  on-screen chart agree about which hours belong to the day. Every hour that
 *  falls inside the day is kept: MET publishes hourly for the first couple of
 *  days and six-hourly after that, and the sheet prints whatever resolution it
 *  was given rather than deciding for the reader which hours matter. */
function hoursOnDate(hours: WeatherHour[] | null, ymd: string): WeatherHour[] {
  if (!hours) return [];
  return hours.filter((h) => toYMDLocal(new Date(h.time)) === ymd);
}

/** Load every sky icon the day could ask for, resolving once they have all
 *  either arrived or failed.
 *
 *  The sheet's weather table renders MET's icons as <img>, and an <img> that is
 *  still in flight when window.print() runs prints as nothing. Everything else
 *  the sheet draws is either text or a canvas the sheet waits for, so these are
 *  the last thing that can be missing from an otherwise finished page. Failures
 *  resolve like successes: an icon that 404s is never going to arrive, and
 *  holding Print for it would trade a missing picture for a stuck button. */
function preloadSymbols(codes: string[]): Promise<void> {
  return Promise.all(
    codes.map(
      (code) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = `/weather-icons/${code}.svg`;
        }),
    ),
  ).then(() => undefined);
}

export function BriefingDialog({
  route,
  profile,
  date,
  weatherDate = null,
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

  // What the guide has asked for, which is not quite what the sheet prints:
  // the snow section also answers to the snow itself (see `options` below).
  // Keeping the two apart means the remembered selection stays a record of
  // choices actually made, and the sheet never has to un-remember one.
  const [chosen, setChosen] = useState<BriefingOptions>(loadOptions);
  // Whether the snow switch has been touched in this dialog, either way. Once
  // it has, the automatic default steps aside for good: a guide who asked for
  // the snow section on a bare route has a reason, and one who turned it off
  // does not need it turned off again.
  const [snowChosen, setSnowChosen] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [loadedSymbols, setLoadedSymbols] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

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

  // A guide printing a stack of briefings sets the switches once. Only the
  // chosen selection is written: a section the sheet turned off by itself is
  // an observation about today's snow, not a preference, and storing it would
  // carry a bare January route's answer into a February one that has a
  // snowpack — the section would go missing with nothing to say why.
  useEffect(() => {
    storeOptions(chosen);
  }, [chosen]);

  const setOption = useCallback((key: keyof BriefingOptions, on: boolean) => {
    // Switching the map back on remounts the canvas and re-fetches its tiles,
    // so readiness has to be earned again rather than inherited from the last
    // time it was drawn. Switching between flat and 3D redraws it from a
    // different renderer entirely — a whole WebGL map has to be built, loaded
    // and photographed — so that waits too, in either direction.
    if ((key === 'map' && on) || key === 'map3d') setMapReady(false);
    if (key === 'snow') setSnowChosen(true);
    // withDependencies keeps steepness from being stranded without the profile
    // it colours.
    setChosen((prev) => withDependencies({ ...prev, [key]: on }));
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
  // Asked for whether or not the section is switched on: the switch's own
  // default depends on the answer, so "is there snow on this route?" has to be
  // settled before the guide opens the gear, not after they turn the section
  // on to find out. One seNorge request, cached for an hour and shared with
  // the panel on screen.
  const snow = useSnow(profile, snowDate, frozenSnow);
  const snowSummary = useMemo(
    () => summariseSnow(profile, snow.snow),
    [profile, snow.snow],
  );
  // A bare route: the grid either said 0 cm the whole way or had nothing to say
  // about any point on it, and both print the same empty chart. An error is not
  // an answer, and neither is a request still in flight — until seNorge has
  // replied the switch is left exactly where the guide left it.
  const snowlessTour =
    !snow.loading && snow.snow !== null && !hasSnowOnRoute(snowSummary);

  // What the sheet actually prints: the guide's selection, with the snow
  // section defaulted off on a route that has no snow on it. Derived rather
  // than written back into `chosen`, so the switch reflects the tour in front
  // of it without the dialog having to remember that it once disagreed with
  // the stored preference — and so touching the switch simply takes the
  // override away.
  const options = useMemo(
    () => (snowlessTour && !snowChosen ? { ...chosen, snow: false } : chosen),
    [chosen, snowlessTour, snowChosen],
  );

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

  const title = routeName?.trim() || t('Turbriefing', 'Tour briefing');

  // What the saved PDF is called. "Save as PDF" suggests the document title,
  // so the title becomes the file name for as long as the print lasts. The
  // name itself is built in fileName.ts.
  const fileName = useMemo(() => briefingFileName(routeName), [routeName]);

  // The title the app had before this dialog opened, and the two ways it comes
  // back: when the print dialog closes, and when the briefing does. Both,
  // because Safari has been known not to fire afterprint, and a tab left
  // reading "Skåla_Fjellrute" would follow the user around for the rest of the
  // session. Captured once on open rather than at each print, so a second
  // print restores the app's title and not the first print's file name.
  const appTitleRef = useRef<string | null>(null);
  useEffect(() => {
    appTitleRef.current = document.title;
    const restore = () => {
      if (appTitleRef.current !== null) document.title = appTitleRef.current;
    };
    window.addEventListener('afterprint', restore);
    return () => {
      window.removeEventListener('afterprint', restore);
      restore();
    };
  }, []);

  const printSheet = useCallback(() => {
    document.title = fileName;
    window.print();
  }, [fileName]);

  // The weather panel keeps its own day selection, which need not be the tour
  // date — the tour date comes from the avalanche panel. Follow the weather
  // panel where it has one, and print the day in the heading so the two dates
  // on the sheet are never ambiguous.
  const weatherDay = weatherDate ?? date;

  // Every sky icon the table could reach for, from both anchors and the day the
  // table is showing. Deliberately wider than the six or so the table will
  // actually render: which reading represents a period is decided inside the
  // sheet, and duplicating that rule here to preload a shorter list would be a
  // second copy of it to keep in step for no gain — the files are a few hundred
  // bytes each and are cached after the first sheet.
  const symbolCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const hours of [
      hoursOnDate(weatherLow.hours, weatherDay),
      hoursOnDate(weatherHigh.hours, weatherDay),
    ]) {
      for (const h of hours) if (h.symbolCode) codes.add(h.symbolCode);
    }
    return [...codes].sort();
  }, [weatherLow.hours, weatherHigh.hours, weatherDay]);

  // Which icons are known to be in the browser's cache, and from that whether
  // the sheet's table can be printed. Kept as the set that has loaded rather
  // than as a ready flag, so readiness is derived: a day whose icons have not
  // arrived is not ready without anything having to reset a flag, and the ones
  // already fetched stay counted, which is the truth — they are cached.
  useEffect(() => {
    let cancelled = false;
    void preloadSymbols(symbolCodes).then(() => {
      if (cancelled) return;
      setLoadedSymbols((prev) => new Set([...prev, ...symbolCodes]));
    });
    return () => {
      cancelled = true;
    };
  }, [symbolCodes]);
  const symbolsReady = symbolCodes.every((c) => loadedSymbols.has(c));

  // Only wait on the sources that are actually going to be printed: a guide
  // who switched weather off should not be held at "Preparing…" by MET.
  const weatherLoading = weatherLow.loading || weatherHigh.loading;
  const canPrint =
    (!options.map || mapReady) &&
    !(options.avalanche && avalanche.loading) &&
    !(options.weather && (weatherLoading || !symbolsReady)) &&
    !(options.snow && snow.loading);

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
      hours: hoursOnDate(weatherLow.hours, weatherDay),
      fetchedAt: weatherLow.fetchedAt,
    },
    weatherHigh: {
      elevationM: high ? Math.round(high.elevation) : null,
      hours: hoursOnDate(weatherHigh.hours, weatherDay),
      fetchedAt: weatherHigh.fetchedAt,
    },
    weatherLoading,
    weatherDate: weatherDay,
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
      {/* Not a section but a way of drawing one, which is why it sits under the
          map rather than beside it — the same relationship steepness has to the
          elevation profile. The preview redraws as soon as it is flipped, so
          the choice is made by looking rather than by imagining. */}
      <Switch
        label={t('Vis kartet i 3D', 'Show the map in 3D')}
        checked={options.map3d}
        disabled={!options.map}
        hint={
          !options.map
            ? t('Krever kartet det tegner', 'Needs the map it draws')
            : options.map3d
              ? t('Dra i kartet for å snu det', 'Drag the map to turn it')
              : null
        }
        onChange={(on) => setOption('map3d', on)}
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
        // Says why it is off rather than leaving the guide to wonder whether
        // the section is broken. Kept switchable: seNorge models a 1 km grid,
        // and a guide who wants the zeroes on the page is entitled to them.
        hint={
          snowlessTour
            ? t('seNorge melder ingen snø', 'seNorge reports no snow')
            : null
        }
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
              onClick={printSheet}
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
