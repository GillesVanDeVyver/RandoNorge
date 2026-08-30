// The printable tour briefing: one A4 page a guide can hand a client or pin
// up on a skredkurs.
//
// Everything on it is already in the planner — this is a re-presentation, not
// a new data source. What changes is the framing: the screen is exploratory
// (hover, switch days, expand a problem), whereas paper has to answer "what
// are we doing, how exposed is it, and what is the snowpack doing today?" in
// one glance, with no interaction available.
//
// The page is intentionally NOT a dump of every panel. Anything a person can't
// act on in the field is left off to keep it to a single sheet.

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ProfileData } from '@fjellrute/core/elevation/profile';
import type { LatLng, Overlay, Route } from '@fjellrute/core/types';
import type { AvalancheWarning } from '@fjellrute/core/avalanche/api';
import type { WeatherHour } from '@fjellrute/core/weather/api';
import { DANGER_LEVELS, dangerLevelLabel } from '@fjellrute/core/avalanche/dangerScale';
import {
  DIRS,
  aspectList,
  elevationText,
  roseSectorPath,
} from '@fjellrute/core/avalanche/problemText';
import type { SnowData } from '@fjellrute/core/snow/useSnow';
import type { ParkingArea } from '../parking/api';
import {
  formatParkingDistance,
  formatParkingRadius,
  parkingFacts,
  parkingUsage,
  takeParkingFacts,
} from '../parking/format';
import { summariseTerrain, runoutLevelLabel } from './terrain';
import { ProfileSvg } from './ProfileSvg';
import { SnowSvg } from './SnowSvg';
import { summariseSnow } from '@fjellrute/core/snow/summary';
import { WeatherSymbol, WindArrowIcon } from '../components/WeatherIcons';
import { renderStaticMap } from './staticMap';
import { TerrainPicture } from './TerrainPicture';
import { MapZoomControls } from './MapZoomControls';
import {
  FIT,
  isFit,
  panBy,
  useWheelZoom,
  zoomBy,
  ZOOM_STEP,
  type Framing,
} from './mapFraming';
import { TERRAIN_BEARING } from '../terrainView';
import type { BriefingOptions } from './options';
import { useT, type Translate } from '@fjellrute/core/i18n';
import { translate } from '@fjellrute/core/i18n/locale';
import { pad2 } from '@fjellrute/core/time/calendar';
import { windArrowRotation } from '@fjellrute/core/weather/format';

/** Which of the planner's two maps the sheet prints. Flat and north-up reads
 *  as a map and can be navigated from; the terrain view reads as a mountain and
 *  is what makes a shoulder or a cornice line obvious to someone who has never
 *  been there. Which one helps depends entirely on who the sheet is for, which
 *  is why it is a switch and not a decision made here. */
type MapView = '2d' | '3d';

// The map canvas is rendered well above its printed size: print renderers
// output at far more than the 96 dpi the CSS pixel implies, and a canvas sized
// for the screen prints visibly soft. The frame is 128 sheet mm wide, which is
// 96 mm on paper once the sheet's 75% zoom is applied, so 1280 backing pixels
// land at well over 300 dpi — sharp enough for contour lines, and the shrink
// only made it sharper.
//
// The map's backing pixels. The ratio between these two has to stay in step
// with `aspect-ratio` on .briefingMapFrame — the frame decides the shape on
// paper and the canvas fills it, so a mismatch stretches the terrain.
//
// 128:68 rather than a squarer frame because the map is the biggest single
// block on the sheet and the cheapest to shorten: a route drawn across a
// 128 mm-wide frame is nearly always wider than it is tall, so the height
// mostly bought empty hillside. See the vertical budget in briefing.css.
const MAP_W = 1280;
const MAP_H = 680;
const MAP_SCALE = 2;

// How far an arrow key moves the flat map: an eighth of the frame. Coarse
// enough to cross it in a few presses, fine enough to place a col where you
// wanted it.
const KEY_PAN = 1 / 8;

// Width of the weather table's period column, as a percentage. "06–09" and its
// heading need very little room, and every millimetre spent here is taken from
// the readings.
const TIME_COL_PCT = 10;

// How the rest of the width is split between one anchor's four readings, in
// arbitrary weights rather than percentages: the table narrows to a single
// anchor when MET only answered for one end of the route, and weights rescale
// where fixed percentages would leave half the paper blank.
//
// Unequal on purpose, because the columns are not: "NØ 12 ↘ (18)" is three times
// the width of "-4°", and the sky is an icon. What has to stay equal is the two
// anchors, which are read straight across from one another — so both groups take
// the same weights, and only the pair as a whole scales.
//
// Declared in the weather panel's own order — sky, temperature, precipitation,
// wind — and read in that order everywhere below, so the printed columns come out
// in the sequence someone who has been looking at the screen already expects.
// Wind is last and widest there because it is the busiest cell, and it grew a
// little here when the panel's direction arrow joined the compass letters.
const COL_WEIGHTS = { sky: 6.5, temp: 8.5, precip: 12, wind: 18 };
const ANCHOR_WEIGHT = Object.values(COL_WEIGHTS).reduce((a, b) => a + b, 0);

// How much labelled parking detail one printed row holds, in characters.
//
// A count rather than a width because the choice being made is which whole
// facts to print, and that has to be made before any of them is laid out — the
// sheet gives each lot exactly one line (see the vertical budget at the top of
// briefing.css), paper does not reflow, and CSS cannot count. takeParkingFacts
// spends this and drops the least load-bearing fields; .briefingParkingFacts
// clips as a backstop, so a bad estimate here costs a fact rather than a second
// line or a lot pushed off the page.
//
// Measured rather than derived, because the arithmetic was wrong twice — both
// times optimistically about the width and pessimistically about the budget,
// which cost printed facts for nothing.
//
// The section is full-bleed: 253.3 sheet mm, being 280 mm of A4 at the sheet's
// 0.75 zoom less two 13.3 mm edges. After the plate, the 62 mm lead, the 14 mm
// distance and their gaps, .briefingParkingFacts renders 194.8 mm wide. The
// fully tagged fixture row prints all seven of its facts in 177 mm for 134
// characters; a sparser row costs 1.255 mm a character and that one 1.321, so
// the line holds somewhere between 147 and 155 characters depending on what is
// in them.
//
// Set at 142, inside the pessimistic end of that range. The rate varies because
// the values are strings mappers typed — "Betaling App, Kredittkort, Mynt" is
// wider per character than "Plasser 40" — and it varies in the wrong direction:
// the row that would overrun is reliably the one carrying the most, so the
// margin has to be sized against the worst rate rather than the average. At 142
// the widest observed rate lands at 187.6 mm of the 194.8 available.
//
// The other end matters as much. The fullest lot the extract realistically
// produces — every field set, a municipal operator, two payment methods — comes
// to 137, so it prints whole and the sheet shows exactly what the tab shows.
// Dropping is for lots past that, and is meant to stay the exception; a budget
// tight enough to trim real data would have reintroduced the very gap between
// paper and screen this section was rewritten to close.
//
// Do not re-derive this from a font metric. Verify it: scripts/verify-briefing.mjs
// checks both that the fully tagged fixture keeps everything and that a
// deliberately overfull lot sheds the right facts.
const PARKING_FACT_BUDGET = 142;

/** One end of the route as a weather anchor: the forecast, plus the elevation
 *  it applies to (a summit reading means little without its height). */
export interface BriefingAnchor {
  elevationM: number | null;
  hours: WeatherHour[];
  /** Epoch ms this anchor's forecast came back from MET, or null when nothing
   *  arrived. The two anchors are asked for together, but either can be served
   *  from cache, so the heading prints the older of the two. */
  fetchedAt: number | null;
}

export interface BriefingData {
  routeName: string;
  routeDescription: string | null;
  /** Tour date (YYYY-MM-DD) the forecasts describe. */
  date: string;
  route: Route;
  profile: ProfileData;
  /** Which sections to print. Only the route's own facts are not optional. */
  options: BriefingOptions;
  /** Highest danger level along the route, and the regions it crosses. */
  avalancheLevel: number;
  avalancheRegions: AvalancheWarning[];
  avalancheLoading: boolean;
  /** Epoch ms the bulletin was fetched from Varsom, or null when nothing was
   *  retrieved. Printed alongside the tour date, not instead of it: bulletins
   *  are rewritten during the day, and a saved route replays whatever was
   *  captured, so the day it describes and its age are separate facts. */
  avalancheFetchedAt: number | null;
  /** Forecast at both ends of the route, printed side by side: the difference
   *  between valley and summit is usually the decision-relevant part. */
  weatherLow: BriefingAnchor;
  weatherHigh: BriefingAnchor;
  weatherLoading: boolean;
  /** The day (YYYY-MM-DD) the weather rows were sliced to — whichever day the
   *  weather panel is showing, which is usually but not always the tour date.
   *  Printed in the heading so a briefing prepared while looking ahead at, say,
   *  Sunday's forecast can't be mistaken for Saturday's. */
  weatherDate: string;
  /** seNorge depths along the route, and the date they actually describe. */
  snow: SnowData | null;
  snowLoading: boolean;
  snowDate: string;
  /** True when snowDate had to fall back off the tour date because seNorge
   *  models the past, not the future. Printed so nobody reads a stale depth
   *  as a forecast. */
  snowIsFallback: boolean;
  /** Parking areas near the route start, nearest first, as listed in the
   *  planner's Parking tab. Empty means OpenStreetMap had nothing mapped in
   *  range, which the section states as a fact about the map rather than
   *  about the ground — see src/parking/api.ts. */
  parking: ParkingArea[];
  parkingLoading: boolean;
  /** The radius the list was gathered within, meters. Printed in the heading:
   *  "nothing within 2 km" and "nothing within 10 km" are different findings
   *  and the reader cannot tell them apart otherwise. */
  parkingRadiusM: number;
  /** Fired once the map canvas has finished drawing (or has given up on the
   *  tiles). The dialog holds Print until then: printing while tiles are still
   *  arriving would put a half-drawn map on the paper. */
  onMapReady?: () => void;
}

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_NO = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const DOW_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW_NO = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];

function longDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dow = new Date(y, m - 1, d).getDay();
  return translate(
    `${DOW_NO[dow]} ${d}. ${MONTHS_NO[m - 1]} ${y}`,
    `${DOW_EN[dow]} ${d} ${MONTHS_EN[m - 1]} ${y}`,
  );
}

/** When a forecast was fetched, worded as the panels on screen word it, so a
 *  printed sheet and the app never disagree about how old the data is. */
function retrievedAt(ms: number): string {
  return new Date(ms).toLocaleString(translate('nb-NO', 'en-GB'), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The line under a forecast heading saying when that forecast was fetched.
 *  It sits below the heading rather than inside it: the heading answers what
 *  the section is and which day it speaks for, and the provenance is a quieter
 *  question that should not compete with either. Renders nothing at all when a
 *  source never answered, so no section is left with a stray label. */
function Retrieved({ at }: { at: number | null | undefined }) {
  if (at == null || !Number.isFinite(at)) return null;
  return (
    <p className="briefingRetrieved">
      {translate('Hentet', 'Retrieved')} {retrievedAt(at)}
    </p>
  );
}

/** The older of two fetch times, ignoring the ones that never happened. The
 *  weather section asks for both anchors together but either can come from
 *  cache, and the honest single moment to print is the stalest one. */
function olderFetch(a: number | null, b: number | null): number | null {
  const known = [a, b].filter(
    (n): n is number => n != null && Number.isFinite(n),
  );
  return known.length > 0 ? Math.min(...known) : null;
}

function km(m: number): string {
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function metres(m: number): string {
  return `${Math.round(m).toLocaleString(translate('nb-NO', 'en-GB'))} m`;
}

/** Compass point for a wind direction in degrees. */
function compass(deg: number): string {
  const i = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return translate(
    ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'][i],
    ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][i],
  );
}

/** Precipitation for an hour, or null when nothing is forecast. Mirrors the
 *  weather panel's rule so the sheet and the screen agree. */
function precip(h: WeatherHour): string | null {
  const lo = h.precipMinMm;
  const hi = h.precipMaxMm;
  const mid = h.precipMm;
  if (
    (lo == null || lo === 0) &&
    (hi == null || hi === 0) &&
    (mid == null || mid === 0)
  ) {
    return null;
  }
  if (typeof lo === 'number' && typeof hi === 'number' && hi !== lo) {
    return `${lo.toFixed(lo < 1 ? 1 : 0)}–${hi.toFixed(hi < 10 ? 1 : 0)}`;
  }
  if (typeof mid === 'number') return mid.toFixed(mid < 10 ? 1 : 0);
  return null;
}

// The day prints as three-hour periods in LOCAL time, from 06 to midnight:
// 06–09, 09–12, 12–15, 15–18, 18–21, 21–24. A tour is planned in parts of a
// day, not hour by hour, and one row per hour cost about 130 sheet mm — most of
// a page — to say something the reader then had to average in their head
// anyway. Three hours is the shortest period that still says something a party
// can act on: it is roughly a climb, a summit stop, or a descent.
//
// Local, because the hours handed in were already sliced to one local day by
// the dialog. The night is left off: 06 is earlier than all but the most
// committed starts, and two rows of darkness cost the same paper as two rows of
// daylight.
//
// This grid is what MET's HOURLY forecast is grouped into. Past roughly two days
// MET stops publishing hourly and serves entries every six hours instead, at
// 00/06/12/18 UTC — 01/07/13/19 local in Norwegian winter, 02/08/14/20 in
// summer. Forcing those into three-hour rows would leave half the table empty
// and imply a resolution that does not exist, so a coarse forecast keeps MET's
// own periods and prints as few, longer rows (07–13, 13–19, 19–01). The sheet
// shows the resolution it was given rather than inventing one; see periodGrid.
const BLOCK_HOURS = 3;
const BLOCK_STARTS = [6, 9, 12, 15, 18, 21];
/** First local hour the sheet prints. Readings before it are dropped. */
const DAY_START_HOUR = BLOCK_STARTS[0];

/** One row's period: the local hour it opens at and how many hours it covers.
 *  A period may run past midnight (19–01) when that is the block MET served. */
interface Period {
  start: number;
  hours: number;
}

interface WeatherRow {
  /** Local hour the period starts at. Also the row's key — one row per start
   *  hour, so it is stable in a way an aggregate's timestamp would not be. */
  start: number;
  /** "06–09". Printed instead of an instant because the numbers describe a
   *  period, and a row labelled 06:00 would read as a reading taken then. */
  label: string;
  low: WeatherHour | null;
  high: WeatherHour | null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Mean wind direction. Directions are angles, so they have to be averaged as
 *  vectors rather than as numbers: the arithmetic mean of 350° and 10° is 180°,
 *  which is the exact opposite of the wind that blew. */
function meanDirection(degs: number[]): number {
  let x = 0;
  let y = 0;
  for (const d of degs) {
    const r = (d * Math.PI) / 180;
    x += Math.cos(r);
    y += Math.sin(r);
  }
  // Directions that cancel exactly have no mean — any answer is as wrong as
  // another, and atan2(0, 0) is 0, which would print a confident "N". Fall back
  // to the first reading, which at least happened.
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return degs[0];
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** The finite numbers in a list of maybe-numbers. MET leaves gusts and the
 *  precipitation band out rather than sending zeroes, so "absent" and "zero"
 *  have to stay distinguishable all the way to the cell. */
const known = (xs: (number | null | undefined)[]): number[] =>
  xs.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));

const sumOrNull = (xs: (number | null | undefined)[]): number | null => {
  const ns = known(xs);
  return ns.length > 0 ? ns.reduce((a, b) => a + b, 0) : null;
};

/** The hours a reading's precipitation figures cover, and with them the shortest
 *  period the reading can honestly be printed against. One hour while MET is
 *  publishing hourly, six once it has switched to blocks, and one for an entry
 *  that carries no precipitation at all — an instant is a fine thing to put in
 *  a three-hour row, it simply does not add up to a longer one.
 *
 *  Snapshots taken before the field existed have no value here; they were all
 *  hourly, which is exactly what the fallback assumes. */
const spanOf = (h: WeatherHour): number => h.precipHours ?? 1;

/** Collapse the readings falling inside one period into a single reading.
 *
 *  Not everything averages, and pretending otherwise would print numbers that
 *  are quietly wrong:
 *
 *    - Temperature and wind speed are states, so the period's average state is
 *      exactly what is wanted.
 *    - Precipitation is an accumulation, so it sums. Averaging three hourly
 *      millimetres would print 1 mm for a period in which 3 mm falls. The
 *      readings' own windows never overlap — MET's entries are sequential, and
 *      the grid is built so that no reading's window outruns its row — so the
 *      sum is a true total for the period and not a double count.
 *    - The gust takes the period's maximum. A gust is already a peak, and the
 *      only reason to print it is the worst the party will be standing in; an
 *      averaged gust is a speed nothing ever gusted to.
 *    - The sky symbol takes the wettest hour, falling back to the middle of the
 *      period when nothing is forecast. Same reasoning as the gust: of three
 *      hours, two clear and one snowing, the snow is the one that changes what
 *      the party does, and an icon is read before any number on the row. */
function blockReading(hours: WeatherHour[]): WeatherHour | null {
  if (hours.length === 0) return null;
  const gusts = known(hours.map((h) => h.windGust));
  const wettest = hours.reduce((worst, h) =>
    (h.precipMm ?? h.precipMaxMm ?? 0) > (worst.precipMm ?? worst.precipMaxMm ?? 0)
      ? h
      : worst,
  );
  const anyPrecip = (wettest.precipMm ?? wettest.precipMaxMm ?? 0) > 0;
  return {
    // The first reading in the period. Nothing on the sheet reads this — the row
    // is labelled by its period — but a WeatherHour without a time would be a
    // trap for the next person to use one of these.
    time: hours[0].time,
    temperature: mean(hours.map((h) => h.temperature)),
    windSpeed: mean(hours.map((h) => h.windSpeed)),
    windFromDeg: meanDirection(hours.map((h) => h.windFromDeg)),
    windGust: gusts.length > 0 ? Math.max(...gusts) : null,
    symbolCode: (anyPrecip ? wettest : hours[Math.floor(hours.length / 2)])
      .symbolCode,
    precipMm: sumOrNull(hours.map((h) => h.precipMm)),
    // The band sums with the total: its ends are accumulations over the same
    // period, so a period's low and high are the sums of the readings' lows and
    // highs, not their averages.
    precipMinMm: sumOrNull(hours.map((h) => h.precipMinMm)),
    precipMaxMm: sumOrNull(hours.map((h) => h.precipMaxMm)),
    // Explicitly not an hourly figure: these millimetres are a total for
    // whatever period the row covers, and null is how that is said. Left in
    // rather than omitted so an aggregate can never be mistaken for one of
    // MET's own hours by anything that reads one of these later.
    precipHours: null,
  };
}

/** The hour a period ends at, as it is written on the row. Midnight is 24 at
 *  the end of the day — "21–24" closes the day, where "21–00" reads like a typo
 *  — but a period that genuinely runs into the next day wraps, because MET's
 *  evening block really does cover 19–01. */
const endLabel = (p: Period): string => {
  const end = p.start + p.hours;
  return end === 24 ? '24' : pad2(end % 24);
};

/** Local hours of the day, sorted and deduplicated, that either anchor has a
 *  reading for — paired with the longest window any reading at that hour
 *  covers. Both anchors together, because the two are printed on one row and a
 *  period one of them cannot fill is still a period. */
function readingHours(...anchors: BriefingAnchor[]): Period[] {
  const spans = new Map<number, number>();
  for (const anchor of anchors) {
    for (const h of anchor.hours) {
      // Local, matching how the dialog sliced the day. Bucketing in UTC would
      // put an evening reading in the morning for half the year.
      const hour = new Date(h.time).getHours();
      if (hour < DAY_START_HOUR) continue;
      spans.set(hour, Math.max(spans.get(hour) ?? 0, spanOf(h)));
    }
  }
  return [...spans.entries()]
    .map(([start, hours]) => ({ start, hours }))
    .sort((a, b) => a.start - b.start);
}

/** The periods this day's forecast can be printed as, in order and never
 *  overlapping.
 *
 *  Two kinds of row come out of this. A reading whose window fits inside three
 *  hours is grouped into the fixed grid, which is what makes an hourly day read
 *  as 06–09, 09–12 and so on however many hours actually arrived. A reading
 *  covering more than that — MET's six-hour blocks, past its hourly window —
 *  becomes a row of its own, labelled with the block it really is, because
 *  splitting a six-hour total across two rows would invent a distribution
 *  inside it and printing it in one three-hour row would put six hours of rain
 *  behind a three-hour label.
 *
 *  Coarse periods are laid down first and the grid fills in around them, so a
 *  day that turns coarse halfway through — the common case two days out — comes
 *  out as three-hour rows while MET is hourly and six-hour rows after.
 *
 *  Where the two meet, an hourly reading whose grid slot is already taken by a
 *  coarse block gets no row: at most an hour or two before the handover, left
 *  out because both alternatives are worse. A row overlapping the block would
 *  print its precipitation twice under two headings, and moving the grid to dodge
 *  it would put a label on a period no reading covers. */
function periodGrid(low: BriefingAnchor, high: BriefingAnchor): Period[] {
  const readings = readingHours(low, high);
  const periods: Period[] = [];
  const overlaps = (start: number, hours: number) =>
    periods.some((p) => start < p.start + p.hours && p.start < start + hours);

  for (const r of readings) {
    if (r.hours <= BLOCK_HOURS) continue;
    if (!overlaps(r.start, r.hours)) periods.push({ start: r.start, hours: r.hours });
  }
  for (const r of readings) {
    if (r.hours > BLOCK_HOURS) continue;
    const start = BLOCK_STARTS.filter((s) => s <= r.start).pop();
    if (start == null) continue;
    if (!overlaps(start, BLOCK_HOURS)) periods.push({ start, hours: BLOCK_HOURS });
  }
  return periods.sort((a, b) => a.start - b.start);
}

/** One aggregated reading per period, in period order, with nulls where an
 *  anchor had no readings at all in that part of the day. */
function anchorPeriods(
  hours: WeatherHour[],
  periods: Period[],
): (WeatherHour | null)[] {
  const buckets: WeatherHour[][] = periods.map(() => []);
  for (const h of hours) {
    const hour = new Date(h.time).getHours();
    const i = periods.findIndex(
      (p) => hour >= p.start && hour < p.start + p.hours,
    );
    if (i >= 0) buckets[i].push(h);
  }
  return buckets.map(blockReading);
}

/** One row per period, with the valley and summit readings side by side and
 *  aligned on the period rather than on a timestamp — the two anchors are read
 *  straight across. A period neither anchor covered is dropped rather than
 *  printed as a row of dashes: a sheet for half a day of forecast should be
 *  shorter, not emptier. */
function weatherRows(low: BriefingAnchor, high: BriefingAnchor): WeatherRow[] {
  const periods = periodGrid(low, high);
  const lows = anchorPeriods(low.hours, periods);
  const highs = anchorPeriods(high.hours, periods);
  return periods
    .map((p, i) => ({
      start: p.start,
      label: `${pad2(p.start)}–${endLabel(p)}`,
      low: lows[i],
      high: highs[i],
    }))
    .filter((r) => r.low != null || r.high != null);
}

/** Wind as one cell: direction in letters, mean speed, the panel's rotating
 *  arrow, then the gust in parentheses — the weather panel's cell, with one
 *  thing added. Three separate columns per anchor would not fit twice across the
 *  page, and the gust is only ever read next to the mean anyway.
 *
 *  The two direction cues use opposite conventions, which is why both are here
 *  rather than either alone. MET reports where the wind comes FROM and the
 *  compass letters say that; the arrow, as on screen, points where it is blowing
 *  TO. On screen the arrow can be the whole statement, because it sits in a
 *  column of twenty-four of them whose drift is the actual reading and because
 *  hovering it names the direction. Paper has neither the column nor the
 *  tooltip, so the letters carry the fact and the arrow carries the shape of the
 *  day — which way the wind swings between morning and evening, visible down the
 *  column at a glance. Letters cannot be misread; an arrow on its own can. */
function WindCell({ h }: { h: WeatherHour | null }) {
  if (!h) return <>–</>;
  const rot = windArrowRotation(h.windFromDeg);
  return (
    <>
      {compass(h.windFromDeg)} {Math.round(h.windSpeed)}
      <span
        className="briefingWindArrow"
        style={{ transform: `rotate(${rot}deg)` }}
        aria-hidden
      >
        <WindArrowIcon />
      </span>
      {h.windGust != null && (
        <span className="briefingGust"> ({Math.round(h.windGust)})</span>
      )}
    </>
  );
}

/** Temperature, tinted as the panel tints it: freezing and below reads blue,
 *  above reads warm. On a winter sheet the sign is the single most consequential
 *  character in the table, and colour is read before the minus is. */
function TempCell({ h }: { h: WeatherHour | null }) {
  if (!h) return <>–</>;
  return (
    <span className={h.temperature <= 0 ? 'briefingTempCold' : 'briefingTempWarm'}>
      {Math.round(h.temperature)}°
    </span>
  );
}

/** Precipitation, in the panel's blue. A dry period prints as nothing at all,
 *  which is what the panel does and is the whole reason the column reads at a
 *  glance: the blue figures are the weather, and the gaps between them are the
 *  dry spells. Filling every dry period with a dash gives the eye six marks to
 *  discount before it can see the two that matter.
 *
 *  A dash is kept for the other case — no reading for this period at all, which
 *  is a different thing from "no rain" and is what the rest of the row shows too.
 *  Blank means dry; dash means MET did not say. */
function PrecipCell({ h }: { h: WeatherHour | null }) {
  if (!h) return <>–</>;
  const p = precip(h);
  if (p == null) return null;
  return <span className="briefingPrecip">{p}</span>;
}

/** The period's sky, drawn with MET's own icons — the same artwork, from the
 *  same files, as the weather panel on screen. It is the one thing on the row a
 *  reader takes in without reading, which is worth a column on a sheet consulted
 *  in wind with cold hands. */
function SkyCell({ h }: { h: WeatherHour | null }) {
  if (!h?.symbolCode) return null;
  return (
    <span className="briefingSky">
      {/* Empty alt: the row is fully described by the figures beside it, so the
          icon is decoration rather than a second, wordless data source. */}
      <WeatherSymbol code={h.symbolCode} title="" />
    </span>
  );
}

function MapPicture({
  route,
  overlay,
  snowDate,
  parking,
  view,
  onReady,
}: {
  route: Route;
  /** What is draped over the topo tiles: NVE's steepness/runout shading,
   *  seNorge's snow depth, or nothing. Follows the map-overlay choice, which is
   *  the planner's own — and not the steepness switch, which is now only about
   *  the profile and the numbers under it. */
  overlay: Overlay;
  /** Which day's snow to draw. The sheet's own snow date, so the map and the
   *  snow-depth section below it can never be pictures of different days —
   *  including when the tour is too far out for seNorge and the section falls
   *  back to today's grid, which it says on the page. */
  snowDate: string;
  /**
   * The parking lots to plant numbered signs on, in the order the sheet's own
   * Parking section numbers them — so a reader holding the paper can look up
   * sign 3 and find row 3.
   *
   * Empty when the Parking section is switched off, which is the whole of the
   * signs' own switch: a section the guide has turned off is not a section
   * whose numbers the map should be referring to. Also empty while the lots are
   * still being fetched, which nobody sees on paper because the dialog holds
   * Print until they land.
   *
   * Must be referentially stable between renders that did not change it; the
   * caller memoises it.
   */
  parking: readonly LatLng[];
  /** Flat and north-up, or the planner's tilted terrain view. One frame, one
   *  canvas, either way — the page does not change shape around the choice. */
  view: MapView;
  onReady?: () => void;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  // What was asked for, as one value. A browser with no WebGL, or one that
  // will not hand back the frame it drew, falls through to the flat map — and
  // records *which request* failed, so that flipping a switch is a fresh ask
  // rather than a permanently disappointed one. Nothing here is set from an
  // effect body: the request is derived, and the disappointment arrives from a
  // promise.
  const request = `${view}:${overlay}`;
  const [failed, setFailed] = useState<string | null>(null);
  const terrain = view === '3d' && failed !== request;
  // What is actually in the frame. The north mark follows this rather than the
  // request, because a compass turned to a camera angle that was never used
  // would be the one thing on the sheet that is wrong rather than missing.
  const drawn: MapView = terrain ? '3d' : '2d';
  // Which way the terrain view is facing, as the guide turns it.
  const [bearing, setBearing] = useState(TERRAIN_BEARING);

  // How close the flat map is drawn, and where it is pointed. Starts at the
  // fit — the whole tour — and is dropped back there whenever the route
  // changes: a framing is composed for one route, and a zoom that put the
  // crux of Skåla in the middle of the frame means nothing on the next tour.
  // The 3D view keeps its own, for the same reason and in its own terms; see
  // mapFraming.ts.
  const [framing, setFraming] = useState<Framing>(FIT);
  // Dropped during render rather than from an effect, which is React's own
  // advice for state that has to follow a prop: an effect would render the new
  // route once through the old route's framing, and that first render is the
  // one that fires off a screenful of tile requests for a frame nobody asked
  // for.
  const [framedRoute, setFramedRoute] = useState(route);
  if (route !== framedRoute) {
    setFramedRoute(route);
    setFraming(FIT);
  }

  // The pan gesture, for the flat map. Both maps are moved by dragging them,
  // but the terrain view catches its own drags in the live GL frame sitting
  // over this one, and moves a camera rather than a Framing — see
  // TerrainPicture. What the two share is the reach, not the plumbing.
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useWheelZoom(
    frameRef,
    useCallback(
      (delta: number, anchor: { x: number; y: number }) => {
        // The terrain view is a different camera with a different idea of
        // closer, and it hears the same wheel for itself through the live map
        // sitting over this frame. Swallowing the event here regardless is the
        // point of listening at all in that case: whichever map is on show, a
        // wheel aimed at it must not scroll the sheet out from under it.
        if (terrain) return;
        // Zoom about the pointer, because a map that zooms away from the thing
        // being pointed at has to be chased across the frame afterwards.
        setFraming((f) => zoomBy(f, delta, anchor));
      },
      [terrain],
    ),
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (terrain) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const from = dragRef.current;
    if (!from) return;
    // Measured against the frame on screen rather than the drawing behind it:
    // the canvas is rendered several times the size it is shown at, so a
    // gesture counted in its pixels would move the map by a fraction of what
    // the pointer did.
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dx = (e.clientX - from.x) / box.width;
    const dy = (e.clientY - from.y) / box.height;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setFraming((f) => panBy(f, dx, dy));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Held in a ref so a caller passing a fresh closure each render can't
  // restart the (network-bound) tile fetch. Synced in its own effect, which
  // runs before the render effect below.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  const ready = useCallback(() => onReadyRef.current?.(), []);
  const fallBack = useCallback(() => setFailed(request), [request]);

  useEffect(() => {
    const canvas = canvasRef.current;
    // The terrain view paints this same canvas itself, from its own live map.
    if (!canvas || terrain) return;
    let cancelled = false;
    void renderStaticMap(canvas, {
      route,
      width: MAP_W,
      height: MAP_H,
      scale: MAP_SCALE,
      padding: 0.1,
      // The whole tour until the guide says otherwise. A redraw only paints
      // once every tile has settled, so the canvas keeps the last finished
      // picture while a new framing loads — which is also why nothing has to
      // hold Print during a zoom: what is on screen is what is on the canvas
      // is what goes on paper, at every moment in between.
      framing,
      overlay,
      snowDate,
      // No weights passed, so the renderer's defaults apply — and those are
      // the planner's own line and halo. MAP_W is within a hair of the width
      // the planner map occupies on screen, so the same numbers put the
      // printed line at the same proportion of the frame as the line the
      // route was drawn with. The sheet used to ask for 9 and 17 here, which
      // is why the export came out as a blunter drawing of the same tour.
      endpoints: true,
      parking,
      scaleBar: true,
      cancelled: () => cancelled,
    })
      .catch(() => {
        // Tiles unavailable (offline, no coverage): the neutral backdrop and
        // the traced route still print, which beats an empty frame. Still
        // "ready" — waiting longer would not produce a better page.
      })
      .then(() => {
        if (!cancelled) onReadyRef.current?.();
      });
    return () => {
      cancelled = true;
    };
    // `parking` is a dependency because a redraw is exactly what a new list of
    // lots needs — unlike the terrain map next door, the flat map has no way to
    // move five signs without repainting the tiles under them. It costs a
    // redraw when the lots land, which is the same redraw a nudge of the
    // framing costs and happens once per fetch.
  }, [route, overlay, snowDate, terrain, framing, parking]);

  return (
    <div
      ref={frameRef}
      className={`briefingMapFrame ${terrain ? '' : 'briefingMapDraggable'}`}
      // The flat map is aimed from the keyboard as well as with a pointer, the
      // same way the terrain view is. Only when it is the one on show: in 3D
      // the live map above carries the focus and the arrow keys turn it.
      tabIndex={terrain ? undefined : 0}
      role={terrain ? undefined : 'group'}
      aria-label={
        terrain
          ? undefined
          : t(
              'Flytt kartet: dra det eller bruk piltastene. Zoom med rullehjulet eller + og −',
              'Move the map: drag it or use the arrow keys. Zoom with the wheel or + and −',
            )
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(e) => {
        if (terrain) return;
        // A press moves an eighth of a frame, or half a zoom level — the same
        // step the buttons take, so the two ways of asking agree.
        const pans: Record<string, [number, number]> = {
          ArrowLeft: [KEY_PAN, 0],
          ArrowRight: [-KEY_PAN, 0],
          ArrowUp: [0, KEY_PAN],
          ArrowDown: [0, -KEY_PAN],
        };
        const pan = pans[e.key];
        if (pan) {
          e.preventDefault();
          setFraming((f) => panBy(f, pan[0], pan[1]));
          return;
        }
        const zooms: Record<string, number> = {
          '+': ZOOM_STEP,
          '=': ZOOM_STEP,
          '-': -ZOOM_STEP,
          _: -ZOOM_STEP,
        };
        const step = zooms[e.key];
        if (step === undefined) return;
        e.preventDefault();
        setFraming((f) => zoomBy(f, step));
      }}
    >
      {/* The picture that prints, in both cases: the flat renderer draws
          straight onto it, and the terrain view copies its live frame onto it
          whenever the camera comes to rest. */}
      <canvas
        ref={canvasRef}
        className="briefingMapCanvas"
        role="img"
        aria-label={mapLabel(t, drawn, overlay, parking.length)}
      />
      {/* On top of it on screen, and gone by the time anything is printed: the
          live map the guide turns. */}
      {terrain && (
        <TerrainPicture
          route={route}
          overlay={overlay}
          snowDate={snowDate}
          parking={parking}
          width={MAP_W}
          height={MAP_H}
          scale={MAP_SCALE}
          canvasRef={canvasRef}
          onReady={ready}
          onFailed={fallBack}
          onBearing={setBearing}
        />
      )}
      {/* The flat map's own controls, and the note that says the map can be
          moved at all — a map that can be is indistinguishable from one that
          cannot. The terrain view brings its own pair, positioned the same
          way, because the way back means something different there. Both are
          screen-only: see the print rules in briefing.css, which is the single
          thing keeping a button off the paper. */}
      {!terrain && (
        <>
          <p className="briefingMapHint briefingMapHintTop" aria-hidden>
            {t(
              'Dra for å flytte · rull for å zoome · skrives ut slik det vises',
              'Drag to move · scroll to zoom · prints as shown',
            )}
          </p>
          <MapZoomControls
            zoom={framing.zoom}
            onZoom={(delta) => setFraming((f) => zoomBy(f, delta))}
            // A press on a button must not also be the beginning of a drag on
            // the map behind it, which would slide the map on the way to
            // zooming it.
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="briefingMapFit"
              disabled={isFit(framing)}
              onClick={() => setFraming(FIT)}
            >
              {t('Vis hele ruta', 'Fit the route')}
            </button>
          </MapZoomControls>
        </>
      )}
      {/* North, turned by the camera's bearing. The flat map is north-up and
          the mark points straight up; the terrain view can be facing anywhere
          the guide has turned it to, and the mark turns with it — on paper it
          is the only thing left saying which way the mountain is seen from. */}
      <div
        className="briefingNorth"
        style={drawn === '3d' ? { transform: `rotate(${-bearing}deg)` } : undefined}
        aria-hidden
      >
        ↑N
      </div>
    </div>
  );
}

/** What the map is, for a reader who cannot see it. Spelled out per case
 *  rather than assembled from fragments, because the two languages do not
 *  agree on where the clauses go.
 *
 *  `signs` is how many numbered parking signs are on it. Added as a sentence of
 *  its own rather than as another clause, and so as another dozen spelled-out
 *  cases: a separate sentence is a place where the two languages cannot
 *  disagree about order. It is worth saying at all because the numbers are a
 *  cross-reference — a reader who is told the list has five lots but not that
 *  the map is marked with the same five has no reason to look. */
function mapLabel(
  t: Translate,
  view: MapView,
  overlay: Overlay,
  signs: number,
): string {
  const map = baseMapLabel(t, view, overlay);
  if (signs === 0) return map;
  return `${map}. ${t(
    `Med ${signs} nummererte parkeringsskilt, nummerert som i parkeringslista`,
    `With ${signs} numbered parking signs, numbered as in the parking list`,
  )}`;
}

function baseMapLabel(t: Translate, view: MapView, overlay: Overlay): string {
  if (view === '3d') {
    if (overlay === 'steepness') {
      return t(
        'Terrengkart i 3D over ruta med bratthetslag',
        '3D terrain map of the route with steepness overlay',
      );
    }
    if (overlay === 'snowdepth') {
      return t(
        'Terrengkart i 3D over ruta med snødybdelag',
        '3D terrain map of the route with snow depth overlay',
      );
    }
    return t('Terrengkart i 3D over ruta', '3D terrain map of the route');
  }
  if (overlay === 'steepness') {
    return t(
      'Kart over ruta med bratthetslag, nord opp',
      'Route map with steepness overlay, north up',
    );
  }
  if (overlay === 'snowdepth') {
    return t(
      'Kart over ruta med snødybdelag, nord opp',
      'Route map with snow depth overlay, north up',
    );
  }
  return t('Kart over ruta, nord opp', 'Route map, north up');
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="briefingFact">
      <span className="briefingFactLabel">{label}</span>
      <span className="briefingFactValue">{value}</span>
    </div>
  );
}

function PrintRose({ expositions }: { expositions: string }) {
  return (
    <svg viewBox="0 0 26 26" width="26" height="26" className="briefingRose" aria-hidden>
      {DIRS.map((_, i) => (
        <path
          key={i}
          d={roseSectorPath(i, 13, 11)}
          className={
            expositions[i] === '1' ? 'briefingRoseOn' : 'briefingRoseOff'
          }
        />
      ))}
      <circle cx={13} cy={13} r={11} className="briefingRoseRing" fill="none" />
    </svg>
  );
}

export function BriefingSheet({ data }: { data: BriefingData }) {
  const t = useT();
  const {
    routeName,
    routeDescription,
    date,
    route,
    profile,
    options,
    avalancheLevel,
    avalancheRegions,
    avalancheLoading,
    avalancheFetchedAt,
    weatherLow,
    weatherHigh,
    weatherLoading,
    weatherDate,
    snow,
    snowLoading,
    snowDate,
    snowIsFallback,
    parking,
    parkingLoading,
    parkingRadiusM,
    onMapReady,
  } = data;

  const terrain = summariseTerrain(profile);
  const stats = profile.stats;
  const badge = DANGER_LEVELS[avalancheLevel];
  // The route can cross several forecast regions; the headline describes the
  // worst one, and any others are named underneath so nothing is hidden.
  const lead = avalancheRegions[0] ?? null;
  const otherRegions = avalancheRegions.slice(1);
  const rows = options.weather ? weatherRows(weatherLow, weatherHigh) : [];
  const showLow = rows.some((r) => r.low);
  const showHigh = rows.some((r) => r.high);
  // Four columns per anchor, in the weather panel's order — sky, temperature,
  // precipitation, wind — and either anchor can be absent. The widths are stated
  // as weights and normalised here, so one anchor's group takes half the table
  // and two take a quarter each, while the shape of a group never changes.
  const anchorCount = (showLow ? 1 : 0) + (showHigh ? 1 : 0);
  const colPct = (weight: number) =>
    (weight * (100 - TIME_COL_PCT)) / (ANCHOR_WEIGHT * Math.max(anchorCount, 1));
  const anchorCols = [
    COL_WEIGHTS.sky,
    COL_WEIGHTS.temp,
    COL_WEIGHTS.precip,
    COL_WEIGHTS.wind,
  ];
  const snowSummary = options.snow ? summariseSnow(profile, snow) : null;
  // The lots for the map, from the same array in the same order as the numbered
  // rows below — so the badge on a sign and the row a reader looks it up in are
  // the same number by construction rather than by two files agreeing.
  //
  // Tied to the Parking switch and nothing else: the signs' numbers only mean
  // anything next to the list that explains them, so a sheet without the list
  // is a sheet without the signs. That is also why there is no switch of their
  // own in the dialog.
  //
  // Memoised because both maps take this as a prop and both treat a new array
  // as a change: the flat one repaints and the terrain one resets a source, and
  // a fresh `[]` on every render of this sheet would mean doing that forever.
  const parkingPoints = useMemo<readonly LatLng[]>(
    () => (options.parking ? parking.map((p) => p.point) : []),
    [options.parking, parking],
  );
  // Credit only the sources that actually contributed to this print: a footer
  // citing Varsom on a sheet with no avalanche section is a small lie.
  const credits = [
    // Kartverket is credited on every sheet, with or without the map: the
    // ascent and the high point in the facts panel are its elevations, and
    // those print whatever else is switched off.
    `${options.map ? t('Kart og høyder', 'Map and elevations') : t('Høyder', 'Elevations')} © Kartverket (CC BY 4.0)`,
    // The relief is a second dataset, and only the 3D sheet is standing on it.
    // /terrain-dem serves Kartverket NDH-derived tiles from R2 with an AWS
    // Terrarium fallback (worker/terrain.js), so both are named — the same
    // pair the planner's own attribution bar credits in 3D.
    options.map && options.map3d
      ? `${t('Terreng', 'Terrain')} © Kartverket (CC BY 4.0) / Mapzen, AWS Open Data`
      : null,
    // Two ways each of these can reach the page now that the map has an
    // overlay of its own: as the section that names the numbers, or as the
    // layer draped over the picture. Either is a use of the data and so needs
    // its credit, and a sheet whose only NVE content is an orange map would
    // otherwise print without naming NVE at all.
    options.steepness || (options.map && options.mapOverlay === 'steepness')
      ? `${t('Bratthet og utløp', 'Steepness and runout')} © NVE`
      : null,
    options.avalanche
      ? `${t('Snøskredvarsel', 'Avalanche forecast')} © NVE / Varsom (NLOD)`
      : null,
    options.snow || (options.map && options.mapOverlay === 'snowdepth')
      ? `${t('Snødybde', 'Snow depth')} © NVE / seNorge`
      : null,
    options.weather ? `${t('Vær', 'Weather')} © MET Norway (CC BY 4.0)` : null,
    // Credited whenever the section printed, including when it printed empty:
    // "nothing mapped within 2 km" is itself a statement sourced from OSM, and
    // the reader is entitled to know whose map said so. This credit is also
    // the one that is not optional — the printed sheet is an ODbL Produced
    // Work, and §4.3 wants the notice on it.
    options.parking
      ? `${t('Parkering', 'Parking')} © OpenStreetMap ${t('bidragsytere', 'contributors')} (ODbL)`
      : null,
  ].filter(Boolean);

  return (
    <div className="briefingSheet">
      {/* The day is not stated once at the top: each forecast carries the date
          it actually describes, which is the only place the reader can act on
          it and the only way a weather day and a bulletin's retrieval time can
          honestly differ. */}
      <header className="briefingHeader">
        <div>
          <h1 className="briefingTitle">{routeName}</h1>
        </div>
        <div className="briefingBrand">
          <div className="briefingBrandName">Fjellrute</div>
        </div>
      </header>

      {/* The route's own numbers are not a section: they are what makes the
          sheet this tour. With the map switched off they widen into a row
          rather than leaving a column-shaped hole where it was. */}
      <section
        className={`briefingTop briefingSection ${options.map ? '' : 'briefingTopNoMap'}`}
      >
        {options.map && (
          <MapPicture
            route={route}
            overlay={options.mapOverlay}
            snowDate={snowDate}
            parking={parkingPoints}
            view={options.map3d ? '3d' : '2d'}
            onReady={onMapReady}
          />
        )}
        <div className="briefingFacts">
          <Fact label={t('Lengde', 'Distance')} value={km(stats.distance)} />
          <Fact label={t('Stigning', 'Ascent')} value={metres(stats.ascent)} />
          <Fact label={t('Fall', 'Descent')} value={metres(stats.descent)} />
          <Fact
            label={t('Høyeste punkt', 'High point')}
            value={metres(stats.maxElevation)}
          />
          <Fact
            label={t('Laveste punkt', 'Low point')}
            value={metres(stats.minElevation)}
          />
          {options.steepness && terrain && Number.isFinite(terrain.maxSlopeDeg) && (
            <Fact
              label={t('Bratteste parti', 'Steepest section')}
              value={`${Math.round(terrain.maxSlopeDeg)}°`}
            />
          )}
          {options.steepness && terrain && (
            <Fact
              label={t('I skredterreng (≥30°)', 'In avalanche terrain (≥30°)')}
              value={`${Math.round(terrain.steepFraction * 100)} % · ${km(terrain.steepM)}`}
            />
          )}
          {options.snow && snowSummary && (
            <Fact
              label={t('Snødybde', 'Snow depth')}
              value={`${Math.round(snowSummary.minCm)}–${Math.round(snowSummary.maxCm)} cm`}
            />
          )}
        </div>
      </section>

      {/* Danger banner — the single most important line on the page, so it
          sits directly under the map with the level's own colour. */}
      {options.avalanche && (
      <section className="briefingSection">
        {/* Dated like the weather and snow headings: the bulletin was asked for
            on the tour date, so that is the day this section speaks for. It has
            to be said out loud rather than assumed, because a bulletin is
            rewritten during the day and a saved route can be replaying one
            captured a week ago — which is what the retrieval line below is
            for. Heading answers "which day", sub-line answers "how old". */}
        <h2 className="briefingH2">
          {t('Snøskredvarsel', 'Avalanche forecast')} · Varsom · {longDate(date)}
        </h2>
        <Retrieved at={avalancheFetchedAt} />
        <div className="briefingDanger">
          {/* The avalanche panel's badge: a square tile in the level's own colour
              with the figure centred in it, from the same DANGER_LEVELS table the
              screen reads. */}
          <div
            className={`briefingDangerBadge${badge ? '' : ' briefingDangerUnrated'}`}
            style={
              badge ? { background: badge.color, color: badge.onColor } : undefined
            }
          >
            <span className="briefingDangerNum">
              {avalancheLevel > 0 ? avalancheLevel : '?'}
            </span>
          </div>
          <div className="briefingDangerBody">
            {/* The scale follows the level's name rather than sitting under the
                figure as it used to. On screen the badge is one of six in a
                legend, so what 3 is out of is visible; the sheet prints one
                badge and no legend, so the denominator is written out. */}
            <div className="briefingDangerLabel">
              {dangerLevelLabel(avalancheLevel)}
              <span className="briefingDangerScale">
                {avalancheLevel > 0
                  ? ` · ${avalancheLevel} ${t('av 5', 'of 5')}`
                  : ` · ${t('ikke vurdert', 'not rated')}`}
              </span>
            </div>
            <div className="briefingDangerRegion">
              {lead
                ? lead.regionName
                : avalancheLoading
                  ? t('Henter varsel …', 'Loading forecast…')
                  : t(
                      'Ingen vurdert skredregion langs ruta',
                      'No assessed avalanche region along the route',
                    )}
              {otherRegions.length > 0 &&
                ` · ${t('også', 'also')} ${otherRegions
                  .map((r) => `${r.regionName} (${r.dangerLevel})`)
                  .join(', ')}`}
            </div>
            {lead?.mainText && (
              <p className="briefingDangerText">{lead.mainText}</p>
            )}
          </div>
        </div>
      </section>
      )}

      {options.avalanche && lead && lead.problems.length > 0 && (
        <section className="briefingSection">
          <h2 className="briefingH2">
            {t('Skredproblemer', 'Avalanche problems')}
          </h2>
          <div className="briefingProblems">
            {lead.problems.slice(0, 4).map((p, i) => {
              const aspects = aspectList(p.expositions);
              const height = elevationText(p);
              return (
                <div className="briefingProblem" key={i}>
                  <PrintRose expositions={p.expositions} />
                  <div className="briefingProblemBody">
                    <div className="briefingProblemName">{p.typeName}</div>
                    <div className="briefingProblemMeta">
                      {[
                        aspects.length > 0
                          ? `${t('Himmelretning', 'Aspects')}: ${aspects.join(', ')}`
                          : null,
                        height,
                        p.size ? `${t('Størrelse', 'Size')} ${p.size}` : null,
                        p.sensitivity || null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Steepness is a way of drawing the profile rather than a section of
          its own: with it on, the line is coloured by slope angle and carries
          the band breakdown and runout exposure; with it off, the same line is
          drawn plain. */}
      {options.elevation && (
      <section className="briefingSection">
        <h2 className="briefingH2">
          {options.steepness
            ? t('Høydeprofil og bratthet', 'Elevation profile and steepness')
            : t('Høydeprofil', 'Elevation profile')}
          {/* Said on the page, not just chosen in the dialog. A profile drawn
              to fit a strip exaggerates the climb and every reader of a paper
              chart knows it, so the one that does not is worth naming — it is
              the difference between a picture of the tour and the tour. */}
          {options.trueScale && (
            <span className="briefingH2Note">
              {t('riktig målestokk', 'true scale')}
            </span>
          )}
        </h2>
        {/* The planner's chart card around the planner's chart. Both charts on
            the sheet get one, which is what supplies the edge now that neither
            draws an axis line of its own. */}
        <div className="briefingChartCard">
          <ProfileSvg
            profile={profile}
            steepness={options.steepness}
            runout={options.steepness}
            trueScale={options.trueScale}
          />
        </div>
        {options.steepness && terrain && !terrain.slopeUnknown && (
          <>
            <div className="briefingBands" aria-hidden>
              {terrain.bands.map((b) =>
                b.fraction > 0 ? (
                  <div
                    key={b.label}
                    className="briefingBandFill"
                    style={{
                      width: `${b.fraction * 100}%`,
                      background: b.color,
                    }}
                  />
                ) : null,
              )}
            </div>
            <div className="briefingBandKeys">
              {terrain.bands
                .filter((b) => b.fraction > 0.005)
                .map((b) => (
                  <span className="briefingBandKey" key={b.label}>
                    <span
                      className="briefingSwatch"
                      style={{ background: b.color }}
                    />
                    {b.label}
                    <span className="briefingBandVal">
                      {Math.round(b.fraction * 100)} %
                    </span>
                  </span>
                ))}
            </div>
          </>
        )}
        {options.steepness && terrain && (
          <p className="briefingTerrainNote">
            {terrain.runout.metres > 0 ? (
              <>
                <span className="briefingWarn">
                  {t('Utløpssoner', 'Runout zones')}:
                </span>{' '}
                {t(
                  `${km(terrain.runout.metres)} av ruta (${Math.round(terrain.runout.fraction * 100)} %) ligger i modellert utløpssone, verste grad: ${runoutLevelLabel(terrain.runout.worstLevel)}.`,
                  `${km(terrain.runout.metres)} of the route (${Math.round(terrain.runout.fraction * 100)} %) lies inside a modeled runout zone, worst class: ${runoutLevelLabel(terrain.runout.worstLevel)}.`,
                )}
              </>
            ) : (
              t(
                'Ingen del av ruta ligger i en modellert utløpssone.',
                'No part of the route lies inside a modeled runout zone.',
              )
            )}
            {terrain.runout.incomplete &&
              ' ' +
                t(
                  'Utløpsdata manglet for deler av ruta — tallet er et minimum.',
                  'Runout data was missing for part of the route — treat this as a minimum.',
                )}
          </p>
        )}
      </section>
      )}

      {options.snow && (
        <section className="briefingSection">
          <h2 className="briefingH2">
            {t('Snødybde', 'Snow depth')} · seNorge · {longDate(snowDate)}
          </h2>
          <Retrieved at={snow?.fetchedAt} />
          {snowSummary ? (
            <>
              <div className="briefingChartCard">
                <SnowSvg profile={profile} snow={snow} />
              </div>
              <p className="briefingTerrainNote">
                {t(
                  `Modellert snødybde ${Math.round(snowSummary.minCm)}–${Math.round(snowSummary.maxCm)} cm langs ruta, i snitt ${Math.round(snowSummary.meanCm)} cm.`,
                  `Modeled snow depth ${Math.round(snowSummary.minCm)}–${Math.round(snowSummary.maxCm)} cm along the route, averaging ${Math.round(snowSummary.meanCm)} cm.`,
                )}
                {snowSummary.atLowCm != null &&
                  snowSummary.atHighCm != null &&
                  ' ' +
                    t(
                      `Ved laveste punkt ${Math.round(snowSummary.atLowCm)} cm, ved høyeste ${Math.round(snowSummary.atHighCm)} cm.`,
                      `${Math.round(snowSummary.atLowCm)} cm at the low point, ${Math.round(snowSummary.atHighCm)} cm at the high point.`,
                    )}
                {snowSummary.coverage < 0.98 &&
                  ' ' +
                    t(
                      'Rutenettet manglet verdier for deler av ruta.',
                      'The grid had no value for part of the route.',
                    )}{' '}
                {snowIsFallback
                  ? t(
                      `seNorge modellerer snø som har falt, ikke snø som skal komme, så tallene er fra ${longDate(snowDate)} og ikke fra turdagen.`,
                      `seNorge models snow that has fallen, not snow to come, so these figures are from ${longDate(snowDate)} rather than the tour date.`,
                    )
                  : t(
                      'Tallene er modellerte, ikke målte — behandle dem som et utgangspunkt.',
                      'These are modeled, not measured — treat them as a starting point.',
                    )}
              </p>
            </>
          ) : (
            <p className="briefingEmpty">
              {snowLoading
                ? t('Henter snødybde …', 'Loading snow depth…')
                : t(
                    'Ingen modellert snødybde for denne ruta og datoen.',
                    'No modeled snow depth for this route and date.',
                  )}
            </p>
          )}
        </section>
      )}

      {options.weather && (
        <section className="briefingSection">
          {/* weatherDate, not the tour date: the rows are whatever day the
              weather panel was showing when the briefing was opened, and a
              heading that named a different day than the table would be worse
              than no heading at all. */}
          <h2 className="briefingH2">
            {t('Vær', 'Weather')} · MET · {longDate(weatherDate)}
          </h2>
          <Retrieved
            at={olderFetch(weatherLow.fetchedAt, weatherHigh.fetchedAt)}
          />
          {rows.length > 0 ? (
            /* The weather panel's card. A table cannot round its own outside
               corners once its borders are collapsed, and the tinted header band
               has to be clipped to those corners, so the card is this wrapper
               and the table inside it draws only its own rules. */
            <div className="briefingTableCard">
            <table className="briefingTable briefingWeatherTable">
              {/* The table is laid out fixed, so the widths have to be stated
                  here. They are computed rather than hard-coded because either
                  anchor can be missing — a summit-only sheet gets four columns,
                  not eight, and a colgroup written for eight would leave half
                  the table hanging off the paper. */}
              <colgroup>
                <col style={{ width: `${TIME_COL_PCT}%` }} />
                {Array.from({ length: anchorCount }, (_, group) =>
                  anchorCols.map((weight, i) => (
                    <col
                      key={`${group}-${i}`}
                      style={{ width: `${colPct(weight)}%` }}
                    />
                  )),
                )}
              </colgroup>
              <thead>
                {/* Two header rows: the anchors span their four columns, so the
                    valley and summit readings can be compared down the page at a
                    glance instead of on two separate tables. */}
                <tr>
                  <th rowSpan={2}>{t('Periode', 'Period')}</th>
                  {showLow && (
                    <th colSpan={4} className="briefingGroupHead">
                      {t('Laveste punkt', 'Low point')}
                      {weatherLow.elevationM != null &&
                        ` · ${metres(weatherLow.elevationM)}`}
                    </th>
                  )}
                  {showHigh && (
                    <th colSpan={4} className="briefingGroupHead">
                      {t('Høyeste punkt', 'High point')}
                      {weatherHigh.elevationM != null &&
                        ` · ${metres(weatherHigh.elevationM)}`}
                    </th>
                  )}
                </tr>
                {/* The headings carry what a footnote used to: the wind's
                    parenthesis is the gust, and the millimetres are a total for
                    the period rather than a rate per hour. Said here because a
                    heading cannot drift out of step with the column under it. */}
                <tr>
                  {Array.from({ length: anchorCount }, (_, group) => (
                    <Fragment key={group}>
                      <th className="briefingSkyHead briefingGroupStart">
                        {t('Himmel', 'Sky')}
                      </th>
                      <th className="briefingNum">°C</th>
                      <th className="briefingNum">
                        {t('mm i alt', 'mm total')}
                      </th>
                      <th className="briefingNum">
                        {t('Vind m/s (kast)', 'Wind m/s (gust)')}
                      </th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.start}>
                    <td>{r.label}</td>
                    {[
                      ...(showLow ? [r.low] : []),
                      ...(showHigh ? [r.high] : []),
                    ].map((h, group) => (
                        <Fragment key={group}>
                          <td className="briefingSkyCell briefingGroupStart">
                            <SkyCell h={h} />
                          </td>
                          <td className="briefingNum">
                            <TempCell h={h} />
                          </td>
                          <td className="briefingNum">
                            <PrecipCell h={h} />
                          </td>
                          <td className="briefingNum">
                            <WindCell h={h} />
                          </td>
                        </Fragment>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="briefingEmpty">
              {weatherLoading
                ? t('Henter værvarsel …', 'Loading forecast…')
                : t(
                    'Ingen værvarsel for denne dagen. MET varsler omtrent ti døgn fram i tid.',
                    'No forecast for this day. MET forecasts roughly ten days ahead.',
                  )}
            </p>
          )}
          {/* No footnote under the table. The rows are aggregates and the sheet
              still has to say so, but a sentence sitting under the table is the
              wrong place for it: it repeated in prose what the columns could say
              themselves, it was read last if at all, and it drifted out of step
              with the code the moment the periods changed. The two things it
              carried that a reader cannot infer — the parenthesis is a gust, the
              millimetres are a period total — are in the column headings above,
              where they sit beside the figures they qualify and cannot be
              separated from them. The period column states the rest. */}
        </section>
      )}

      {/* Where to leave the car. Last of the data sections and first in the
          day's actual order, which is not a contradiction: the sheet is read
          top to bottom the night before, and this is the part that is acted on
          before the reader has left the house.
          Compact, but no longer abridged. This was "a name, a distance and
          whether it costs anything is the whole of what a driver needs, and the
          planner's tab has the rest" — which is true of a driver who has the tab
          in front of them, and this page exists precisely for the reader who
          does not. It now shows what the tab shows, in the tab's order and under
          the tab's labels, cut only where one line will not hold it. */}
      {options.parking && (
        <section className="briefingSection">
          <h2 className="briefingH2">
            {/* Built as one run of text with its own middots, like the weather,
                snow and avalanche headings and unlike the profile's "riktig
                målestokk" — those are the sheet's four data-source headings, and
                each says the same three things in the same shape: what this is,
                who answered, and what they were asked. The radius stands where
                the others put their date, because it is the equivalent
                qualifier: it is what decides whether an empty section means
                "nothing here" or "we did not look far enough". */}
            {t('Parkering', 'Parking')} · OpenStreetMap ·{' '}
            {t(
              `innen ${formatParkingRadius(parkingRadiusM)} fra start`,
              `within ${formatParkingRadius(parkingRadiusM)} of the start`,
            )}
          </h2>
          {parkingLoading ? (
            <p className="briefingEmpty">{t('Laster …', 'Loading…')}</p>
          ) : parking.length === 0 ? (
            // Worded as a gap in the map, never as a gap in the world. OSM's
            // trailhead coverage is far better than the register's — that is
            // why the sheet moved to it — but it is volunteer-surveyed, and a
            // lot nobody has walked past with a phone is a lot nobody has
            // mapped. A sheet that printed a flat "no parking" would be lying
            // to a driver.
            <p className="briefingEmpty">
              {t(
                'Ingen parkeringsområder kartlagt i OpenStreetMap innenfor søkeradien. OpenStreetMap kartlegges av frivillige — en plass ingen har kartlagt står ikke her, så dette betyr ikke at det ikke finnes parkering.',
                'No parking areas mapped in OpenStreetMap within the search radius. OpenStreetMap is mapped by volunteers — a lot nobody has mapped will not appear, so this does not mean there is nowhere to park.',
              )}
            </p>
          ) : (
            <>
              {/* The tab's rows, printed: a numbered plate matching the sign on
                  the map, the name, the trailhead badge if a mapper set one,
                  the distance hard right, and the labelled facts. It was a
                  four-column table until the resemblance was checked against
                  the screen — the distances read down a column, which a table
                  did well, but everything else about it read as a spreadsheet
                  about the panel rather than as the panel, and the facts cell
                  had lost its labels to fit 48 mm. The columns survive as
                  fixed-width boxes in a flex row, so the plates, names and
                  distances still line up down the page. */}
              <ol className="briefingParkingList">
                {parking.map((p, i) => {
                  const { purposes } = parkingUsage(p.usage, t);
                  const facts = takeParkingFacts(
                    parkingFacts(p, t),
                    PARKING_FACT_BUDGET,
                  );
                  return (
                    <li className="briefingParkingRow" key={p.id}>
                      <span className="briefingParkingIndex">{i + 1}</span>
                      {/* Name and badge share one fixed box, as they share one
                          flex-wrapped line in the tab. They have to travel
                          together and they have to not push: the distance sits
                          immediately after, and a badge that widened this pair
                          would step the distances out of their column on
                          exactly the rows that have one. */}
                      <span className="briefingParkingLead">
                        <span className="briefingParkingName">
                          {p.name ?? t('Parkeringsområde', 'Parking area')}
                        </span>
                        {/* Why a tour planner cares that this lot exists, and
                            so the one thing here that is not an attribute. The
                            tab puts it beside the name; so does this. Untagged
                            is not the same as not a trailhead, which is why its
                            absence says nothing. */}
                        {purposes.map((purpose) => (
                          <span className="briefingParkingPurpose" key={purpose}>
                            {purpose}
                          </span>
                        ))}
                      </span>
                      {/* The tab's formatter, not a second one. A guide
                          checking the sheet against the screen is comparing two
                          renderings of one query, and "1,2 km" beside "1.2 km"
                          reads as a disagreement about the ground. */}
                      <span className="briefingParkingDist">
                        {formatParkingDistance(p.distanceM, t)}
                      </span>
                      {/* The same labelled list the tab shows, from the same
                          function, cut to what one line holds — see
                          takeParkingFacts. Labels because the sheet is read in
                          a car park by someone who was not there when it was
                          made: "Gratis · Grus · Kun for kunder" is three facts
                          in a private order, and the reader cannot tell which
                          of the eight possible fields they are looking at, nor
                          which were absent from the map versus absent from the
                          paper. */}
                      <span className="briefingParkingFacts">
                        {/* A lot where OpenStreetMap holds nothing but the
                            geometry — the normal case away from the big
                            trailheads — keeps the dash the table printed. The
                            row is a real place and the blank is a real answer,
                            but an empty stretch of line reads as a rendering
                            fault on paper, where there is no cell border left
                            to show that the space was meant. */}
                        {facts.length === 0
                          ? '—'
                          : facts.map((fact) => (
                              <span className="briefingParkingFact" key={fact.key}>
                                {/* The space is markup and not a ::after on the
                                    label, unlike the middot between facts. The
                                    middot is decoration the sheet adds; this
                                    space is part of what the row says, and a
                                    reader who selects a line out of the saved
                                    PDF should get "Maks tid 48 t" rather than
                                    "Maks tid48 t". */}
                                <span className="briefingParkingFactLabel">
                                  {fact.label}
                                </span>{' '}
                                {fact.value}
                              </span>
                            ))}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="briefingParkingNote">
                {t(
                  'Kartlagt av frivillige i OpenStreetMap; avgift og antall plasser er ikke alltid oppdatert.',
                  'Mapped by volunteers in OpenStreetMap; fees and space counts are not always current.',
                )}
              </p>
            </>
          )}
        </section>
      )}

      {/* What the guide typed into the tour's own Notes field, printed under a
          heading that says Notes — which is where a reader looks for it, and
          the reason the switch above turns itself off on a tour saved without
          any. It used to reach the page only as a subtitle under the title,
          clamped to two lines, while this box printed as bare ruled paper; a
          plan typed at the kitchen table was silently cut off at the top of the
          sheet and the section named after it came out blank.

          The ruled line survives underneath it, because the briefing is a
          working document and the decisions that matter (turnaround time, plan
          B, who carries what) are often made in the car park, after the sheet
          was printed. One line rather than two: the typed note now carries what
          the party knew in advance, so the writing space is for what changes. */}
      {options.notes && (
        <section className="briefingNotes briefingSection">
          <h2 className="briefingH2">
            {t('Notater', 'Notes')}
          </h2>
          {routeDescription && (
            <p className="briefingNotesText">{routeDescription}</p>
          )}
          <div className="briefingNoteLines" aria-hidden />
        </section>
      )}

      <footer className="briefingFooter">
        <p style={{ margin: '0 0 1mm' }}>
          <span className="briefingWarn">
            {t(
              'Sjekk alltid det nyeste varselet på varsom.no før du drar ut.',
              'Always check the latest bulletin on varsom.no before heading out.',
            )}
          </span>{' '}
          {t(
            'Dette arket er et planleggingsverktøy, ikke en garanti for trygge forhold. Terrengvurdering i felt går alltid foran.',
            'This sheet is a planning aid, not a guarantee of safe conditions. Assessment in the field always takes precedence.',
          )}
        </p>
        {/* Only credit what actually made it onto the page: an attribution for
            a source the reader cannot see is noise, and in the licences' own
            terms there is nothing to attribute. */}
        <p style={{ margin: 0 }}>
          {credits.join(' · ')} · {t('Generert', 'Generated')}{' '}
          {new Date().toLocaleString([], {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          · fjellrute.no
        </p>
      </footer>
    </div>
  );
}
