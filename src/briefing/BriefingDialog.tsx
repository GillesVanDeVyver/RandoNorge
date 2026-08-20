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
// Some of the controls are not sections but ways of drawing one — steepness
// colours the elevation profile, 3D swaps the flat map for the planner's
// terrain view, and the map layer decides what is draped over it — so they sit
// under what they modify and go out with it. The map layer is also the one
// control here that is not a switch: it has three states, the planner's own
// three, and the third of them (the bare topo sheet) is a real answer rather
// than the absence of one.
//
// Five controls decide for themselves rather than opening where the last export
// left them. Three do it on one principle — a section with nothing to say is
// worse than no section. Snow depth turns off when seNorge says there is none
// along the route; the avalanche forecast turns off when Varsom has not assessed
// any region the route crosses, out of season or off the edge of the forecast
// area, where the section prints as a question mark and the words "ikke
// vurdert"; and the notes field turns off when the tour was saved without any,
// since a guide who wrote nothing down is not asking for a page of ruled lines
// under a heading that says Notes.
//
// The other two are different: the profile's vertical scale and the map's
// overlay are not judgements about the tour but judgements about how to read
// it, and both have already been made — on the panel and the map on screen. So
// the dialog opens on whichever scale the profile is being read at and whatever
// layer the planner has draped over its map, the same way the 3D map opens on
// the camera the planner was left at. See profileScale.ts and the `overlay`
// prop. Neither is remembered between exports, because a remembered answer
// would eventually contradict the screen behind the dialog, and the screen is
// the more recent statement of what the guide wants to see.
//
// All five stay adjustable, not locks. The guide can turn any of them back, and
// doing so is what stops the sheet second-guessing them again: an unrated day on
// the page is a legitimate thing to want, since "Varsom says nothing about
// today" is itself something a briefing can be for.

import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { ProfileData } from '../elevation/profile';
import type { Overlay, Route } from '../types';
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
  type BooleanOptionKey,
  type BriefingOptions,
} from './options';
import { recallProfileScale } from '../profileScale';
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
  /** What the planner is currently draping over its map. The sheet opens on
   *  the same thing, so the printed picture is the one the guide has been
   *  looking at rather than whichever layer this dialog happens to prefer.
   *  Read live rather than captured: the planner's own layer buttons are behind
   *  this modal and cannot be reached while it is open, so "live" and "captured
   *  when it opened" are the same value — and one of them needs no state. */
  overlay?: Overlay;
  /** Saved routes carry a name and description; an unsaved working route
   *  falls back to a generic title so the sheet never prints "undefined". */
  routeName?: string | null;
  routeDescription?: string | null;
  onClose: () => void;
}

/** The switches whose opening position is decided by the tour, or by the panel
 *  behind the dialog, rather than by the last export. Touching one in this
 *  dialog puts it back under the guide's control for good — see `touched`. */
const SELF_DECIDING = [
  'snow',
  'avalanche',
  'notes',
  'trueScale',
  'mapOverlay',
] as const;
type SelfDeciding = (typeof SELF_DECIDING)[number];

const isSelfDeciding = (key: keyof BriefingOptions): key is SelfDeciding =>
  (SELF_DECIDING as readonly string[]).includes(key);

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
  overlay: plannerOverlay,
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
  // the snow and avalanche sections also answer to the day itself (see
  // `options` below). Keeping the two apart means the remembered selection
  // stays a record of choices actually made, and the sheet never has to
  // un-remember one.
  const [chosen, setChosen] = useState<BriefingOptions>(loadOptions);
  // Which of the self-deciding switches have been touched in this dialog,
  // either way. Once one has, its automatic default steps aside for good: a
  // guide who asked for the snow section on a bare route has a reason, and one
  // who turned it off does not need it turned off again.
  const [touched, setTouched] = useState<Record<SelfDeciding, boolean>>({
    snow: false,
    avalanche: false,
    notes: false,
    trueScale: false,
    mapOverlay: false,
  });
  // How the profile is being read on the panel behind this dialog, captured
  // when it opened — the same moment the tour date is captured, and for the
  // same reason: an export describes the planner as it was when the guide
  // asked for it. Null when nobody has touched the toggle this session, in
  // which case the sheet's own default stands.
  const [plannerScale] = useState(recallProfileScale);
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
  // an observation about today's snow or today's forecast, not a preference,
  // and storing it would carry a bare January route's answer into a February
  // one that has a snowpack, or a July tour's answer into the winter — the
  // section would go missing with nothing to say why.
  useEffect(() => {
    storeOptions(chosen);
  }, [chosen]);

  const setOption = useCallback((key: BooleanOptionKey, on: boolean) => {
    // Switching the map back on remounts the canvas and re-fetches its tiles,
    // so readiness has to be earned again rather than inherited from the last
    // time it was drawn. Switching between flat and 3D redraws it from a
    // different renderer entirely — a whole WebGL map has to be built, loaded
    // and photographed — so that waits too, in either direction.
    if ((key === 'map' && on) || key === 'map3d') setMapReady(false);
    if (isSelfDeciding(key)) {
      setTouched((prev) => ({ ...prev, [key]: true }));
    }
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

  // An unrated day: Varsom has answered, and not one of the regions the route
  // crosses is assessed — a summer tour, or a route outside the forecast area.
  // The section can still be printed, and prints honestly (a question mark and
  // "ikke vurdert"), but as a default it is two centimetres of paper saying
  // nothing, which pushes the sections that do say something further down.
  //
  // Read the same way the snow test is: an error is not an answer, and neither
  // is a request still in flight. `fetchedAt` is what tells "assessed nowhere"
  // apart from "not asked yet" — a fresh hook reports level 0 before it has
  // reached Varsom at all, and defaulting off on that would flick the switch
  // in front of anyone quick enough to open the gear.
  const unratedTour =
    !avalanche.loading &&
    avalanche.error === null &&
    avalanche.fetchedAt !== null &&
    avalanche.level === 0;

  // A tour saved without notes. The ruled field is space for the party to write
  // in, so it is not "empty" in the way a snowless chart is — but a guide who
  // typed nothing into the tour's own notes has already said how much of this
  // sheet they want spent on writing, and the field costs a third of a page.
  // Trimmed, because a description of two spaces is no description.
  const notes = routeDescription?.trim() ?? '';
  const unwrittenTour = notes === '';

  // What the sheet actually prints: the guide's selection, with the snow
  // section defaulted off on a route that has no snow on it, the avalanche
  // section defaulted off on a day nobody has rated, the notes field defaulted
  // off on a tour nobody has written about, and the profile's scale taken from
  // the panel the guide was just reading. Derived rather than written back into
  // `chosen`, so the switches reflect the tour in front of them without the
  // dialog having to remember that it once disagreed with the stored
  // preference — and so touching a switch simply takes its override away.
  //
  // Through withDependencies on the way out: this is the one place where an
  // override can turn something *on*, and an inherited "true scale" must not
  // outlive a profile the guide has switched off.
  const options = useMemo(() => {
    const out = { ...chosen };
    if (snowlessTour && !touched.snow) out.snow = false;
    if (unratedTour && !touched.avalanche) out.avalanche = false;
    if (unwrittenTour && !touched.notes) out.notes = false;
    if (plannerScale && !touched.trueScale) {
      out.trueScale = plannerScale === 'true';
    }
    if (plannerOverlay && !touched.mapOverlay) out.mapOverlay = plannerOverlay;
    return withDependencies(out);
  }, [
    chosen,
    snowlessTour,
    unratedTour,
    unwrittenTour,
    plannerScale,
    plannerOverlay,
    touched,
  ]);

  // The map's overlay is picked rather than switched, so it needs its own
  // setter — the same two moves as setOption (retire the inherited default,
  // record the choice) without the boolean.
  //
  // The wait for a fresh picture is only needed in 3D, and the difference is
  // which canvas the guide is looking at. The flat map draws into the very
  // canvas that prints, so a redraw is visible as it happens and a print fired
  // mid-redraw produces the picture that was on screen when it was fired. The
  // 3D view draws into a live GL map *over* that canvas and copies itself down
  // when it settles, so between the choice and the copy the screen and the
  // paper genuinely disagree.
  const rebuildsFor3D = options.map && options.map3d;
  const setMapOverlay = useCallback(
    (next: Overlay) => {
      if (rebuildsFor3D) setMapReady(false);
      setTouched((prev) => ({ ...prev, mapOverlay: true }));
      setChosen((prev) => withDependencies({ ...prev, mapOverlay: next }));
    },
    [rebuildsFor3D],
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
        // The one thing left to say here is why the switch is greyed out. How
        // the map is turned is said on the map itself, where the hand already
        // is.
        hint={
          !options.map
            ? t('Krever kartet det tegner', 'Needs the map it draws')
            : null
        }
        onChange={(on) => setOption('map3d', on)}
      />
      {/* Not a switch, because the map has three states and not two — and the
          third, the bare topo sheet, is a real answer rather than the absence
          of one: it is the map a party draws their own line on. Sits with 3D
          under the map for the same reason, as a way of drawing it.

          What it is *not* is the steepness switch below. That one colours the
          profile and puts the slope bands and the runout exposure in the text,
          and the two used to be one control, which meant the numbers and the
          picture could not be asked for separately. A guide handing out a clean
          map to draw on, with the slope-angle breakdown printed beside it, is a
          perfectly ordinary thing to want. */}
      <Choice
        label={t('Kartlag', 'Map layer')}
        value={options.mapOverlay}
        disabled={!options.map}
        hint={
          options.map
            ? t('Som i planleggeren', 'As in the planner')
            : t('Krever kartet det legges på', 'Needs the map it is drawn on')
        }
        options={[
          { value: 'steepness', label: t('Bratthet', 'Steepness') },
          { value: 'snowdepth', label: t('Snødybde', 'Snow depth') },
          { value: 'none', label: t('Bare kart', 'Map only') },
        ]}
        onChange={setMapOverlay}
      />
      <Switch
        label={t('Høydeprofil', 'Elevation')}
        checked={options.elevation}
        onChange={(on) => setOption('elevation', on)}
      />
      {/* The profile's colouring and the numbers that go with it — the slope-band
          breakdown and the runout exposure. Named for what it is about rather
          than where it is drawn, because it is no longer about the map: that is
          the Kartlag choice above. */}
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
      {/* The planner's own "Riktig skala", printed. Sits under the profile for
          the same reason steepness does: it is a way of drawing that section,
          not a section. Its state arrives from the panel on screen, so for most
          guides this switch is a confirmation rather than a decision. */}
      <Switch
        label={t('Riktig skala', 'True scale')}
        checked={options.trueScale}
        disabled={!options.elevation}
        hint={
          !options.elevation
            ? t(
                'Krever høydeprofilen den måler',
                'Needs the elevation profile it measures',
              )
            : t('En 45°-helning ser ut som 45°', 'A 45° slope looks like 45°')
        }
        onChange={(on) => setOption('trueScale', on)}
      />
      <Switch
        label={t('Snøskredvarsel', 'Avalanche forecast')}
        checked={options.avalanche}
        // Says why it is off, the same way the snow switch does. Kept
        // switchable: "Varsom has not rated this day" is itself something a
        // briefing can be handed out to say.
        hint={
          unratedTour
            ? t('Varsom har ingen vurdering', 'Varsom has no assessment')
            : null
        }
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
        // Says why it is off, like the snow and avalanche switches. Kept
        // switchable, and for a better reason than either of them: ruled space
        // to write the plan in is exactly what a tour nobody has written about
        // might want.
        hint={
          unwrittenTour
            ? t('Ingen notater på turen', 'No notes saved with the tour')
            : null
        }
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

/**
 * One row of the same list, for the one setting that is a choice among three
 * rather than an on and an off. Drawn as a segmented strip under its own label
 * so it reads as a row of the list rather than as a control that wandered in
 * from somewhere else.
 *
 * Real radio inputs underneath, for the same reason the switches are real
 * checkboxes: arrow keys move between the options, the group announces itself
 * as a group, and only the default rendering is replaced.
 */
function Choice<T extends string>({
  label,
  value,
  options,
  disabled = false,
  hint = null,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  hint?: string | null;
  onChange: (value: T) => void;
}) {
  // A radio-group name unique to this mounted dialog, so a second one on the
  // page could never capture this one's clicks.
  const name = useId();
  return (
    <div
      className={`briefingChoice ${disabled ? 'briefingChoiceDisabled' : ''}`}
      role="group"
      aria-label={label}
    >
      <span className="briefingChoiceHead">
        <span className="briefingChoiceLabel">{label}</span>
        {hint && <span className="briefingSwitchHint">{hint}</span>}
      </span>
      <span className="briefingChoiceOptions">
        {options.map((opt) => (
          <label key={opt.value} className="briefingChoiceOption">
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              disabled={disabled}
              onChange={() => onChange(opt.value)}
            />
            <span className="briefingChoiceChip">{opt.label}</span>
          </label>
        ))}
      </span>
    </div>
  );
}
