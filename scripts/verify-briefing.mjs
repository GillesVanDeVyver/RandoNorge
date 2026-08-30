// Guards the printable tour briefing.
//
// The briefing is the one part of the app that nobody can correct once it is
// wrong: it leaves as paper, in a rucksack, often without signal, and it is
// read by someone who was not there when it was made. A stale snow depth
// printed as if it were a forecast, a runout figure with no slope angles to
// read it against, or an "Infinity–-Infinity cm" where a range should be are
// all things the screen would let you notice and paper will not.
//
// It is also the hardest part of the app to eyeball, because it only exists
// once a route, a profile, three network sources and seven switches have all
// lined up. So this harness builds those inputs by hand and renders the sheet
// for real, server-side, under every combination of switches.
//
// WHAT IS CHECKED, AND WHY THESE THINGS
//
//   1. The switch dependency. Steepness is a way of drawing the elevation
//      profile, not a section of its own, so it cannot survive the profile
//      being switched off.
//   2. The summary of a model with holes in it. seNorge answers on a 1 km
//      grid and sometimes does not answer at all; the summary has to say so
//      rather than average its way past it.
//   3. That every switched-off section actually leaves. Not just its heading:
//      its data, and its attribution, since crediting a source the reader
//      cannot see is noise.
//   4. That no combination prints NaN, undefined or Infinity. The formatting
//      helpers all divide by something that can be zero on a flat or
//      single-point route.
//   5. The weather table's periods, in the two resolutions MET serves and at the
//      handover between them. Every millimetre on that table is a total for the
//      period its row is labelled with, so a row that covered longer than its
//      label says — or two rows covering the same hour — would not read as
//      coarse, it would read as a heavier or lighter forecast than MET gave.
//      The aggregation is pinned to arithmetic done by hand for the same reason:
//      states average, accumulations sum, and a gust stays a peak.
//   6. That the sheet still wears the planner's clothes. The page is a
//      re-presentation of panels the reader has already been looking at, and it
//      only works as one if the columns come in the same order, the wind cell
//      carries the same arrow and the charts are shaded the same way. None of
//      that is load-bearing for correctness, which is exactly why it rots
//      quietly: an ordinary-looking edit to the app's weather panel or to a
//      chart's fill leaves this sheet looking like a spreadsheet of the app
//      instead of the app, and nothing fails. So the resemblance is asserted —
//      both in the markup and, where the look lives in CSS rather than in the
//      DOM, in the stylesheet's text.
//
// Rendering is done by bundling the sheet with esbuild and importing it under
// react-dom/server. The bundle is written into the repo (not /tmp) so Node can
// resolve react from node_modules, and removed again afterwards.
//
// Run with:  node scripts/verify-briefing.mjs   (needs Node >= 22.18)
// Wired into `pnpm test:briefing`.

import { ensureTypeStripping } from './lib/type-stripping.mjs';
ensureTypeStripping();

import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { CORE, WEB } from './lib/tree.mjs';

// Every path below is under the web app's src/, and the server-rendering
// scratch files are written there too so that the `external: ['react', ...]`
// bundle resolves React from the one node_modules that has it. See
// lib/tree.mjs for why the tree is split this way.
const ROOT = WEB;

let failures = 0;
let checks = 0;

function ok(cond, label) {
  checks++;
  if (cond) return;
  failures++;
  console.error(`  FAIL  ${label}`);
}

function section(name) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------------------
// 1. The switch dependency
// ---------------------------------------------------------------------------

const { withDependencies, DEFAULT_OPTIONS, OPTION_KEYS } = await import(
  pathToFileURL(join(ROOT, 'src/briefing/options.ts')).href
);
const optionsSrc = readFileSync(join(ROOT, 'src/briefing/options.ts'), 'utf8');

section('Section switches');

/** The planner's three map layers, which are the sheet's three. Written out
 *  here rather than imported so that a fourth added to the app has to be added
 *  here too, deliberately, instead of slipping past a sweep that would go on
 *  claiming to cover every layer. */
const MAP_OVERLAYS = ['steepness', 'snowdepth', 'none'];

const allOn = { ...DEFAULT_OPTIONS };
ok(
  OPTION_KEYS.every((k) => typeof DEFAULT_OPTIONS[k] === 'boolean'),
  'defaults cover every option key',
);
ok(
  !OPTION_KEYS.includes('mapOverlay') &&
    MAP_OVERLAYS.includes(DEFAULT_OPTIONS.mapOverlay),
  'the map layer is a choice among the planner\'s three, not a tenth switch',
);
ok(
  withDependencies({ ...allOn, elevation: false }).steepness === false,
  'turning the elevation profile off also turns steepness off',
);
ok(
  withDependencies({ ...allOn, elevation: false }).avalanche === true &&
    withDependencies({ ...allOn, elevation: false }).snow === true,
  'the dependency reaches steepness only, not the other sections',
);
ok(
  withDependencies(allOn).steepness === true,
  'with the profile on, steepness is left alone',
);
ok(
  withDependencies({ ...allOn, map: false }).elevation === true,
  'the map carries no dependency: it can be dropped on its own',
);
ok(
  withDependencies({ ...allOn, map: false, map3d: true }).map3d === false,
  'switching the map off takes 3D with it, rather than remembering it',
);
ok(
  withDependencies({ ...allOn, map: true, map3d: true }).map3d === true,
  'with the map on, 3D is left alone',
);
ok(
  DEFAULT_OPTIONS.map3d === false,
  'the sheet defaults to the flat north-up map a party can navigate from',
);

// ---------------------------------------------------------------------------
// 2. Reading a gridded model
// ---------------------------------------------------------------------------

// packages/core rather than apps/web/src/briefing, since Phase 3: the phone's
// snow card needs the same mean-and-range, and the plan's one rule sends shared
// logic to core instead of copying it into apps/mobile. Nothing below changed
// with the import, which is the evidence that the move was a move.
const { summariseSnow, hasSnowOnRoute } = await import(
  pathToFileURL(join(CORE, 'src/snow/summary.ts')).href
);

section('Snow summary');

/** A profile of `n` points climbing linearly from `lo` to `hi` metres. */
function makeProfile(n, lo, hi, { slope = 25, runout = 0 } = {}) {
  const seg = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1);
    seg.push({
      distance: f * 4000,
      elevation: lo + (hi - lo) * f,
      lat: 61.5 + f * 0.01,
      lng: 8.5 + f * 0.01,
      slopeDeg: slope,
      runoutLevel: runout,
    });
  }
  return {
    segments: [seg],
    stats: {
      distance: 4000,
      ascent: Math.max(0, hi - lo),
      descent: 0,
      minElevation: lo,
      maxElevation: hi,
    },
    fetchedAt: Date.now(),
  };
}

const p10 = makeProfile(10, 400, 1300);

const evenSnow = summariseSnow(p10, {
  depths: [[10, 20, 30, 40, 50, 60, 70, 80, 90, 100]],
  date: '2026-02-01',
  fetchedAt: 1,
});
ok(evenSnow.minCm === 10 && evenSnow.maxCm === 100, 'range spans the route');
ok(evenSnow.meanCm === 55, 'mean is the mean');
ok(evenSnow.coverage === 1, 'full coverage when the grid answered everywhere');
ok(
  evenSnow.atLowCm === 10 && evenSnow.atHighCm === 100,
  'low/high readings are taken at the route\u2019s lowest and highest points, not its ends',
);

// Same depths, but the route descends: the low-point reading must follow
// elevation rather than position in the array.
const descending = makeProfile(10, 1300, 400);
const desc = summariseSnow(descending, {
  depths: [[10, 20, 30, 40, 50, 60, 70, 80, 90, 100]],
  date: '2026-02-01',
  fetchedAt: 1,
});
ok(
  desc.atLowCm === 100 && desc.atHighCm === 10,
  'on a descending route the low-point depth is the one at the low end',
);

const holes = summariseSnow(p10, {
  depths: [[10, NaN, NaN, NaN, NaN, 60, 70, 80, 90, 100]],
  date: '2026-02-01',
  fetchedAt: 1,
});
ok(Math.abs(holes.coverage - 0.6) < 1e-9, 'coverage reports the grid\u2019s holes');
ok(
  holes.minCm === 10 && holes.maxCm === 100,
  'missing cells are skipped, not read as zero depth',
);

ok(
  summariseSnow(p10, {
    depths: [[NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN]],
    date: '2026-02-01',
    fetchedAt: 1,
  }) === null,
  'a route entirely outside the grid summarises to nothing, not to \u00b1Infinity',
);
ok(summariseSnow(p10, null) === null, 'no snow data summarises to nothing');
ok(
  summariseSnow(p10, { depths: [[1, 2, 3]], date: '2026-02-01', fetchedAt: 1 }) ===
    null,
  'depths that do not match the profile are refused rather than zipped',
);

// Whether there is a snowpack to print at all. The briefing's snow switch
// defaults off when there is not, so this predicate decides whether a section
// appears on a sheet nobody re-reads — and it has to say "no snow" for the two
// different ways seNorge can report none.
const snowOf = (depths) =>
  summariseSnow(p10, { depths: [depths], date: '2026-02-01', fetchedAt: 1 });
const bare = new Array(10).fill(0);
ok(
  hasSnowOnRoute(snowOf(bare)) === false,
  'a route the model puts at 0 cm end to end counts as having no snow',
);
ok(
  hasSnowOnRoute(null) === false,
  'a route the grid answered for nowhere counts as having no snow',
);
ok(
  hasSnowOnRoute(snowOf([...bare.slice(0, 9), 4])) === true,
  'four centimetres at one point on the route is still snow, and prints',
);
// The distinction the switch turns on: bare ground reads 0, and a point the
// model has nothing for reads NaN. Neither is snow, and a route made of both
// must not summarise its way into looking like one that has some.
ok(
  hasSnowOnRoute(snowOf([0, NaN, 0, NaN, 0, NaN, 0, NaN, 0, NaN])) === false,
  'zeroes mixed with holes in the grid still add up to no snow',
);
ok(
  hasSnowOnRoute(snowOf([NaN, NaN, NaN, NaN, 12, NaN, NaN, NaN, NaN, NaN])) ===
    true,
  'one modelled reading in a route of holes is enough to keep the section',
);

// ---------------------------------------------------------------------------
// 3 & 4. The rendered sheet
// ---------------------------------------------------------------------------

section('Rendered sheet');

const ENTRY = join(ROOT, '.briefing-ssr-entry.jsx');
const BUNDLE = join(ROOT, '.briefing-ssr.mjs');

writeFileSync(
  ENTRY,
  `import { renderToStaticMarkup } from 'react-dom/server';
import { BriefingSheet } from './src/briefing/BriefingSheet';
export function render(data) {
  return renderToStaticMarkup(<BriefingSheet data={data} />);
}
`,
);

const esbuild = await import('esbuild');
await esbuild.build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: BUNDLE,
  // React comes from node_modules at run time; the CSS is a print concern and
  // has no bearing on the markup. MapLibre is external for a different reason:
  // the 3D capture reaches it through a dynamic import that server rendering
  // never evaluates, and bundling a megabyte of WebGL into this harness — where
  // it would try to touch `window` at module scope — buys nothing.
  external: ['react', 'react-dom', 'react-dom/server', 'maplibre-gl'],
  loader: { '.css': 'empty' },
  logLevel: 'silent',
  jsx: 'automatic',
});

const { render } = await import(pathToFileURL(BUNDLE).href);

/** A full local day of hourly forecast for 14 March 2026, minus any hours in
 *  `skip`. Local, because the sheet slices the day in local time — the same
 *  rule the on-screen weather panel uses, and the reason a UTC fixture would
 *  quietly test a different set of hours in a different timezone. */
function hours({ skip = [] } = {}) {
  const out = [];
  for (let h = 0; h < 24; h++) {
    if (skip.includes(h)) continue;
    out.push({
      time: new Date(2026, 2, 14, h, 0, 0).toISOString(),
      temperature: -4 + h * 0.5,
      windSpeed: 6 + h,
      windGust: h % 2 === 0 ? 11 + h : null,
      windFromDeg: 315,
      symbolCode: 'partlycloudy_day',
      precipMm: h % 3 === 0 ? 0.4 : 0,
      precipMinMm: null,
      precipMaxMm: null,
      // What MET publishes inside its hourly window: each figure covers the one
      // hour it is stamped with.
      precipHours: 1,
    });
  }
  return out;
}

/** What MET actually serves past its hourly window: entries every six hours,
 *  stamped at 00/06/12/18 **UTC**, each carrying a six-hour total rather than an
 *  hourly one. Built in UTC on purpose — the point of this fixture is that those
 *  instants fall on odd *local* hours (01/07/13/19 in Norwegian winter,
 *  02/08/14/20 in summer), which is what defeated the old three-hourly thinning.
 *  Only the entries that land inside 14 March locally are kept, because that
 *  day-slicing is the dialog's job and has already happened by the time the
 *  sheet sees them.
 *
 *  Because the local hours depend on the machine's timezone, every assertion
 *  made against this fixture has to be about the shape of the table — how many
 *  rows, how long each covers — and never about a particular label. */
function sixHourlyUTC() {
  const out = [];
  // Swept a full day either side of the target rather than a few hours, so the
  // local day is covered whatever the offset. A narrower sweep silently loses
  // the first block at large positive offsets — which is a fixture bug that
  // looks exactly like a code bug.
  for (let h = -24; h <= 48; h += 6) {
    const at = new Date(Date.UTC(2026, 2, 14, h, 0, 0));
    if (at.getDate() !== 14) continue; // local day, matching hoursOnDate
    out.push({
      time: at.toISOString(),
      temperature: -3 + h * 0.2,
      windSpeed: 8,
      windGust: 14,
      windFromDeg: 290,
      symbolCode: 'cloudy',
      precipMm: 1.2,
      precipMinMm: 0.4,
      precipMaxMm: 2.6,
      // The whole point of the fixture: these millimetres are six hours' worth.
      // A row that printed them under a three-hour heading would be overstating
      // the rate fourfold, so the window travels with the number.
      precipHours: 6,
    });
  }
  return out;
}

/** Three local hours, 12:00–14:00 — exactly the 12–15 period and nothing else,
 *  so a row can be checked against arithmetic done by hand. Every field is given
 *  per hour; the defaults are flat, so a test only has to state the one series
 *  it cares about.
 *
 *  `precipHours` is deliberately left off, which is what a forecast snapshot
 *  captured before that field existed looks like when it is replayed. Those
 *  entries were always hourly, so the sheet has to read a missing window as one
 *  hour — and every row built from this fixture proves it does. */
function block1215({
  temps = [0, 0, 0],
  speeds = [5, 5, 5],
  gusts = [null, null, null],
  degs = [180, 180, 180],
  precip = [0, 0, 0],
  symbols = ['cloudy', 'cloudy', 'cloudy'],
} = {}) {
  return temps.map((_, i) => ({
    time: new Date(2026, 2, 14, 12 + i, 0, 0).toISOString(),
    temperature: temps[i],
    windSpeed: speeds[i],
    windGust: gusts[i],
    windFromDeg: degs[i],
    symbolCode: symbols[i],
    precipMm: precip[i],
    precipMinMm: null,
    precipMaxMm: null,
  }));
}

/** The day after tomorrow, as MET actually hands it over: hourly entries from
 *  06:00 up to and including `hourlyUntil`, then a single six-hour block stamped
 *  at `coarseAt`. Local time, because what is under test here is the row grid
 *  rather than timezone arithmetic — `sixHourlyUTC` covers that.
 *
 *  This is the case the sheet gets wrong most easily: the two resolutions have
 *  to coexist on one table without a six-hour total ever being printed under a
 *  three-hour heading, and without the grid laying a row across the block. */
function mixedDay({ hourlyUntil = 17, coarseAt = 18 } = {}) {
  const out = [];
  for (let h = 6; h <= hourlyUntil; h++) {
    out.push({
      time: new Date(2026, 2, 14, h, 0, 0).toISOString(),
      temperature: -2,
      windSpeed: 5,
      windGust: null,
      windFromDeg: 180,
      symbolCode: 'fair_day',
      precipMm: 1,
      precipMinMm: null,
      precipMaxMm: null,
      precipHours: 1,
    });
  }
  out.push({
    time: new Date(2026, 2, 14, coarseAt, 0, 0).toISOString(),
    temperature: -6,
    windSpeed: 12,
    windGust: 20,
    windFromDeg: 180,
    symbolCode: 'snow',
    precipMm: 9,
    precipMinMm: null,
    precipMaxMm: null,
    precipHours: 6,
  });
  return out;
}

const warning = {
  regionId: 3029,
  regionName: 'Indre Fjordane',
  dangerLevel: 3,
  mainText: 'Vedvarende svakt lag i snødekket.',
  problems: [
    {
      typeId: 30,
      typeName: 'Vedvarende svakt lag',
      cause: 'Kantkornet snø over skarelag',
      probability: 'Mulig',
      sensitivity: 'Lett å løse ut',
      size: '2 - Middels',
      distribution: 'Noen bratte heng',
      summary: 'Vær varsom i leheng.',
      expositions: '11100001',
      exposedHeight1: 700,
      exposedHeight2: 0,
      exposedHeightFill: 1,
    },
  ],
  fetchedAt: Date.now(),
};

const profile = makeProfile(24, 420, 1480, { slope: 34, runout: 2 });

// Fixed moments, so the retrieval lines the sheet prints are something the
// harness can actually look for. Each source gets its own minute, which is
// also how a heading that quoted the wrong source's clock would be caught.
const FETCHED_AT = new Date(2026, 2, 13, 18, 20, 0).getTime(); // Varsom
const SNOW_FETCHED_AT = new Date(2026, 2, 14, 5, 41, 0).getTime(); // seNorge
const LOW_FETCHED_AT = new Date(2026, 2, 14, 7, 32, 0).getTime(); // MET, older
const HIGH_FETCHED_AT = new Date(2026, 2, 14, 9, 53, 0).getTime(); // MET, newer
const PARKING_FETCHED_AT = new Date(2026, 2, 14, 6, 14, 0).getTime(); // OpenStreetMap

/** Three mapped lots near the start, of the three kinds the extract actually
 *  holds: one fully described, one with a name and nothing else, and one with
 *  no name at all. The middle and last are not padding — an OpenStreetMap
 *  feature whose only populated tag is amenity=parking is the normal case
 *  outside the big trailheads, and both of them are how the sheet comes to
 *  print "undefined" or an empty facts cell if the fallbacks are ever dropped.
 *
 *  Ids are spelled the way scripts/parking/build_parking_extract.py writes
 *  them, `<node|way>/<osm id>`, because that string is what the sheet's React
 *  keys are built from and a change in its shape should be visible here.
 *
 *  The first lot carries `payment` and not `winter`: NVDB's ploughing
 *  attribute has no OpenStreetMap equivalent and was dropped with the register
 *  (see src/briefing/BriefingSheet.tsx). A fixture still setting `winter`
 *  would be asserting on a field the type no longer has.
 *
 *  Values are raw OpenStreetMap tags — `gravel`, `customers`, `app,credit_cards`
 *  — and not the Norwegian the sheet prints. That is the point of them. NVDB
 *  answered in prose and the sheet could print the field straight through; OSM
 *  answers in machine tags, so between the row and the paper there is now
 *  src/parking/format.ts, and a fixture pre-spelling `surface: 'Grus'` would
 *  assert that the sheet can print a string while proving nothing about the
 *  translation that has to happen first. Written as the build script writes
 *  them, comma-joined with no space, so the splitting is exercised too. */
const parkingAreas = [
  {
    id: 'way/78012345',
    source: 'osm',
    point: [61.8712, 6.8564],
    distanceM: 240,
    name: 'Tj\u00f8rnadalen parkering',
    capacity: 40,
    fee: '75 NOK',
    surface: 'gravel',
    access: 'customers',
    operator: 'Stryn kommune',
    usage: 'hiking',
    payment: 'app,credit_cards',
    maxstay: '48 t',
    fetchedAt: PARKING_FETCHED_AT,
  },
  {
    id: 'way/78012346',
    source: 'osm',
    point: [61.8688, 6.8611],
    distanceM: 1240,
    name: 'Loen sentrum',
    capacity: null,
    fee: null,
    surface: null,
    access: null,
    operator: null,
    usage: null,
    payment: null,
    maxstay: null,
    fetchedAt: PARKING_FETCHED_AT,
  },
  {
    id: 'node/78012347',
    source: 'osm',
    point: [61.8601, 6.8702],
    distanceM: 1980,
    name: null,
    capacity: 6,
    // `fee=no` is the single most common value in the extract and `access=yes`
    // the second: one has to become a word, the other has to disappear.
    fee: 'no',
    surface: 'asphalt',
    access: 'yes',
    operator: null,
    usage: null,
    payment: null,
    maxstay: null,
    fetchedAt: PARKING_FETCHED_AT,
  },
];

function makeData(options, over = {}) {
  return {
    routeName: 'Skåla frå Loen',
    routeDescription: 'Klassisk vårtur, tidleg start.',
    date: '2026-03-14',
    route: [profile.segments[0].map((p) => ({ lat: p.lat, lng: p.lng }))],
    profile,
    options,
    avalancheLevel: 3,
    avalancheRegions: [warning],
    avalancheLoading: false,
    avalancheFetchedAt: FETCHED_AT,
    weatherLow: {
      elevationM: 420,
      hours: hours(),
      fetchedAt: LOW_FETCHED_AT,
    },
    weatherHigh: {
      elevationM: 1480,
      hours: hours(),
      fetchedAt: HIGH_FETCHED_AT,
    },
    weatherLoading: false,
    weatherDate: '2026-03-14',
    snow: {
      depths: [profile.segments[0].map((_, i) => 30 + i * 6)],
      date: '2026-03-14',
      fetchedAt: SNOW_FETCHED_AT,
    },
    snowLoading: false,
    snowDate: '2026-03-14',
    snowIsFallback: false,
    parking: parkingAreas,
    parkingLoading: false,
    parkingRadiusM: 2000,
    ...over,
  };
}

/** Every combination of the switches, with the dependencies applied — fewer
 *  distinct than nominal, and all of them reachable by clicking. Counted from
 *  OPTION_KEYS rather than written down, so adding a switch extends the sweep
 *  instead of silently leaving half of it untested. */
const combos = [];
for (let mask = 0; mask < 2 ** OPTION_KEYS.length; mask++) {
  const raw = {};
  OPTION_KEYS.forEach((k, i) => {
    raw[k] = Boolean(mask & (1 << i));
  });
  // The map layer is rotated through the sweep rather than multiplied into it.
  // Three layers times every switch would be three times the renders for a
  // choice that changes which tiles are fetched and one aria-label — and since
  // 3 and 512 share no factor, every layer still meets every switch combination
  // often enough that a section which crashed on one of them could not hide.
  raw.mapOverlay = MAP_OVERLAYS[mask % MAP_OVERLAYS.length];
  combos.push(withDependencies(raw));
}

const BAD = ['NaN', 'undefined', 'Infinity', 'null cm', '[object Object]'];

/** React splices `<!-- -->` between adjacent text expressions. A reader sees
 *  one continuous line, so the harness should read one too — otherwise a
 *  heading like "Weather · MET · Sat 14 March 2026" is unmatchable. */
const plain = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/** The page as a reader sees it: comments gone and tags removed too.
 *
 *  For assertions about a phrase that the markup splits across elements, which
 *  is most of them once a value gets a styled label in front of it. `plain`
 *  above only removes comments, despite the name — it was written when a fact
 *  on this sheet was one text node, and an assertion looking for "Plasser 40"
 *  against its output is really looking for "Plasser</span> 40" and silently
 *  fails. Not a drop-in replacement for it: several checks below are about the
 *  markup and need the tags kept. */
const textOf = (html) => plain(html).replace(/<[^>]*>/g, '');

/** The text of every "Retrieved …" sub-line on the page. Reading them out of
 *  their own element, rather than out of the page as a whole, is what proves
 *  they sit under the headings instead of inside them. */
const retrievedLines = (html) =>
  [...plain(html).matchAll(/<p class="briefingRetrieved">([^<]*)<\/p>/g)].map(
    (m) => m[1],
  );

/** The declared width of every column in the weather table, as a number of
 *  percent. Under `table-layout: fixed` these widths are the whole story, so
 *  they are worth checking as numbers rather than trusting the markup. */
const colWidths = (html) =>
  [...html.matchAll(/<col style="width:([\d.]+)%"\/?>/g)].map((m) =>
    Number(m[1]),
  );

/** The body of the weather table, comments stripped.
 *
 *  Cut from the weather table by name rather than by being the first `<tbody>`
 *  on the page. It was the first for as long as the sheet had one table; the
 *  parking section became a second, and on a sheet with weather switched off
 *  but parking on, "the first tbody" would quietly have become a list of car
 *  parks being read for wind speeds. Parking is a `<ol>` again as of the row
 *  gaining its labels, so the weather table is once more the only one on the
 *  page — but it is named here regardless, because which sections are tables is
 *  a layout decision and this helper should not be what breaks when one
 *  changes. */
const tbody = (html) =>
  plain(html)
    .split('briefingWeatherTable')[1]
    ?.split('<tbody>')[1]
    ?.split('</tbody>')[0] ?? '';

/** The markup of the weather row whose period column reads `label`. */
const rowHtml = (html, label) =>
  tbody(html)
    .split('<tr')
    .find((r) => r.includes(`<td>${label}</td>`)) ?? '';

/** The cells of that row as plain text, period column first.
 *
 *  Cells are no longer bare text: temperature, precipitation and the gust each
 *  sit in a tinted span, and the sky column holds an `<img>`. Tags are stripped
 *  rather than matched around, so the reading survives the next bit of styling
 *  and still says what a person would see — the wind cell reads "Ø 5 (22)"
 *  whether or not the gust is in its own element. A cell whose only content is
 *  an icon reads as empty, which is what `rowIcons` is for. */
const rowCells = (html, label) => {
  const row = rowHtml(html, label);
  if (!row) return [];
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, '').trim(),
  );
};

/** Where each reading sits in the array `rowCells` returns.
 *
 *  Named rather than written out as 2, 3, 4 at each call site. The sheet prints
 *  its columns in the weather panel's order, so this order is not the harness's
 *  to choose — it follows the app — and it has already changed once, when the
 *  sheet was rebuilt to look like the panel and precipitation moved in front of
 *  wind. That change turned every numeric assertion below into a silent
 *  comparison against the wrong column: the wind checks started reading
 *  millimetres, and the one that survived did so because "" and a missing cell
 *  both stringify to nothing. Six failures caught it; a seventh might not have.
 *
 *  Index 0 is the period label. The four readings then repeat per anchor, which
 *  is what `anchor` is for: `cell(TEMP, 1)` is the high point's temperature. */
const [SKY, TEMP, PRECIP, WIND] = [1, 2, 3, 4];
const ANCHOR_COLS = 4;
/** Column index for a reading at a given anchor (0 = low point, 1 = high). */
const at = (col, anchor = 0) => col + anchor * ANCHOR_COLS;

/** The MET symbol codes drawn in that row, in column order. The icons are the
 *  one thing on the sheet a reader takes in without reading, so which one a
 *  period chose is worth asserting on directly. */
const rowIcons = (html, label) =>
  [...rowHtml(html, label).matchAll(/\/weather-icons\/([\w-]+)\.svg/g)].map(
    (m) => m[1],
  );

/** Every row's period label, in the order they print. */
const rowLabels = (html) =>
  [...tbody(html).matchAll(/<td>(\d\d\u2013\d\d)<\/td>/g)].map((m) => m[1]);

/** How many hours a period label claims to cover. "21–24" closes the day at
 *  midnight and MET's evening block really does read "19–01", so the arithmetic
 *  has to wrap — and a label covering nothing at all is a bug, not a zero. */
const labelSpan = (label) => {
  const [from, to] = label.split('\u2013').map(Number);
  return ((to - from + 24) % 24) || 24;
};

/** Whether the rows tile the day without overlapping. Two rows that overlap
 *  would print the same hour's rain twice under two different headings, which is
 *  the one way this table can lie about a total rather than merely be coarse. */
const overlapFree = (labels) => {
  const spans = labels.map((l) => ({
    start: Number(l.split('\u2013')[0]),
    hours: labelSpan(l),
  }));
  return spans.every((a, i) =>
    spans.every((b, j) => j <= i || !(b.start < a.start + a.hours)),
  );
};

/** Every section heading, as plain text. */
const headings = (html) =>
  [...plain(html).matchAll(/<h2 class="briefingH2">([^<]*)<\/h2>/g)].map(
    (m) => m[1],
  );

let renderedAll = 0;
for (const options of combos) {
  const html = render(makeData(options));
  const name = OPTION_KEYS.filter((k) => options[k]).join('+') || 'facts only';
  renderedAll++;

  for (const bad of BAD) {
    ok(!html.includes(bad), `[${name}] never prints "${bad}"`);
  }

  // The route's own numbers are what make the sheet this tour rather than a
  // tour, so they print whatever else is switched off.
  ok(html.includes('briefingFacts'), `[${name}] the route facts always print`);
  ok(
    html.includes('Sk\u00e5la'),
    `[${name}] the route name always prints`,
  );

  // Sections leave completely when switched off.
  ok(
    options.map === html.includes('briefingMapFrame'),
    `[${name}] the map follows its switch`,
  );
  ok(
    options.elevation === html.includes('briefingProfileSvg'),
    `[${name}] the elevation profile follows its switch`,
  );
  ok(
    options.avalanche === html.includes('briefingDangerBadge'),
    `[${name}] the danger banner follows its switch`,
  );
  ok(
    options.avalanche === html.includes('briefingRose'),
    `[${name}] the avalanche problems follow the same switch`,
  );
  ok(
    options.steepness === html.includes('briefingBandFill'),
    `[${name}] the steepness bands follow their switch`,
  );
  ok(
    options.steepness === /Utl\u00f8pssoner|Runout zones/.test(html),
    `[${name}] runout exposure follows steepness, not the Varsom switch`,
  );
  ok(
    options.snow === html.includes('briefingSnowSvg'),
    `[${name}] the snow chart follows its switch`,
  );
  ok(
    options.weather === html.includes('briefingWeatherTable'),
    `[${name}] the weather table follows its switch`,
  );
  ok(
    options.parking === html.includes('briefingParkingList'),
    `[${name}] the parking list follows its switch`,
  );
  ok(
    options.notes === html.includes('briefingNoteLines'),
    `[${name}] the notes space follows its switch`,
  );

  // No date is stated once at the top any more, and the header does not
  // announce the genre. A named route names itself; the word "briefing" is
  // only ever a fallback for a route that has no name.
  const header = plain(html).split('</header>')[0] ?? '';
  ok(
    !/Turbriefing|Tour briefing/.test(header),
    `[${name}] the header does not label the sheet a briefing`,
  );
  ok(
    !/2026/.test(header),
    `[${name}] the header states no date — each forecast carries its own`,
  );

  // Each forecast says which day, or which moment, it speaks for. A sheet in a
  // rucksack has no other way of telling the reader how old it is.
  const flat = plain(html);
  ok(
    options.weather === /(V\u00e6r|Weather) \u00b7 MET \u00b7 [^<]*2026/.test(flat),
    `[${name}] the weather heading carries the day it forecasts`,
  );
  ok(
    options.snow ===
      /(Sn\u00f8dybde|Snow depth) \u00b7 seNorge \u00b7 [^<]*2026/.test(flat),
    `[${name}] the snow heading carries the date it was modelled for`,
  );
  ok(
    options.avalanche ===
      /(Sn\u00f8skredvarsel|Avalanche forecast) \u00b7 Varsom \u00b7 [^<]*2026/.test(
        flat,
      ),
    `[${name}] the avalanche heading carries the date it was asked for`,
  );
  // Parking's qualifier is a radius rather than a date, but it does the same
  // job: without it an empty section is unreadable, because "nothing within
  // 1 km" and "nothing within 10 km" are different facts about the valley.
  ok(
    options.parking ===
      /(Parkering|Parking) \u00b7 OpenStreetMap \u00b7 [^<]*\bkm\b/.test(flat),
    `[${name}] the parking heading carries the radius it searched`,
  );

  // The weather table is laid out fixed, so a colgroup that miscounts the
  // anchors would push columns off the paper. One col per rendered column, and
  // the widths have to come to a whole table.
  const cols = colWidths(html);
  if (options.weather) {
    ok(
      cols.length === 9,
      `[${name}] the weather table declares a width for all nine columns`,
    );
    ok(
      Math.abs(cols.reduce((a, b) => a + b, 0) - 100) < 0.001,
      `[${name}] the declared column widths fill the table exactly`,
    );
    ok(
      cols.every((w) => w > 0),
      `[${name}] no column is declared away to nothing`,
    );
    // Not all four columns within an anchor are the same width — an icon needs
    // less room than "NØ 12 (24)" — but the two anchors must be identical, or
    // the pair of groups stops reading straight across and the eye has to
    // re-find the columns halfway over the page.
    const group = (from) =>
      cols.slice(from, from + 4).map((w) => w.toFixed(4)).join('/');
    ok(
      group(1) === group(5),
      `[${name}] the two anchor groups take identical widths`,
    );
    // The group headings have to span exactly the columns the colgroup declares
    // for them. A colSpan and a colgroup that disagree is the classic
    // fixed-layout overhang: harmless on screen, off the paper in print.
    // Matched case-insensitively because React writes the attribute out as
    // `colSpan`, which is how the DOM spells it rather than how HTML does.
    ok(
      (html.match(/colspan="4"/gi) ?? []).length === 2,
      `[${name}] each anchor heading spans its four columns`,
    );
    // The vertical budget in briefing.css allows the table six rows. More than
    // that and the sheet runs past one page, which is the whole point of it.
    const labels = rowLabels(html);
    ok(
      labels.length > 0 && labels.length <= 6,
      `[${name}] the table prints between one and six rows (got ${labels.length})`,
    );
    ok(overlapFree(labels), `[${name}] no two rows cover the same hour`);

    // The footnote that used to explain the table is gone, and with it the claim
    // that every row was six hours — which stopped being true the moment the
    // grid started following the forecast. The two things a reader genuinely
    // cannot infer from the numbers now sit in the column headings, where they
    // cannot drift out of step with the column beneath them.
    ok(
      !/[Hh]ver rad|[Ee]ach row/.test(flat),
      `[${name}] the sheet no longer explains the rows in a footnote`,
    );
    ok(
      !/seks timer|six hours/.test(flat),
      `[${name}] nothing claims a fixed six-hour row any more`,
    );
    ok(
      /mm i alt|mm total/.test(flat),
      `[${name}] the precipitation heading says the figure is a period total`,
    );
    ok(
      /\(kast\)|\(gust\)/.test(flat),
      `[${name}] the wind heading says what the parenthesis is`,
    );
  } else {
    ok(cols.length === 0, `[${name}] no weather table, no colgroup`);
  }

  // Every forecast section states when it was retrieved, on a line of its own
  // below the heading. Each fixture uses a different minute, so a section that
  // borrowed another's timestamp fails here rather than passing quietly.
  const retrieved = retrievedLines(html).join('\n');
  ok(
    options.avalanche === /18:20/.test(retrieved),
    `[${name}] the avalanche retrieval time prints below its heading`,
  );
  ok(
    options.snow === /05:41/.test(retrieved),
    `[${name}] the snow retrieval time prints below its heading`,
  );
  // Two anchors, one line: the older fetch, so the sheet never reads fresher
  // than its stalest half.
  ok(
    options.weather === /07:32/.test(retrieved),
    `[${name}] the weather retrieval line carries the older of the two fetches`,
  );
  ok(
    !/09:53/.test(flat),
    `[${name}] the newer anchor's fetch is not the one printed`,
  );
  ok(
    retrievedLines(html).every((line) => /(Hentet|Retrieved) \S/.test(line)),
    `[${name}] every retrieval line is labelled, never a bare timestamp`,
  );

  // The headings themselves are now free of it: that was the point of moving
  // it down, and an inline relapse would otherwise print it twice.
  ok(
    headings(html).every((h) => !/[Hh]entet|[Rr]etrieved/.test(h)),
    `[${name}] no heading carries a retrieval time inline`,
  );

  // Attribution is a consequence of what is on the page, not a fixed line.
  // Kartverket is the exception: the ascent and high point in the facts are
  // its elevations, and those print on every sheet.
  ok(
    html.includes('Kartverket'),
    `[${name}] Kartverket is credited for the elevations even with no map`,
  );
  ok(
    options.avalanche === html.includes('Varsom'),
    `[${name}] Varsom is credited when its warning is printed`,
  );
  // Two ways to use a source, and either earns the credit: the section that
  // prints the numbers, and the layer draped over the map. A sheet whose only
  // seNorge content is a snow-shaded map still stands on seNorge.
  const usesSnow = options.snow || (options.map && options.mapOverlay === 'snowdepth');
  ok(
    usesSnow === html.includes('seNorge'),
    `[${name}] seNorge is credited when its depths are printed`,
  );
  const usesNve =
    options.steepness || (options.map && options.mapOverlay === 'steepness');
  ok(
    usesNve === /Bratthet og utl|Steepness and runout/.test(html),
    `[${name}] NVE is credited when its steepness reaches the page`,
  );
  ok(
    options.weather === html.includes('MET Norway'),
    `[${name}] MET is credited when its forecast is printed`,
  );

  // When the profile is drawn it is coloured by slope only if asked; the plain
  // teal is the planner's own route colour.
  //
  // Read out of the profile's own SVG, not the page. Scanning the whole page for
  // a stroke that is not the teal worked only for as long as the profile was the
  // one thing on the sheet that strokes a colour — the moment the snow chart
  // started drawing its surface line (#5b8bc5) every snow-on, steepness-off
  // sheet claimed to be coloured by slope. The wrong element answering a
  // question about this one is the failure mode to design against here.
  const profileSvg =
    plain(html).match(/<svg class="briefingProfileSvg"[\s\S]*?<\/svg>/)?.[0] ??
    '';
  const colouredBySlope = /stroke="#(?!0f766e)[0-9a-f]{6}"/i.test(profileSvg);
  ok(
    options.steepness === colouredBySlope,
    `[${name}] the profile is coloured by slope only when steepness is on`,
  );
}
ok(
  renderedAll === 2 ** OPTION_KEYS.length,
  `every switch combination rendered (${renderedAll})`,
);

section('Rendered sheet: awkward inputs');

// An hourly day prints as the fixed daylight grid: three-hour periods from 06
// to midnight. Three hours is the shortest period that still describes
// something a party does in one go, and six rows is what the sheet's vertical
// budget allows.
const paired = render(makeData(DEFAULT_OPTIONS));
ok(
  rowLabels(paired).join(' ') ===
    '06\u201309 09\u201312 12\u201315 15\u201318 18\u201321 21\u201324',
  `an hourly day prints the daylight grid in order (got ${rowLabels(paired).join(' ')})`,
);
ok(
  !paired.includes('<td>21\u201300</td>'),
  'the last row closes the day at 24 rather than reading as a typo for 21:00',
);
// The fixture is a full 24 hours; the hours before 06 are dropped on purpose.
// Two rows of darkness cost the same paper as two rows of daylight.
ok(
  !/<td>0[0-5]\u2013/.test(paired),
  'the night is left off the table rather than printed as empty rows',
);
ok(
  !/<td>\d\d:\d\d<\/td>/.test(paired),
  'no row is labelled with a clock time, which would read as a reading taken then',
);
ok(
  (paired.match(/briefingGroupHead/g) ?? []).length === 2,
  'both anchors get their own column group',
);

// The sky column is MET's own artwork, the same files the weather panel draws
// on screen — which is what makes the sheet recognisable as this app's rather
// than a table of numbers that happens to agree with it.
ok(
  rowIcons(paired, '12\u201315').length === 2,
  'each anchor gets its own sky icon on every row',
);
ok(
  rowIcons(paired, '12\u201315').every((c) => c === 'partlycloudy_day'),
  'the icon drawn is the symbol code MET supplied',
);
ok(
  (paired.match(/<img src="\/weather-icons\//g) ?? []).length === 12,
  'twelve icons for six rows across two anchors, and none left over',
);
ok(
  /<img src="\/weather-icons\/[\w-]+\.svg"[^>]*alt=""/.test(paired),
  'the icons carry an empty alt: the row is already described by its figures',
);

// Beyond roughly 48 hours MET stops publishing hourly and switches to entries
// at 00/06/12/18 UTC carrying six-hour totals. Those land on odd local hours —
// 01/07/13/19 in Norwegian winter, 02/08/14/20 in summer — so the fixed grid
// cannot hold them, and the sheet prints MET's own periods instead. Splitting a
// six-hour total across two rows would invent a distribution inside it; putting
// it in one three-hour row would put six hours of snow behind a three-hour
// heading. This fixture also guards the older bug underneath: a three-hourly
// filter matched none of these instants, so a tour more than two days out
// printed nothing at all.
const sixHourly = render(
  makeData(DEFAULT_OPTIONS, {
    weatherLow: { elevationM: 420, hours: sixHourlyUTC(), fetchedAt: LOW_FETCHED_AT },
    weatherHigh: { elevationM: 1480, hours: sixHourlyUTC(), fetchedAt: HIGH_FETCHED_AT },
  }),
);
const sixHourlyLabels = rowLabels(sixHourly);
ok(
  sixHourlyLabels.length === 3,
  `a coarse forecast prints one row per MET block (got ${sixHourlyLabels.length})`,
);
ok(
  sixHourlyLabels.every((l) => labelSpan(l) === 6),
  `every coarse row is labelled with the six hours it covers (got ${sixHourlyLabels.join(' ')})`,
);
ok(
  overlapFree(sixHourlyLabels),
  'the coarse rows do not overlap, so no total is printed twice',
);
ok(
  sixHourly.includes('briefingWeatherTable') &&
    !/briefingEmpty[\s\S]{0,400}(MET varsler|MET forecasts)/.test(sixHourly),
  'a six-hourly forecast renders a table rather than the empty-weather message',
);
// The bug this whole change started from: MET's coarse entries carry their
// precipitation in next_6_hours, which the app never read, so a far-out row was
// built from a bare instant and printed a dash where snow was forecast.
const coarseCells = rowCells(sixHourly, sixHourlyLabels[0]);
ok(
  coarseCells[PRECIP] === '0.4\u20132.6',
  `a coarse row prints MET's six-hour precipitation band (got ${coarseCells[PRECIP]})`,
);
// Read out of the table body rather than the page: the profile and snow charts
// are SVG paths full of coordinates, and any three digits will turn up in one of
// them sooner or later.
ok(
  !tbody(sixHourly).includes('7.2'),
  'a six-hour total is not multiplied out as if each hour carried it',
);

// The awkward middle case, and the common one two days out: hourly early,
// coarse later, on one table. The grid fills in around the coarse block rather
// than across it.
const mixed = render(
  makeData(DEFAULT_OPTIONS, {
    weatherLow: { elevationM: 420, hours: mixedDay(), fetchedAt: LOW_FETCHED_AT },
    weatherHigh: { elevationM: 1480, hours: mixedDay(), fetchedAt: HIGH_FETCHED_AT },
  }),
);
ok(
  rowLabels(mixed).join(' ') ===
    '06\u201309 09\u201312 12\u201315 15\u201318 18\u201324',
  `a day that turns coarse keeps three-hour rows while MET is hourly (got ${rowLabels(mixed).join(' ')})`,
);
ok(overlapFree(rowLabels(mixed)), 'the coarse row and the grid do not overlap');
ok(
  rowCells(mixed, '18\u201324')[PRECIP] === '9.0',
  `the coarse row prints its own total, not a rate (got ${rowCells(mixed, '18\u201324')[PRECIP]})`,
);
ok(
  rowCells(mixed, '18\u201324')[PRECIP] !== '1.5',
  'a six-hour total is not divided down into the hours it covers',
);
ok(
  rowCells(mixed, '06\u201309')[PRECIP] === '3.0',
  `an hourly row still sums its three hours (got ${rowCells(mixed, '06\u201309')[PRECIP]})`,
);

// A fine reading whose grid slot is already claimed by a coarse block is left
// out rather than given an overlapping row. It is one hour of a six-row table,
// and the alternative is printing the coarse block's snow twice.
const straddle = render(
  makeData(DEFAULT_OPTIONS, {
    weatherLow: {
      elevationM: 420,
      hours: mixedDay({ hourlyUntil: 18, coarseAt: 19 }),
      fetchedAt: LOW_FETCHED_AT,
    },
    weatherHigh: { elevationM: null, hours: [], fetchedAt: null },
  }),
);
ok(
  overlapFree(rowLabels(straddle)),
  'an hour the grid cannot place honestly is dropped rather than overlapped',
);
ok(
  rowLabels(straddle).includes('19\u201301'),
  "MET's evening block keeps its own label even when it runs past midnight",
);

// The sky icon is the period's worst hour, not its first. Of three hours, two
// fair and one snowing, the snow is what changes the plan — and the icon is
// read before any number on the row.
const wettest = render(
  makeData(DEFAULT_OPTIONS, {
    weatherLow: {
      elevationM: 420,
      hours: block1215({
        precip: [0, 3, 0],
        symbols: ['fair_day', 'heavysnow', 'fair_day'],
      }),
      fetchedAt: LOW_FETCHED_AT,
    },
    weatherHigh: { elevationM: null, hours: [], fetchedAt: null },
  }),
);
ok(
  rowIcons(wettest, '12\u201315')[0] === 'heavysnow',
  `the period's icon is its wettest hour (got ${rowIcons(wettest, '12\u201315')[0]})`,
);
// Nothing forecast: there is no worst hour, so the middle of the period stands
// for it rather than whichever end the loop happened to start at.
const dry = render(
  makeData(DEFAULT_OPTIONS, {
    weatherLow: {
      elevationM: 420,
      hours: block1215({ symbols: ['fog', 'clearsky_day', 'fog'] }),
      fetchedAt: LOW_FETCHED_AT,
    },
    weatherHigh: { elevationM: null, hours: [], fetchedAt: null },
  }),
);
ok(
  rowIcons(dry, '12\u201315')[0] === 'clearsky_day',
  `a dry period is drawn by its middle hour (got ${rowIcons(dry, '12\u201315')[0]})`,
);
// And its millimetres column is blank, not a dash — the weather panel's own
// rule. The point of the column is that the blue figures are the weather and the
// gaps between them are the dry spells; a dash in every dry period gives the eye
// six marks to discount before it can find the two that matter. A dash there
// means something else, and the gappy-anchor case below asserts that side.
ok(
  rowCells(dry, '12\u201315')[PRECIP] === '',
  `a dry period leaves its precipitation cell empty (got ${rowCells(dry, '12\u201315')[PRECIP]})`,
);

// The aggregation itself. Averaging everything would be wrong three ways, so
// each rule is pinned to a hand-computed block: states average, accumulations
// sum, and a peak stays a peak.
const bloc = block1215({
  temps: [8, 10, 12], // mean exactly 10
  speeds: [4, 5, 6], // mean exactly 5
  gusts: [9, 22, null], // peak 22
  degs: [90, 90, 90], // due east
  precip: [1, 2, 3], // 6 mm across the period
});
const aggregated = render(
  makeData(DEFAULT_OPTIONS, {
    weatherLow: { elevationM: 420, hours: bloc, fetchedAt: LOW_FETCHED_AT },
    weatherHigh: { elevationM: 1480, hours: bloc, fetchedAt: HIGH_FETCHED_AT },
  }),
);
const aggCells = rowCells(aggregated, '12\u201315');
// SKY holds an icon and so reads as empty text; rowIcons covers it instead.
ok(
  aggCells[TEMP] === '10\u00b0',
  `temperature is the period's average (got ${aggCells[TEMP]})`,
);
ok(
  aggCells[WIND] === '\u00d8 5 (22)' || aggCells[WIND] === 'E 5 (22)',
  `mean wind averages and the gust takes the period's peak (got ${aggCells[WIND]})`,
);
// 6.0 rather than 6: precipitation under 10 mm keeps one decimal, which is the
// same rule the weather panel uses. What matters here is the 6 — averaging
// would have printed 2.0, understating the period threefold.
ok(
  Number(aggCells[PRECIP]) === 6,
  `precipitation sums across the period rather than averaging (got ${aggCells[PRECIP]})`,
);
ok(
  !aggregated.includes('(9)'),
  'the gust column never prints a lesser gust from inside the period',
);
ok(
  aggCells.length === 9,
  `an aggregated row still carries a cell per column (got ${aggCells.length})`,
);
// The row is built from a fixture with no `precipHours` at all — an older
// snapshot, replayed. Three millimetres coming to 6 mm rather than being read as
// three six-hour blocks is what proves a missing window still means one hour.
ok(
  rowLabels(aggregated).join(' ') === '12\u201315',
  'a snapshot without precipHours is still read as hourly readings',
);

// Wind direction is an angle. Averaged as a plain number, 350° and 10° come to
// 180° — the exact opposite of the wind that blew, and on a lee-slope decision
// that is the worst single number the sheet could print.
const wrapCells = rowCells(
  render(
    makeData(DEFAULT_OPTIONS, {
      weatherLow: {
        elevationM: 420,
        hours: block1215({ degs: [350, 350, 10] }),
        fetchedAt: LOW_FETCHED_AT,
      },
      weatherHigh: { elevationM: null, hours: [], fetchedAt: null },
    }),
  ),
  '12\u201315',
);
ok(
  /^N /.test(wrapCells[WIND]),
  `directions either side of north average to north (got ${wrapCells[WIND]})`,
);
// Averaged as plain numbers these three come to 237° — a southwesterly, which is
// the wrong half of the compass. Any southerly answer is the bug, so the check is
// on the letter rather than on one wrong value.
ok(
  !/^S/.test(wrapCells[WIND]),
  'a wrapped direction is not averaged into a southerly',
);

// A period neither anchor covers is dropped, not printed as a row of dashes: a
// sheet for a half-day of forecast should be shorter, not emptier.
const partial = render(
  makeData(DEFAULT_OPTIONS, {
    weatherLow: { elevationM: 420, hours: block1215({}), fetchedAt: LOW_FETCHED_AT },
    weatherHigh: { elevationM: 1480, hours: block1215({}), fetchedAt: HIGH_FETCHED_AT },
  }),
);
ok(
  rowLabels(partial).join(' ') === '12\u201315',
  `an empty period is dropped rather than dashed (got ${rowLabels(partial).join(' ')})`,
);

// One anchor short of a period, the other complete: the row stays, and the gap
// shows as dashes in that anchor's columns rather than pulling the next period's
// numbers up against the other anchor's.
const gappy = render(
  makeData(DEFAULT_OPTIONS, {
    weatherHigh: {
      elevationM: 1480,
      hours: hours({ skip: [12, 13, 14, 15, 16, 17] }),
      fetchedAt: HIGH_FETCHED_AT,
    },
  }),
);
ok(
  rowLabels(gappy).length === 6,
  'a period missing from one anchor does not drop the row',
);
const gappyCells = rowCells(gappy, '12\u201315');
ok(
  gappyCells[at(TEMP, 1)] === '\u2013' &&
    gappyCells[at(PRECIP, 1)] === '\u2013' &&
    gappyCells[at(WIND, 1)] === '\u2013',
  "the anchor missing that period prints dashes across its figures",
);
// This is the other half of the dry-period check further up. A dash in the
// millimetres column now means "MET said nothing for this period" and a blank
// means "no rain", and the two cases have to be told apart from both sides or
// the distinction is worth nothing: blank where there is a reading and it is
// dry, dash — asserted above — where there is no reading at all.
ok(
  gappyCells[at(PRECIP, 1)] === '\u2013' && gappyCells[at(PRECIP, 0)] !== '\u2013',
  'a dash in the millimetres column means no reading, not no rain',
);
// And no icon, rather than a stale or invented one: an icon with no reading
// behind it is the one cell on the row that would look like data.
ok(
  gappyCells[at(SKY, 1)] === '' && rowIcons(gappy, '12\u201315').length === 1,
  'the missing anchor draws no sky icon',
);
ok(
  gappyCells[at(TEMP, 0)] !== '\u2013',
  'the anchor that does have the period keeps its numbers on the same row',
);

// One anchor missing (MET refused, or the route has no usable elevation at one
// end): the table narrows rather than printing empty columns.
const oneAnchor = render(
  makeData(DEFAULT_OPTIONS, {
    weatherHigh: { elevationM: null, hours: [], fetchedAt: null },
  }),
);
ok(
  (oneAnchor.match(/briefingGroupHead/g) ?? []).length === 1,
  'a missing anchor drops its column group instead of printing blanks',
);
ok(
  retrievedLines(oneAnchor).some((line) => /07:32/.test(line)),
  'the anchor that did answer supplies the retrieval time on its own',
);
// The colgroup has to narrow with it. A nine-column colgroup over a five-column
// table is exactly the kind of overhang that only shows up on paper.
const oneAnchorCols = colWidths(oneAnchor);
ok(
  oneAnchorCols.length === 5,
  'a missing anchor narrows the colgroup to match the table',
);
ok(
  Math.abs(oneAnchorCols.reduce((a, b) => a + b, 0) - 100) < 0.001,
  'the narrowed columns still fill the table exactly',
);

// Neither anchor answered: there is no moment to print, so the sub-line must
// be absent altogether rather than an empty or half-written label.
const noWeatherFetch = render(
  makeData(DEFAULT_OPTIONS, {
    weatherLow: { elevationM: 420, hours: hours(), fetchedAt: null },
    weatherHigh: { elevationM: 1480, hours: hours(), fetchedAt: null },
  }),
);
ok(
  headings(noWeatherFetch).some((h) => /MET/.test(h)),
  'the weather heading still names MET and the day it forecasts',
);
ok(
  retrievedLines(noWeatherFetch).length === 2,
  'the weather section drops its retrieval line while the others keep theirs',
);
ok(
  !retrievedLines(noWeatherFetch).some((line) => /07:32|09:53/.test(line)),
  'no other section inherits the weather timestamps',
);

// The weather panel keeps its own day selection, which need not be the tour
// date the avalanche panel supplies. When the two differ the weather heading
// has to name the day it is actually showing — a table of Sunday's forecast
// under Saturday's date is worse than no heading, because it reads as fact.
const otherDay = render(
  makeData(DEFAULT_OPTIONS, { weatherDate: '2026-03-15' }),
);
const weatherHeading =
  headings(otherDay).find((h) => /MET/.test(h)) ?? '';
ok(
  /15\.? mars|15 March/.test(weatherHeading),
  `the weather heading follows the weather panel's day (got "${weatherHeading}")`,
);
ok(
  !/14\.? mars|14 March/.test(weatherHeading),
  'the weather heading does not fall back to the tour date once a day is chosen',
);
// The other two sections are on their own dates and must not have moved.
ok(
  headings(otherDay).some(
    (h) => /Varsom/.test(h) && /14\.? mars|14 March/.test(h),
  ),
  'the avalanche heading keeps the tour date when the weather day differs',
);

// The tour is next week; seNorge cannot model it. The sheet must say which
// date the depths actually describe.
const fallback = render(
  makeData(DEFAULT_OPTIONS, { snowDate: '2026-03-07', snowIsFallback: true }),
);
ok(
  /mars 2026|March 2026/.test(fallback),
  'the fallback snow date is spelled out on the page',
);
ok(
  /ikke fra turdagen|rather than the tour date/.test(fallback),
  'the sheet explains that the depths are not from the tour date',
);

// Nothing arrived at all.
const empty = render(
  makeData(DEFAULT_OPTIONS, {
    avalancheLevel: 0,
    avalancheRegions: [],
    weatherLow: { elevationM: 420, hours: [], fetchedAt: null },
    weatherHigh: { elevationM: 1480, hours: [], fetchedAt: null },
    snow: null,
  }),
);
for (const bad of BAD) {
  ok(!empty.includes(bad), `an empty sheet never prints "${bad}"`);
}
ok(
  empty.includes('briefingEmpty'),
  'missing data is stated rather than left as a blank section',
);

// A single-point, zero-length route: every formatting helper divides by a
// distance or an elevation span that is zero here.
const degenerate = render(
  makeData(DEFAULT_OPTIONS, {
    profile: makeProfile(2, 600, 600),
    snow: { depths: [[0, 0]], date: '2026-03-14', fetchedAt: 1 },
  }),
);
for (const bad of BAD) {
  ok(!degenerate.includes(bad), `a flat route never prints "${bad}"`);
}

// Varsom was never reached, so there is no moment to print and the sub-line
// must be absent rather than empty.
const noFetch = render(makeData(DEFAULT_OPTIONS, { avalancheFetchedAt: null }));
ok(
  headings(noFetch).some((h) => /Varsom \u00b7 [^<]*2026/.test(h)),
  'the avalanche heading still names its source and the date it speaks for',
);
ok(
  retrievedLines(noFetch).length === 2,
  'the avalanche section drops its retrieval line while the others keep theirs',
);
ok(
  !retrievedLines(noFetch).some((line) => /18:20/.test(line)),
  'no other section inherits the bulletin timestamp',
);
for (const bad of BAD) {
  ok(!noFetch.includes(bad), `an unfetched bulletin never prints "${bad}"`);
}

// An unsaved route has no name; the sheet is handed a generic title and must
// print it as the heading rather than an empty rule.
const unnamed = render(
  makeData(DEFAULT_OPTIONS, {
    routeName: 'Tour briefing',
    routeDescription: null,
  }),
);
ok(
  /<h1 class="briefingTitle">Tour briefing<\/h1>/.test(plain(unnamed)),
  'an unnamed route falls back to a titled heading, not a blank one',
);

section('Looks like the planner');

// The sheet is meant to read as the app's own panels. Most of that lives in
// briefing.css and cannot be rendered here — there is no browser in this harness
// and no headless one in the sandbox — so it is checked in two halves: the
// structure the CSS hangs on, out of the rendered markup, and the handful of
// values that only exist as declarations, out of the stylesheet's text.
//
// Reading a stylesheet as a string is a blunt instrument and it is used
// sparingly. Every check below is on something whose absence has a specific
// visible consequence on paper, and each says what that consequence is.
const full = render(makeData(DEFAULT_OPTIONS));
const css = readFileSync(join(ROOT, 'src/briefing/briefing.css'), 'utf8');

// --- The weather panel's table -------------------------------------------

// The order of the four readings. This is the app's order, not the sheet's
// choice, and getting it wrong is the failure that looks like nothing: the
// numbers are all correct and all in the wrong columns, and the only person who
// notices is the one comparing paper to screen in a car park. Read off the
// second header row, whose labels are unambiguous.
const headLabels = [
  ...plain(full)
    .split('<thead>')[1]
    .split('</thead>')[0]
    .matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g),
].map((m) => m[1].replace(/<[^>]*>/g, '').trim());
const readingHeads = headLabels.filter(
  (l) => /Himmel|Sky/.test(l) || l === '\u00b0C' || /mm/.test(l) || /m\/s/.test(l),
);
ok(
  readingHeads.slice(0, 4).join(' | ') ===
    ['Himmel', '\u00b0C', 'mm i alt', 'Vind m/s (kast)'].join(' | ') ||
    readingHeads.slice(0, 4).join(' | ') ===
      ['Sky', '\u00b0C', 'mm total', 'Wind m/s (gust)'].join(' | '),
  `the columns come in the weather panel's order (got ${readingHeads.slice(0, 4).join(' | ')})`,
);
// Both anchors, so the pair still reads straight across.
ok(
  readingHeads.length === 8 &&
    readingHeads.slice(0, 4).join('|') === readingHeads.slice(4, 8).join('|'),
  'both anchors carry the same four columns in the same order',
);

// The card. A collapsed-border table cannot round its own outside corners, so
// without the wrapper the header band prints as a square-cornered grey bar and
// the table stops looking like the panel at all.
ok(
  /<div class="briefingTableCard"><table class="briefingTable briefingWeatherTable"/.test(
    plain(full),
  ),
  'the weather table sits inside the panel card that rounds and clips it',
);
ok(
  /\.briefingTableCard thead \{\s*background: var\(--briefing-band\)/.test(css),
  'the header row keeps the panel\u2019s tinted band behind it',
);
ok(
  /\.briefingTable th \{[^}]*text-transform: uppercase/.test(css) &&
    /\.briefingTable th \{[^}]*letter-spacing: 0\.06em/.test(css),
  "the column labels keep the panel's small letter-spaced caps",
);

// The wind arrow. It is the one element of the panel's wind cell that had been
// deliberately left off, so it is worth asserting that it is both present and
// pointing the right way: the icon points east at rest, MET's angle says where
// the wind comes FROM, and the panel reverses it to show where it is going.
const windRots = [
  ...full.matchAll(/briefingWindArrow" style="transform:rotate\((-?[\d.]+)deg\)/g),
].map((m) => Number(m[1]));
ok(windRots.length > 0, 'the wind cell draws the panel\u2019s direction arrow');
ok(
  windRots.every((r) => Number.isFinite(r)),
  'every arrow gets a real rotation rather than NaNdeg',
);
// hours() blows from 315° all day, so the arrow reads 315 + 180 - 90 = 405 —
// a northwesterly blowing southeast. Asserted on the arithmetic rather than
// normalised into 0-360 on purpose: rotate() takes any angle, and a 405 here is
// evidence the two corrections were both applied in the right direction. Drop
// the +180 and this is 225, which points the arrow back into the wind.
const noonWind = rowHtml(full, '12\u201315');
ok(
  /briefingWindArrow" style="transform:rotate\(405deg\)/.test(noonWind),
  'the arrow points where the wind is blowing to, not where it comes from',
);
// Letters as well as the arrow, because paper has no tooltip. The user asked for
// both; either alone would be a different sheet.
ok(
  /^[NSØEVW]{1,3} \d/.test(rowCells(full, '12\u201315')[WIND]),
  `the wind cell keeps its compass letters beside the arrow (got ${rowCells(full, '12\u201315')[WIND]})`,
);

// --- The charts ----------------------------------------------------------

ok(
  (plain(full).match(/briefingChartCard/g) ?? []).length === 2,
  'both charts sit in the panel card that now draws their edge',
);
// The baselines are gone, and with them the last axis line on the page. A frame
// is the detail that makes a chart read as a figure in a report; the planner
// draws none, and .briefingAxis was the class that did.
ok(
  !full.includes('briefingAxis"') && !css.includes('.briefingAxis {'),
  'neither chart draws a baseline the planner has no counterpart for',
);
ok(
  /\.briefingGrid \{[^}]*stroke-dasharray: 2 4/.test(css),
  "the gridlines keep the planner's dashed rhythm",
);
// Gradient fills rather than the flat greys these had. Checked as a reference
// from the path and a definition in the SVG, so a stop list that got dropped
// would leave the fill pointing at nothing and fail here rather than print an
// unfilled chart.
for (const [id, what] of [
  ['briefingElevFill', 'the terrain'],
  ['briefingSnowFill', 'the snowpack'],
]) {
  ok(
    full.includes(`url(#${id})`) && full.includes(`id="${id}"`),
    `${what} is filled with the planner's gradient, and the gradient is defined`,
  );
  ok(
    (full.match(new RegExp(`<linearGradient id="${id}"`, 'g')) ?? []).length === 1,
    `${what} gradient is defined exactly once, so no id collides`,
  );
}
// User space, not the default bounding box. A route with gaps is drawn as
// several area paths; a bounding-box gradient restarts inside each of them, so
// a short segment prints the whole ramp in a few millimetres while the long one
// beside it spreads it over thirty, and the shading stops meaning elevation.
ok(
  (full.match(/gradientUnits="userSpaceOnUse"/g) ?? []).length === 2,
  'both gradients are pinned to the plot rather than to each path they fill',
);

// --- The avalanche badge -------------------------------------------------

// The colour comes from the same DANGER_LEVELS table the screen reads, and the
// denominator is written out because the sheet prints one badge and no legend.
ok(
  /briefingDangerBadge" style="background:#f0922f;color:#3a1e00"/.test(full),
  "the danger badge takes the level's own colour from the shared scale",
);
ok(
  /briefingDangerScale">\s*\u00b7 3 (av 5|of 5)/.test(plain(full)),
  'the level says what it is out of, which the screen shows in its legend',
);
// The old full-height colour bar had its caption inside it; that element is gone
// and must not linger as dead CSS.
ok(
  !full.includes('briefingDangerOf') && !css.includes('.briefingDangerOf'),
  'the colour-bar caption the square badge replaced is gone from both sides',
);
const unrated = render(makeData(DEFAULT_OPTIONS, { avalancheLevel: 0 }));
ok(
  /briefingDangerBadge briefingDangerUnrated"(?! style)/.test(unrated),
  'an unrated level gets the bordered well rather than a colour it does not have',
);
ok(
  /briefingDangerScale">\s*\u00b7 (ikke vurdert|not rated)/.test(plain(unrated)),
  'an unrated level says so where the scale would be',
);

// --- The shared scale ----------------------------------------------------

// One hairline weight and two radii, so a card added later cannot invent its
// own. These went in as tokens precisely because the sheet had accumulated
// 1.5 mm, 1 mm and 0.6 mm corners that no panel on screen has.
for (const token of [
  '--briefing-radius-md: 2.4mm',
  '--briefing-radius-sm: 1.6mm',
  '--briefing-hairline: 0.6pt',
  '--briefing-band: #f5f7fa',
]) {
  ok(css.includes(token), `the print scale still defines ${token}`);
}
// The literals the tokens replaced. A stray 0.6pt is harmless on its own; a
// stylesheet with both is one where the next change lands in whichever the
// author happened to grep for.
ok(
  (css.match(/border[^:]*: 0\.6pt/g) ?? []).length === 0,
  'no card edge is still written as a bare 0.6pt hairline',
);
ok(
  (css.match(/border-radius: 1(\.5)?mm/g) ?? []).length === 0,
  'no card still rounds itself to a radius the app has no counterpart for',
);

// --- The snowpack actually reaches the paper -------------------------------

// This pair exists because the gradient check above found the chart printing
// nothing whatsoever, and blamed the fixture before the code. SnowSvg breaks its
// area into runs wherever the seNorge grid has a hole, and the old threshold for
// "hole" was a fraction of the route length (maxD / 40), which assumed at least
// forty samples. profile.ts resamples at 20 m, so a route under about 800 m has
// fewer: every ordinary step counted as a hole, no run reached the two points a
// path needs, and the snow section printed its heading, its date, its credit to
// seNorge and an empty box. Every one of those was asserted. None of them was
// the chart.
//
// So the first check counts surface lines on a route whose grid is complete —
// one continuous snowpack, one line — and the second counts them on the same
// route with a hole punched in the middle. Widening the threshold until the
// chart appears would pass the first alone; it takes the second to show the
// threshold still tells a hole from an ordinary step.
const snowLines = (html) => (html.match(/briefingSnowLine/g) ?? []).length;
ok(
  snowLines(full) === 1,
  `an unbroken snowpack prints as one surface line (got ${snowLines(full)})`,
);
const holed = render(
  makeData(DEFAULT_OPTIONS, {
    snow: {
      depths: [
        profile.segments[0].map((_, i) =>
          i >= 10 && i <= 13 ? NaN : 30 + i * 6,
        ),
      ],
      date: '2026-03-14',
      fetchedAt: SNOW_FETCHED_AT,
    },
  }),
);
ok(
  snowLines(holed) === 2,
  `a hole in the grid still splits the snowpack rather than being bridged (got ${snowLines(holed)})`,
);
// ---------------------------------------------------------------------------
// 7. The exported map, and what the export is called
// ---------------------------------------------------------------------------

section('The exported map and its file name');

// The map is a canvas, drawn by a renderer that needs tiles and a browser, so
// the picture itself cannot be rendered in this harness. What can be checked is
// the thing that made it wrong before: the sheet and the planner each carrying
// their own copy of the route's weights, drifting apart, and the export coming
// out as a heavier drawing of the same tour. Those numbers now live in one
// module, and the two renderers are checked to be reading it.
const { briefingFileName } = await import(
  pathToFileURL(join(ROOT, 'src/briefing/fileName.ts')).href
);
// In packages/core since Phase 2 of docs/mobile-web-parity-plan.md, because the
// phone's map is a fifth renderer of the same line and could not reach into
// apps/web for the numbers. Nothing about what is checked here changed with it.
const routeStyle = await import(
  pathToFileURL(join(CORE, 'src/routes/style.ts')).href
);
const sheetSrc = readFileSync(join(ROOT, 'src/briefing/BriefingSheet.tsx'), 'utf8');
const staticSrc = readFileSync(join(ROOT, 'src/briefing/staticMap.ts'), 'utf8');
const plannerSrc = readFileSync(
  join(ROOT, 'src/components/DrawingHandler.tsx'),
  'utf8',
);

ok(
  !/routeWeight:/.test(sheetSrc) && !/haloWeight:/.test(sheetSrc),
  'the sheet asks for no weights of its own, so the printed line is the planner\u2019s',
);
ok(
  /routeWeight = ROUTE_WEIGHT/.test(staticSrc) &&
    /haloWeight = HALO_WEIGHT/.test(staticSrc),
  'the renderer falls back to the shared weights rather than numbers of its own',
);
ok(
  /from '@fjellrute\/core\/routes\/style'/.test(plannerSrc) &&
    !/^const ROUTE_WEIGHT =/m.test(plannerSrc),
  'the planner reads the same widths rather than keeping a second copy',
);
// The dots. They are the one part of the picture that says which way round the
// route is meant to be walked, and they were on paper before they were on
// screen — a reader comparing the two found a green and a red dot on the sheet
// that the map they had drawn it from did not have.
ok(
  /<CircleMarker/.test(plannerSrc) &&
    plannerSrc.includes('START_COLOR') &&
    plannerSrc.includes('FINISH_COLOR'),
  'the planner marks the start and the finish, as the printed map does',
);
ok(
  /dot\(ends\.start, START_COLOR\)/.test(staticSrc) &&
    /dot\(ends\.end, FINISH_COLOR\)/.test(staticSrc),
  'both dots take their colour from the shared pair, so screen and paper agree',
);
ok(
  routeStyle.START_COLOR !== routeStyle.FINISH_COLOR,
  'start and finish are told apart by colour, not just by position',
);
ok(
  routeStyle.HALO_WEIGHT > routeStyle.ROUTE_WEIGHT,
  'the halo is wider than the line it sits under, or it does nothing',
);
ok(
  routeStyle.ENDPOINT_RADIUS > routeStyle.ROUTE_WEIGHT / 2,
  'the endpoint dots are wider than the line, or they vanish into it',
);

// --- One rule for where a route starts and ends ---------------------------

// Four pictures mark the same two points: the planner's Leaflet layer, the
// printed flat map, the planner's 3D view and the printed 3D frame. They used
// to work it out separately, which is fine until one of them decides an
// out-and-back has no finish.
const geometrySrc = readFileSync(join(CORE, 'src/geometry/index.ts'), 'utf8');
const terrainViewSrc = readFileSync(join(ROOT, 'src/terrainView.ts'), 'utf8');
ok(
  /export function routeEnds/.test(geometrySrc),
  'the start/finish rule is stated once, in geometry',
);
for (const [name, src] of [
  ['the planner', plannerSrc],
  ['the printed map', staticSrc],
  ['the 3D view', terrainViewSrc],
]) {
  ok(
    /\brouteEnds\b/.test(src) && !/function endpointsOf/.test(src),
    `${name} reads the shared start/finish rule rather than its own`,
  );
}

// --- The 3D map ------------------------------------------------------------

// The switch prints the planner's terrain view instead of the flat map. Its
// failure mode is not an ugly page but a wrong one: a picture drawn with a
// different camera, a different exaggeration or a different route colour is
// still a plausible-looking map of the same tour, and nobody checks it against
// the screen they drew it on. So the numbers live in terrainView.ts, and both
// renderers are checked to be reading them rather than repeating them.
const terrainMapSrc = readFileSync(
  join(ROOT, 'src/briefing/terrainMap.ts'),
  'utf8',
);
const plannerThreeD = readFileSync(
  join(ROOT, 'src/components/Map3DView.tsx'),
  'utf8',
);
for (const [name, src] of [
  ['the planner\u2019s 3D view', plannerThreeD],
  ['the printed 3D frame', terrainMapSrc],
]) {
  ok(
    /from '\.\.\/terrainView'/.test(src),
    `${name} takes its camera and colours from the shared module`,
  );
  ok(
    !/^const TERRAIN_(EXAGGERATION|PITCH|BEARING) =/m.test(src),
    `${name} keeps no second copy of the terrain numbers`,
  );
}
ok(
  /TERRAIN_ENDPOINT_PAINT/.test(plannerThreeD) &&
    /TERRAIN_ENDPOINT_PAINT/.test(terrainMapSrc),
  'the 3D views mark start and finish too, in the same colours as the flat map',
);
ok(
  terrainViewSrc.includes('START_COLOR') &&
    terrainViewSrc.includes('FINISH_COLOR') &&
    /from '@fjellrute\/core\/routes\/style'/.test(terrainViewSrc),
  'those colours are the shared pair, not a third opinion about green and red',
);

// The still copy, and the two ways it can spoil a page: a WebGL canvas printed
// live comes out black, and a GL context left behind by an export nobody
// finished is taken from the map the user is still looking at.
const pictureSrc = readFileSync(
  join(ROOT, 'src/briefing/TerrainPicture.tsx'),
  'utf8',
);
ok(
  /preserveDrawingBuffer: true/.test(terrainMapSrc),
  'the frame is kept long enough to be copied, or the print comes out blank',
);
ok(
  /briefingMapLive/.test(css) &&
    /@media print[\s\S]*\.briefingMapLive\s*\{[^}]*display:\s*none/.test(css),
  'the live map is preview-only: what prints is the still copy underneath it',
);
ok(
  /gl\.on\('idle', capture\)/.test(terrainMapSrc),
  'the copy is retaken every time the camera comes to rest',
);
ok(
  /'beforeprint'/.test(pictureSrc),
  'and once more as the print dialog opens, so the page cannot lag the screen',
);
ok(
  /map\?\.remove\(\)/.test(terrainMapSrc) &&
    /gl\.remove\(\)/.test(terrainMapSrc) &&
    /handle\?\.destroy\(\)/.test(pictureSrc),
  'the GL context goes when the export fails and when the export closes',
);
ok(
  /await import\('maplibre-gl'\)|import\('maplibre-gl'\)/.test(terrainMapSrc) &&
    !/^import maplibregl from 'maplibre-gl'/m.test(terrainMapSrc),
  'MapLibre is fetched only when 3D is asked for, not by every flat export',
);
ok(
  /CAPTURE_TIMEOUT_MS/.test(terrainMapSrc),
  'a tile source that is simply down cannot hold the Print button hostage',
);
ok(
  /onFailed=\{fallBack\}/.test(sheetSrc) && /setFailed\(request\)/.test(sheetSrc),
  'a browser that cannot draw terrain falls back to the flat map of the right tour',
);
ok(
  /failed !== request/.test(sheetSrc),
  'and flipping a switch asks again, rather than sulking for the rest of the export',
);
ok(
  /import\('\.\/terrainMap'\)/.test(pictureSrc),
  'the live map is reached through an import only made when it is asked for',
);

// --- Aiming it -------------------------------------------------------------

// The map is aimed by dragging it. Everything below is a way of getting that
// wrong that would still look plausible in a screenshot.
ok(
  /interactive: false/.test(terrainMapSrc),
  'MapLibre\u2019s own handlers stay off, so the gesture is measured where it is seen',
);
ok(
  /turn\(dxFraction, dyFraction\)/.test(terrainMapSrc) &&
    /box\.width/.test(pictureSrc) &&
    /box\.height/.test(pictureSrc),
  'the gesture is measured against the frame on screen, not the map behind it',
);
ok(
  /Math\.min\(\s*MAX_PITCH/.test(terrainMapSrc) &&
    /Math\.max\(MIN_PITCH/.test(terrainMapSrc),
  'the tilt stops at the ground and at the sky, wherever the drag keeps going',
);
ok(
  /ArrowLeft/.test(pictureSrc) &&
    /ArrowRight/.test(pictureSrc) &&
    /ArrowUp/.test(pictureSrc) &&
    /ArrowDown/.test(pictureSrc) &&
    /tabIndex=\{0\}/.test(pictureSrc),
  'the map can be aimed from the keyboard as well as with a pointer',
);
// Resolution. The live map is shown at a fraction of the size it is rendered
// at, precisely so that what goes on paper is the big one.
ok(
  /width=\{MAP_W\}/.test(sheetSrc) &&
    /scale=\{MAP_SCALE\}/.test(sheetSrc) &&
    /transform: `scale\(\$\{shrink/.test(pictureSrc),
  'the map is rendered at print size and shrunk to fit, not rendered small',
);
ok(
  /transform-origin: top left/.test(css),
  'and shrunk from the corner it is positioned by, or it slides out of frame',
);
// The north mark is the only thing on paper that says which way the mountain
// is being seen from, so it has to follow the camera rather than the default.
ok(
  /onBearing=\{setBearing\}/.test(sheetSrc) &&
    /rotate\(\$\{-bearing\}deg\)/.test(sheetSrc),
  'the north mark turns with the map, rather than pointing at the angle it opened on',
);

// --- The angle it opens on -------------------------------------------------

// "The same orientation the user had in the planner" is the whole request, and
// its failure mode is silent: a camera left over from another tour prints a
// beautifully angled photograph of the wrong valley.
const {
  rememberTerrainCamera,
  recallTerrainCamera,
  forgetTerrainCamera,
} = await import(pathToFileURL(join(ROOT, 'src/terrainCamera.ts')).href);

const skala = [
  [
    [62.4, 7.6],
    [62.42, 7.66],
    [62.45, 7.7],
  ],
];
const camera = {
  center: [7.65, 62.42],
  zoom: 13.4,
  pitch: 48,
  bearing: 112,
};

ok(
  /rememberTerrainCamera/.test(plannerThreeD) && /moveend/.test(plannerThreeD),
  'the planner hands on its camera whenever it comes to rest',
);
ok(
  /recallTerrainCamera/.test(terrainMapSrc),
  'and the export opens on it rather than on the default angle',
);
forgetTerrainCamera();
ok(
  recallTerrainCamera(skala) === null,
  'a guide who has never opened the 3D view gets the route\u2019s own framing',
);
rememberTerrainCamera(camera);
ok(
  recallTerrainCamera(skala) === camera,
  'having turned the tour in the planner, the export opens facing the same way',
);
ok(
  ['zoom', 'pitch', 'bearing'].every((k) => recallTerrainCamera(skala)[k] === camera[k]) &&
    recallTerrainCamera(skala).center[0] === camera.center[0],
  'the whole camera carries over, not just the compass direction',
);
// An edit is not a new tour: extending the route by a leg should not cost the
// guide the angle they just chose.
const extended = [[...skala[0], [62.47, 7.8]]];
ok(
  recallTerrainCamera(extended) === camera,
  'editing the route keeps the angle it was last looked at from',
);
// A different tour is a different tour, however similar the numbers look.
ok(
  recallTerrainCamera([
    [
      [61.0, 8.4],
      [61.05, 8.5],
    ],
  ]) === null,
  'a camera left over from another tour is not offered for this one',
);
// A tour inside a single cirque has a bounding box a few hundred metres wide,
// and a camera sitting back from it is still looking at it.
rememberTerrainCamera({ ...camera, center: [7.63, 62.401] });
ok(
  recallTerrainCamera([
    [
      [62.4, 7.6],
      [62.401, 7.602],
    ],
  ]) !== null,
  'a tiny tour does not reject a camera standing back from it',
);
ok(
  recallTerrainCamera([]) === null && recallTerrainCamera([[]]) === null,
  'a route with no points asks for no camera',
);
forgetTerrainCamera();
ok(
  recallTerrainCamera(skala) === null,
  'and the angle can be dropped when it stops belonging to anything',
);

// The way back. Inheriting the planner's camera means inheriting its zoom and
// centre too, which on a long tour can be one bowl of it — the right picture on
// a screen you can pan, the wrong one on a sheet. Turning and tilting cannot
// undo that, and panning and zooming are deliberately not offered, so without
// this the inherited view is a dead end.
ok(
  /reset\(\)\s*\{[\s\S]*?fitBounds\(bounds/.test(terrainMapSrc),
  'the whole route can be framed again after arriving zoomed into part of it',
);
ok(
  /reset\(\)\s*\{[\s\S]*?duration: 0/.test(terrainMapSrc),
  'and it lands there at once, so Print cannot catch it mid-flight',
);
ok(
  /handle\.reset\(\)/.test(pictureSrc) && /briefingMapRefit/.test(pictureSrc),
  'the sheet offers that as something to press, not just as something to call',
);
ok(
  /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/.test(pictureSrc),
  'pressing it does not also start a drag on the map underneath it',
);

// The switch itself. Its one trap is being reachable while the thing it
// modifies is off, which would offer a way to draw a map that is not printed.
const dialogSrc = readFileSync(
  join(ROOT, 'src/briefing/BriefingDialog.tsx'),
  'utf8',
);
ok(
  /'map3d'/.test(dialogSrc) && /disabled=\{!options\.map\}/.test(dialogSrc),
  'the 3D switch is offered, and greys out when there is no map to draw',
);
ok(
  /key === 'map3d'/.test(dialogSrc),
  'flipping 3D makes the sheet wait for the new picture before Print is offered',
);

// The sheet credits what it actually drew. The DEM is not Kartverket's, so a
// 3D sheet owes a line the flat one does not.
const flatSheet = render(makeData({ ...DEFAULT_OPTIONS, map3d: false }));
const threeDSheet = render(makeData({ ...DEFAULT_OPTIONS, map3d: true }));
const noMapSheet = render(
  makeData(withDependencies({ ...DEFAULT_OPTIONS, map: false, map3d: true })),
);
ok(
  plain(threeDSheet).includes('Mapzen') &&
    !plain(flatSheet).includes('Mapzen'),
  'the terrain sheet credits the elevation data it is drawn from',
);
ok(
  !plain(noMapSheet).includes('Mapzen'),
  'a sheet with no map credits no terrain',
);
ok(
  plain(threeDSheet).includes('Kartverket') &&
    plain(flatSheet).includes('Kartverket'),
  'the topo credit survives either way of drawing the map',
);
// And the frame itself: one canvas either way, with the turnable map added on
// top of it only when there is terrain to turn.
ok(
  threeDSheet.includes('briefingMapLive') &&
    !flatSheet.includes('briefingMapLive') &&
    !noMapSheet.includes('briefingMapLive'),
  'the map is turnable exactly when it is a 3D map',
);
ok(
  (flatSheet.match(/briefingMapCanvas/g) ?? []).length === 1 &&
    (threeDSheet.match(/briefingMapCanvas/g) ?? []).length === 1,
  'both draw into one canvas, so the page has the same shape either way',
);
ok(
  /Dra for \u00e5 flytte|Drag to move/.test(plain(threeDSheet)),
  'and it says so, because a map that can be aimed looks like one that cannot',
);
// The refit button is markup inside the live map, so the print rule that hides
// the live map is what keeps a control off the paper. If it ever moves out of
// that element it will start printing, silently.
ok(
  threeDSheet.includes('briefingMapRefit') &&
    !flatSheet.includes('briefingMapRefit') &&
    threeDSheet.indexOf('briefingMapLive') <
      threeDSheet.indexOf('briefingMapRefit'),
  'the refit button lives inside the live map, which is what keeps it off paper',
);

// --- How close it is drawn, and where it is pointed -----------------------

// The fit is the right picture often enough to be the default and wrong often
// enough to need a way out: a long traverse fitted into 128 mm of paper is a
// line, and the col the party has to judge is four pixels of it. So the frame
// can be moved and closed in — the flat map by taking the whole Framing, the
// terrain view by taking the zoom as a number and the reach as a limit it
// enforces on its own camera.
//
// None of that is visible in a screenshot of a working case. The ways it goes
// wrong are: a printed scale bar that no longer matches the picture above it, a
// framing composed for one tour surviving into the next, a control that stops
// being screen-only, and a fit that is no longer byte-for-byte the picture the
// sheet drew before any of this existed.
const framingSrc = readFileSync(
  join(ROOT, 'src/briefing/mapFraming.ts'),
  'utf8',
);
const controlsSrc = readFileSync(
  join(ROOT, 'src/briefing/MapZoomControls.tsx'),
  'utf8',
);
const thumbSrc = readFileSync(
  join(ROOT, 'src/components/RouteThumbnail.tsx'),
  'utf8',
);
const framing = await import(
  pathToFileURL(join(ROOT, 'src/briefing/mapFraming.ts')).href
);

// The untouched picture. Everything else on this sheet is drawn from data; the
// framing is the one thing the reader composes, so "nothing asked of it" has to
// be a state the code can recognise rather than a number that happens to be 0.
ok(
  framing.isFit(framing.FIT),
  'the framing every briefing opens on is the one the way back leads to',
);
ok(
  !framing.isFit(framing.zoomBy(framing.FIT, framing.ZOOM_STEP)) &&
    !framing.isFit(framing.panBy(framing.FIT, 0.1, 0)),
  'and a frame that has been closed in or moved knows it is no longer that',
);
// The fit has to survive as *the same picture*, or every thumbnail in the app
// and every export nobody touched quietly changes on the day this landed.
ok(
  /framing = FIT/.test(staticSrc),
  'a caller that asks for no framing gets the fit, as every caller used to',
);
ok(
  !/framing/.test(thumbSrc),
  'the route thumbnails ask for none, so they draw what they always drew',
);

// The two ends. Past the far end the route is a scratch on an empty map; past
// the near end Kartverket's and NVE's deepest tiles have given out and the
// picture gains only blur.
ok(
  framing.ZOOM_MIN < 0 && framing.ZOOM_MAX > 0,
  'the fit sits between the limits, with room to go either way from it',
);
ok(
  framing.clampZoom(framing.ZOOM_MAX + 5) === framing.ZOOM_MAX &&
    framing.clampZoom(framing.ZOOM_MIN - 5) === framing.ZOOM_MIN,
  'a wheel spun on past either end stops there rather than running off',
);
ok(
  Number.isInteger(framing.ZOOM_MAX / framing.ZOOM_STEP) &&
    Number.isInteger(framing.ZOOM_MIN / framing.ZOOM_STEP),
  'both ends are a whole number of presses away, so a button can reach them',
);
// Reaching a limit must not cost a redraw: a new framing object is a new
// render, and a new render refetches every tile in the frame.
const atMax = framing.zoomBy(framing.FIT, framing.ZOOM_MAX);
ok(
  framing.zoomBy(atMax, framing.ZOOM_STEP) === atMax,
  'and pressing on at the limit hands back the same framing, refetching nothing',
);

// The gesture. The map follows the pointer, which means the frame's own centre
// goes the other way — the sign error here is the kind that looks like a
// working feature until somebody tries to use it.
ok(
  framing.panBy(framing.FIT, 0.25, 0.25).pan.x < 0 &&
    framing.panBy(framing.FIT, 0.25, 0.25).pan.y < 0,
  'dragging right and down brings the ground right and down with the pointer',
);
// Reach is measured in fits, not in frames. Stated in frames, a fitted map —
// which already shows everything and has nowhere to go — could wander a whole
// tour clear of the route while a closely zoomed one, which is the one that
// needs to walk the length of the route to the crux, could travel a fraction of
// it.
const reachAt = (zoom) =>
  framing.panBy(framing.zoomBy(framing.FIT, zoom), -99, 0).pan.x;
ok(
  reachAt(0) < 1,
  'a fitted map can be nudged off centre but not walked off its own route',
);
ok(
  reachAt(2) > 3 * reachAt(0),
  'and the closer it is drawn the further it may travel, in ground rather than frames',
);
// Zooming about the pointer. Expressed as: whatever ground lay under the
// anchor before the wheel turned still lies under it afterwards. A map that
// zooms away from the thing being pointed at has to be chased across the frame.
const anchor = { x: 0.3, y: -0.2 };
const groundUnder = (f, a) => (f.pan.x + a.x) / 2 ** f.zoom;
const zoomed = framing.zoomBy(framing.FIT, 1, anchor);
ok(
  Math.abs(groundUnder(zoomed, anchor) - groundUnder(framing.FIT, anchor)) < 1e-9,
  'the wheel closes in on what the pointer is over, not on the middle of the frame',
);
ok(
  framing.zoomBy(framing.FIT, 1).pan.x === 0 &&
    framing.zoomBy(framing.FIT, 1).pan.y === 0,
  'a button, having nothing to aim at, closes in on the middle and stays centred',
);

// One press means the same amount of closer on both maps, which is only true
// while both take the step from the same place.
for (const [name, src] of [
  ['the flat map', sheetSrc],
  ['the terrain view', pictureSrc],
  ['the buttons themselves', controlsSrc],
]) {
  ok(
    /from '\.\/mapFraming'/.test(src) &&
      /ZOOM_STEP/.test(src) &&
      !/^const ZOOM_(STEP|MIN|MAX) =/m.test(src),
    `${name} takes the step and the limits from the shared module`,
  );
}
ok(
  /disabled=\{zoom <= ZOOM_MIN\}/.test(controlsSrc) &&
    /disabled=\{zoom >= ZOOM_MAX\}/.test(controlsSrc),
  'a control with nowhere left to go greys, rather than quietly doing nothing',
);
ok(
  /\{ passive: false \}/.test(framingSrc) &&
    /preventDefault\(\)/.test(framingSrc),
  'the wheel listener is the non-passive kind, or the sheet scrolls instead of zooming',
);

// The flat renderer. The scale bar is the one thing on the page that a reader
// measures with, so a zoom the bar does not know about does not make the sheet
// look wrong — it makes it lie.
ok(
  /metresPerPixel\(centreLat, zoom\) \/ magnify/.test(staticSrc),
  'the printed scale bar is drawn for the picture above it, not for the fit',
);
ok(
  /unprojectLat\(top \+ spanY \/ 2, zoom\)/.test(staticSrc),
  'and for the latitude the frame ended up at, which is what sets the scale',
);
ok(
  /const zoom = Math\.max\(MIN_ZOOM, Math\.min\(maxZoom, Math\.round\(wanted\)\)\)/.test(
    staticSrc,
  ),
  'tiles come from the nearest zoom, so nothing is blown up more than half a level',
);
ok(
  /Math\.round\(px\(\(tx \+ 1\) \* TILE_SIZE\)\) - l/.test(staticSrc),
  'neighbouring tiles are given a shared edge, or the seams print as white threads',
);
// Open-ended after `framing`, because the printed flat map has since gained
// inputs that also need a repaint — the numbered parking signs were the first,
// there being no way to move five signs on a canvas without painting the tiles
// under them again. Pinning the list to exactly five would fail on each new one
// while saying nothing about what it is guarding: that these five are in it, and
// `framing` above all, since the sheet's own zoom and pan ride on it.
ok(
  /\}, \[route, overlay, snowDate, terrain, framing(?:, \w+)*\]\)/.test(sheetSrc),
  'moving the frame redraws the map that is printed, not just the one on screen',
);

// A framing belongs to a route. Carrying one into the next tour would open a
// briefing on a close-up of somewhere the party is not going — and, because
// the sheet is a picture rather than a number, would look entirely deliberate.
ok(
  /route !== framedRoute/.test(sheetSrc) && /setFraming\(FIT\)/.test(sheetSrc),
  'a new route opens on its own whole tour, not on the last one\u2019s close-up',
);
ok(
  !/localStorage/.test(sheetSrc) &&
    !/localStorage/.test(framingSrc) &&
    !/localStorage/.test(pictureSrc),
  'and nothing about the framing is remembered between briefings',
);

// The terrain camera. Its zoom is an offset from wherever the map settled, so
// that 0 is the picture the sheet opened on however the planner was left.
ok(
  /base\.zoom \+ offset/.test(terrainMapSrc),
  'closer means closer than the framing this sheet opened on, not a zoom level',
);
ok(
  /gl\.getMaxZoom\(\)/.test(terrainMapSrc) && /gl\.getMinZoom\(\)/.test(terrainMapSrc),
  'and it stops where the map itself stops, rather than asking for tiles that end',
);
ok(
  /reset\(\)\s*\{[\s\S]*?base = \{ center: gl\.getCenter\(\), zoom: gl\.getZoom\(\) \}/.test(
    terrainMapSrc,
  ),
  'coming home rebases it, so the next press counts from the frame on screen',
);
ok(
  /\[zoom, built\]/.test(pictureSrc),
  'a press that landed while the terrain was still arriving is applied when it does',
);
ok(
  /handle\.setZoom\(zoom\);\s*\n[\s\S]{0,400}?handle\.capture\(\)/.test(pictureSrc),
  'and the still copy is retaken after it, so Print cannot lag the picture',
);

// Both frames' controls, and the single thing keeping them off the paper.
ok(
  flatSheet.includes('briefingMapControls') &&
    threeDSheet.includes('briefingMapControls') &&
    !noMapSheet.includes('briefingMapControls'),
  'both maps are offered the buttons, and a sheet with no map is offered none',
);
ok(
  flatSheet.includes('briefingMapFit') && !flatSheet.includes('briefingMapRefit'),
  'the flat map\u2019s way back drops a framing, which is not the 3D one\u2019s',
);
ok(
  /@media print[\s\S]*\.briefingMapControls,\s*\n\s*\.briefingMapHint\s*\{[^}]*display:\s*none/.test(
    css,
  ),
  'no button and no hint reaches the paper, whichever map drew the picture',
);
ok(
  /Dra for \u00e5 flytte|Drag to move/.test(plain(flatSheet)),
  'the flat map says it can be moved, since one that can looks like one that cannot',
);
ok(
  /touch-action: none/.test(css),
  'a drag on a touchscreen moves the map rather than scrolling the sheet past it',
);
ok(
  /tabIndex=\{terrain \? undefined : 0\}/.test(sheetSrc),
  'the flat map is aimed from the keyboard too, and hands focus over in 3D',
);

// --- The name the browser suggests ---------------------------------------

// The sheet is saved through the browser's own "Save as PDF", which names the
// file after the document title. Everything the user sees is right by the time
// they get there, so this is the last thing on the export that can be wrong —
// and the only one they will not notice until they are looking for the file.
ok(
  briefingFileName('Sk\u00e5la') === 'Sk\u00e5la_Fjellrute',
  'a named tour saves as <tour>_Fjellrute',
);
ok(
  briefingFileName('  Sk\u00e5la  ') === 'Sk\u00e5la_Fjellrute',
  'stray spaces around the name do not become part of the file name',
);
ok(
  briefingFileName('Romsdalseggen 25/2') === 'Romsdalseggen 25-2_Fjellrute',
  'a slash in the name is replaced, not dropped: 25/2 is a date, 252 is not',
);
for (const bad of ['\\', '/', ':', '*', '?', '"', '<', '>', '|', '\u0007']) {
  ok(
    !briefingFileName(`Tur${bad}navn`).includes(bad),
    `a ${JSON.stringify(bad)} in the tour name never reaches the file name`,
  );
}
ok(
  briefingFileName('') === 'Fjellrute' &&
    briefingFileName('   ') === 'Fjellrute' &&
    briefingFileName(null) === 'Fjellrute' &&
    briefingFileName(undefined) === 'Fjellrute',
  'an unsaved route saves as plain Fjellrute rather than as _Fjellrute',
);
ok(
  briefingFileName('...') === 'Fjellrute' &&
  !briefingFileName('.skjult').startsWith('.'),
  'a name of dots does not save a hidden file, or one the OS refuses',
);
ok(
  ['Sk\u00e5la', 'a b', '2026-02-01', '\u00c5rdal / Hurrungane', null]
    .map(briefingFileName)
    .every((n) => n.endsWith('Fjellrute') && !/[\\/:*?"<>|]/.test(n)),
  'every name ends in Fjellrute and is legal on both Windows and macOS',
);
// A route name is free text, and someone will paste a paragraph into it. The
// cap is in characters and the limit that matters is in bytes, so it is checked
// against the alphabet that costs the most: three bytes a letter.
// Room is left for the " (1)" a browser appends when the same tour is exported
// twice into one folder, since that is the export that would fail rather than
// the first.
const essay = briefingFileName('\u5c71'.repeat(400));
const essayBytes = Buffer.byteLength(`${essay} (1).pdf`, 'utf8');
ok(
  essayBytes < 255,
  `a very long tour name still saves, twice over (${essayBytes} bytes)`,
);
ok(
  briefingFileName(`${'a'.repeat(62)}  . `) === `${'a'.repeat(62)}_Fjellrute`,
  'a name cut to length does not end in the space or dot the cut landed on',
);

// ---------------------------------------------------------------------------
// 8. The two sections that decide for themselves
// ---------------------------------------------------------------------------

section('Sections that decide for themselves');

// Snow depth and the avalanche forecast are the only sections whose default
// depends on the day rather than on the guide: seNorge finding no snow along
// the route, and Varsom having rated none of the regions it crosses, both
// produce a section that prints but says nothing.
//
// Everything that can go wrong here is quiet. Deciding before the source has
// answered turns the section off on a day that does have a forecast. Writing
// the decision back into the remembered selection carries one tour's answer
// into the next, where it looks like a preference nobody set. Locking the
// switch instead of defaulting it takes away the one sheet a guide might
// actually want it for — the one that says the day is unrated.
ok(
  DEFAULT_OPTIONS.avalanche === true && DEFAULT_OPTIONS.snow === true,
  'both sections are on by default: what they answer to is the day, not the sheet',
);
const unratedTest = /const unratedTour =[\s\S]*?;/.exec(dialogSrc)?.[0] ?? '';
ok(
  /!avalanche\.loading/.test(unratedTest) &&
    /avalanche\.error === null/.test(unratedTest),
  'a forecast still in flight, or one that failed, is not read as an unrated day',
);
ok(
  /avalanche\.fetchedAt !== null/.test(unratedTest),
  'and neither is a hook that has not asked Varsom anything yet',
);
ok(
  /avalanche\.level === 0/.test(unratedTest),
  'only a day nobody rated turns the section off — a quiet day is still a day',
);
ok(
  /if \(unratedTour && !touched\.avalanche\) out\.avalanche = false/.test(
    dialogSrc,
  ) && /if \(snowlessTour && !touched\.snow\) out\.snow = false/.test(dialogSrc),
  'each section is defaulted off by its own observation and nothing else',
);
const selfDeciding = /const SELF_DECIDING = \[([\s\S]*?)\] as const;/.exec(
  dialogSrc,
)?.[1];
ok(
  ['snow', 'avalanche', 'notes', 'trueScale', 'mapOverlay'].every((k) =>
    new RegExp(`'${k}'`).test(selfDeciding ?? ''),
  ) && /if \(isSelfDeciding\(key\)\)/.test(dialogSrc),
  'turning any of them back retires its automatic default for the rest of the dialog',
);
ok(
  /storeOptions\(chosen\)/.test(dialogSrc) && !/storeOptions\(options\)/.test(dialogSrc),
  'what is remembered is what the guide chose, not what the day decided',
);
const avalancheSwitch =
  /<Switch\s+label=\{t\('Snøskredvarsel'[\s\S]*?\/>/.exec(dialogSrc)?.[0] ?? '';
ok(
  /unratedTour/.test(avalancheSwitch) && !/disabled/.test(avalancheSwitch),
  'the switch says why it is off and stays switchable, as the snow one does',
);
ok(
  /!\(options\.avalanche && avalanche\.loading\)/.test(dialogSrc),
  'and Print is never held for a forecast this sheet is not going to print',
);

// The notes field, on a tour saved without any. Same shape as the two above,
// and the same trap: a blank field is not evidence of anything until the tour's
// own notes have been looked at, and "  " is not a note.
ok(
  DEFAULT_OPTIONS.notes === true,
  'ruled space is on by default: what it answers to is the tour, not the sheet',
);
ok(
  /const notes = routeDescription\?\.trim\(\) \?\? ''/.test(dialogSrc) &&
    /const unwrittenTour = notes === ''/.test(dialogSrc),
  'a tour whose notes are blank or nothing but spaces counts as unwritten',
);
ok(
  /if \(unwrittenTour && !touched\.notes\) out\.notes = false/.test(dialogSrc),
  'and that, and only that, is what turns the ruled field off by default',
);
const notesSwitch =
  /<Switch\s+label=\{t\('Notatfelt'[\s\S]*?\/>/.exec(dialogSrc)?.[0] ?? '';
ok(
  /unwrittenTour/.test(notesSwitch) && !/disabled/.test(notesSwitch),
  'the switch says why it is off and stays switchable, like the other two',
);
ok(
  render(makeData({ ...DEFAULT_OPTIONS, notes: false })).includes(
    'briefingNoteLines',
  ) === false &&
    render(makeData({ ...DEFAULT_OPTIONS, notes: true })).includes(
      'briefingNoteLines',
    ),
  'and the sheet prints the ruled lines exactly when the switch says so',
);

// What the switch is FOR. The section is named after the tour's own Notes
// field — the one in SaveRouteDialog, labelled "Notater" with a placeholder
// asking for conditions and a plan B — and for a long time it did not print
// that field at all. The typed note reached the page only as a subtitle under
// the title, clamped to two lines, while the box headed Notes came out as bare
// ruled paper. The switch already read the note to decide whether to draw the
// box, which is what made the omission hard to see in the source and obvious
// on paper: turn the tour's notes off and a section that never showed them
// disappeared.
//
// So this is asserted from the reader's side, on the text of the page, not on
// the presence of a class name. Where the words are is the whole bug.
const NOTE = 'Klassisk vårtur, tidleg start.';
const withNote = render(makeData(DEFAULT_OPTIONS));
const notesSection =
  /<section class="briefingNotes[^"]*">([\s\S]*?)<\/section>/.exec(
    plain(withNote),
  )?.[1] ?? '';
const headerBlock =
  /<header class="briefingHeader">([\s\S]*?)<\/header>/.exec(
    plain(withNote),
  )?.[1] ?? '';
ok(
  notesSection.includes(NOTE),
  "the tour's saved notes print inside the section headed Notes",
);
ok(
  !headerBlock.includes(NOTE),
  'and not under the title, where they were truncated at two lines',
);
ok(
  textOf(withNote).split(NOTE).length === 2,
  'exactly once on the sheet — the subtitle is gone, not duplicated',
);
ok(
  notesSection.indexOf(NOTE) > -1 &&
    notesSection.indexOf(NOTE) < notesSection.indexOf('briefingNoteLines'),
  'the typed note comes first and the writing space follows it',
);
// The other half of the switch's promise. A tour saved without notes still
// gets the ruled line if the guide turns the section back on, and it must not
// print an empty paragraph where the note would have been.
const noNote = render(
  makeData({ ...DEFAULT_OPTIONS, notes: true }, { routeDescription: null }),
);
ok(
  noNote.includes('briefingNoteLines') &&
    !noNote.includes('briefingNotesText'),
  'a tour with no notes prints the ruled line and no empty note paragraph',
);
// The clamp is the only thing between a pasted essay and a second sheet, and
// it lives in the stylesheet, so it is checked there. Four lines at 8.4pt is
// 16 mm of the roughly 26 mm of headroom the budget comment reserves.
ok(
  /\.briefingNotesText\s*\{[^}]*line-clamp:\s*4/.test(css),
  'and a note longer than four lines is clamped rather than trusted',
);
ok(
  !/\.briefingSubtitle\s*\{/.test(css),
  'the subtitle rule is gone with the element it styled',
);

// Parking, on a start point nobody has mapped. Structurally the fourth of
// these, and the one whose empty state is most likely to be believed: a reader
// who sees "no parking areas" under a heading has been handed a fact about a
// valley by a page that only knows about a database. OpenStreetMap's trailhead
// coverage is far better than the register the section used to read — that is
// why it moved — but it is surveyed by volunteers, so the gravel
// turning-circle at the end of a private forest road is there exactly when
// somebody has walked past it with a phone. So the wording is checked as
// carefully as the switch.
ok(
  DEFAULT_OPTIONS.parking === true,
  'parking is on by default: what it answers to is the trailhead, not the sheet',
);
const unparkedTest = /const unparkedTour =[\s\S]*?;/.exec(dialogSrc)?.[0] ?? '';
ok(
  /!parking\.loading/.test(unparkedTest) &&
    /parking\.error === null/.test(unparkedTest),
  'a query still in flight, or one that failed, is not read as an empty valley',
);
ok(
  /if \(unparkedTour && !touched\.parking\) out\.parking = false/.test(
    dialogSrc,
  ),
  'and that, and only that, is what turns the parking section off by default',
);
const parkingSwitch =
  /<Switch\s+label=\{t\('Parkering'[\s\S]*?\/>/.exec(dialogSrc)?.[0] ?? '';
ok(
  /unparkedTour/.test(parkingSwitch) && !/disabled/.test(parkingSwitch),
  'the switch says why it is off and stays switchable, like the other three',
);
ok(
  /OpenStreetMap/.test(parkingSwitch),
  'and it says so in the map\u2019s terms, not the ground\u2019s',
);
ok(
  /!\(options\.parking && parking\.loading\)/.test(dialogSrc),
  'Print is never held for a car park this sheet is not going to print',
);

// The radius is inherited from the tab, not defaulted here. Two reasons, and
// the second is the one that bites: a guide who widened the search to 8 km did
// so because 2 km came back empty, so a sheet printing the 2 km answer prints
// the empty section they had just fixed — and the tab and the dialog are
// mounted at the same time and both publish to the parking store, so two radii
// would mean two sets of pins fighting over the map.
const { rememberParkingRadius, recallParkingRadius, forgetParkingRadius } =
  await import(pathToFileURL(join(ROOT, 'src/parking/radius.ts')).href);

forgetParkingRadius();
ok(
  recallParkingRadius() === null,
  'a session where nobody moved the slider asks the sheet for no opinion',
);
rememberParkingRadius(8000);
ok(
  recallParkingRadius() === 8000,
  'and one where they did hands the export the radius they are searching at',
);
forgetParkingRadius();
ok(
  /rememberParkingRadius\(next\)/.test(
    readFileSync(join(ROOT, 'src/components/ParkingPanel.tsx'), 'utf8'),
  ),
  'the tab hands its radius on whenever the guide moves the slider',
);
ok(
  /recallParkingRadius\(\) \?\? PARKING_DEFAULT_RADIUS_M/.test(dialogSrc),
  'the dialog opens on it, falling back to the tab\u2019s own default',
);
ok(
  !/useState\(PARKING_DEFAULT_RADIUS_M\)/.test(dialogSrc) &&
    !/<input[^>]*parking-radius/.test(dialogSrc),
  'and the sheet grows no second slider to disagree with the first',
);

// --- What the section prints ------------------------------------------------

const parked = plain(render(makeData(DEFAULT_OPTIONS)));

ok(
  /Tj\u00f8rnadalen parkering/.test(parked),
  'a mapped lot prints the name the mapper gave it',
);
// One formatter, exercised directly in both languages and then looked for on
// the page. Directly, because the sheet renders in one locale per run and the
// separator is the half of this that a single rendering cannot check; on the
// page, because a shared formatter nobody imports is not shared.
const { formatParkingDistance } = await import(
  pathToFileURL(join(ROOT, 'src/parking/format.ts')).href
);
const no = (n, e) => n;
const en = (n, e) => e;
ok(
  formatParkingDistance(240, no) === '240 m' &&
    formatParkingDistance(244, no) === '240 m',
  'below a kilometre the distance is metres, rounded to ten',
);
ok(
  formatParkingDistance(1240, en) === '1.2 km' &&
    formatParkingDistance(1240, no) === '1,2 km',
  'above it, one decimal \u2014 with the separator the reader\u2019s language uses',
);
ok(
  /240 m/.test(parked) && /1,2 km/.test(parked),
  'and the sheet prints what that formatter returns',
);
ok(
  !/0[.,]2 km/.test(parked) && !/1240 m/.test(parked),
  'never the other unit',
);
for (const src of [sheetSrc, readFileSync(join(ROOT, 'src/components/ParkingPanel.tsx'), 'utf8')]) {
  ok(
    /formatParkingDistance/.test(src) && !/toFixed\(1\)\} km/.test(src),
    'both the sheet and the tab measure with the same ruler',
  );
  // And describe the lot with the same list, in the same order, under the same
  // labels. A guide checking the sheet against the screen in a car park is
  // comparing two renderings of one query, so a fact printed "Grus" on one and
  // "gravel" on the other reads as a disagreement about the ground rather than
  // about a lookup table.
  //
  // This was once a loop asserting that both files called each of
  // formatParkingFee, -Payment, -Surface and -Access — the four fields the two
  // sides had in common, checked because the overlap is where they could
  // contradict each other. What it could not check was the part outside the
  // overlap, and that is where they actually drifted: the tab grew max stay,
  // operator and type, the sheet did not, and the sheet dropped the labels from
  // the four it kept in order to fit a 48 mm cell. Every one of those calls was
  // still present and correct.
  //
  // So the assertion is now that neither file has an opinion of its own about
  // which facts a lot has. Both ask parkingFacts, which is the only place the
  // selection, the order and the labels exist; a field added there appears on
  // both, and a field added to one of these files instead cannot appear at all.
  ok(
    /parkingFacts\(/.test(src),
    'and both describe the lot with the shared, labelled fact list',
  );
  // The raw tag fields, reachable on ParkingArea and formerly read here. A
  // renderer that goes back to `p.surface` is one that has started keeping its
  // own list again, and it would read as a machine tag on the page — the whole
  // reason format.ts exists. `capacity` is the tell that matters most: it is the
  // one field that is not a string, so it is the one somebody reformats by hand.
  for (const field of ['surface', 'maxstay', 'operator', 'capacity']) {
    ok(
      !new RegExp(`\\.${field}\\b`).test(src.replace(/^import[^\n]*\n/gm, '')),
      `and neither reads \`${field}\` off the row to render it itself`,
    );
  }
}
// Order is the hook's, nearest first. Re-sorting on the sheet would be a second
// opinion about the same question, and the numbered pins on the map are drawn
// from the hook's order — a sheet that reordered them would number the map
// wrongly, which is the one failure here nobody would catch by reading.
ok(
  parked.indexOf('Tj\u00f8rnadalen') < parked.indexOf('Loen sentrum'),
  'the list is printed nearest first, in the order the map numbered the pins',
);
ok(
  /Parkeringsomr\u00e5de|Parking area/.test(parked),
  'a lot nobody named prints a generic name rather than a blank',
);
ok(
  /\u2014/.test(parked),
  'a lot with no attributes at all prints a dash rather than an empty cell',
);
// Labelled, as on screen. The old sheet printed the capacity as "40 plasser"
// and the rest as bare values — "Gratis · Grus · Kun for kunder" — which is
// three facts in an order the reader cannot see and has no way to name. The
// label is what makes a printed row answerable without the tab open beside it,
// and it is why a lot with nothing recorded now differs visibly from a lot whose
// fields the sheet never carried.
const parkedText = textOf(render(makeData(DEFAULT_OPTIONS)));
ok(
  /(Plasser|Spaces) 40/.test(parkedText) &&
    /(Avgift|Fee) 75 NOK/.test(parkedText),
  'the tags the mapper did record are printed, under the labels the tab gives them',
);
ok(
  !/40 (plasser|spaces)/.test(parkedText),
  'and the capacity is not also spelled out in its own words',
);
// One of the three the sheet used not to have room for at all. Max stay is free
// text a mapper typed, so it is printed as typed.
ok(
  /(Maks tid|Max stay) 48 t/.test(parkedText),
  'the fields the sheet used to drop for want of width are printed too',
);

// --- What one line will not hold ------------------------------------------
//
// The sheet gives each lot one line and no more, because a section that reflows
// is a section with no bound on its height, and the page's budget is written in
// millimetres. So there is a width past which facts have to go, and these check
// where it falls and what goes first.
//
// The fixture's richest lot — every field a mapper can set, a municipal
// operator, a payment list of two — is the widest row the extract realistically
// produces, and it fits. That is the point of PARKING_FACT_BUDGET being set
// from a measurement of the rendered column rather than guessed: on real data
// the sheet shows what the tab shows, whole, and dropping is the exception.
ok(
  /(Drives av|Operator) Stryn kommune/.test(parkedText) &&
    /(Betaling|Payment) App, Kredittkort/.test(parkedText),
  'the fullest realistic lot fits, down to its operator \u2014 the sheet drops nothing',
);
// Past that width, the question stops being whether something was dropped and
// becomes which. This lot is deliberately past it: five payment methods, a
// structure type, and an operator with a department after it. Nothing here is
// impossible to tag, it is just rarer than the line is wide.
const overfullText = textOf(
  render(
    makeData(DEFAULT_OPTIONS, {
      parking: [
        {
          ...parkingAreas[0],
          usage: 'hiking,multi-storey',
          operator: 'Stryn kommune ved Teknisk etat',
          payment: 'app,credit_cards,coins,notes,contactless',
        },
      ],
    }),
  ),
);
ok(
  !/(Drives av|Operator) Stryn kommune/.test(overfullText) &&
    !/(Type) Parkeringshus/.test(overfullText),
  'a lot too wide for its line gives up its least load-bearing facts, not a second line',
);
ok(
  /(Avgift|Fee) 75 NOK/.test(overfullText) &&
    /(Adkomst|Access) Kun for kunder/.test(overfullText),
  'and what it keeps is the cost and the restriction, which are why it is read',
);
// The two that go are the two priority-5 facts, and they go together rather
// than the earlier-printed one surviving on position: display order is the
// array's, but what survives is decided by priority. A row that had kept `Type`
// because it comes last, or dropped `Avgift` because it comes early, would have
// confused the two orders.
ok(
  /(Maks tid|Max stay) 48 t/.test(overfullText) &&
    /(Plasser|Spaces) 40/.test(overfullText),
  'everything above that priority stays, however far down the line it prints',
);
ok(
  !/Stryn kom(?!mune)|Kontaktl(?!\u00f8st)|\u2026/.test(overfullText),
  'nothing is cut mid-value \u2014 a half-printed payment list is worse than none',
);
// A driver cannot tell a dropped fact from an unrecorded one, so the two must
// not be confusable in the other direction either: the field the crowded lot
// gave up has to print in full the moment there is room, or the budget would be
// indistinguishable from the sheet simply not carrying the column.
ok(
  /(Drives av|Operator) Stryn kommune ved Teknisk etat/.test(
    textOf(
      render(
        makeData(DEFAULT_OPTIONS, {
          parking: [
            {
              ...parkingAreas[0],
              operator: 'Stryn kommune ved Teknisk etat',
              capacity: null,
              payment: null,
              maxstay: null,
              access: null,
              surface: null,
            },
          ],
        }),
      ),
    ),
  ),
  'and prints in full on a lot with room for it, so a gap is never the sheet\u2019s doing',
);
// The badge, which had never been on the sheet at all. It is the answer to why
// a tour planner lists car parks, so a sheet without it was a sheet that had
// kept the attributes and lost the point.
ok(
  /Turparkering|Trailhead parking/.test(parked),
  'a lot a mapper tagged as a trailhead says so, as it does on screen',
);
ok(
  !/Turparkering|Trailhead parking/.test(
    plain(render(makeData(DEFAULT_OPTIONS, {
      parking: parkingAreas.map((p) => ({ ...p, usage: null })),
    }))),
  ),
  'and a lot nobody tagged claims nothing — untagged is not the same as not one',
);
// The rest of the facts cell arrives as OpenStreetMap tags rather than as the
// Norwegian prose NVDB used to answer in, so between the row and the paper
// there is now a translation, and it is the translation that is checked here
// — first directly in both languages, then on the rendered page, the same
// shape as the distance formatter above and for the same reason.
const {
  formatParkingAccess,
  formatParkingFee,
  formatParkingPayment,
  formatParkingSurface,
  parkingUsage,
} = await import(pathToFileURL(join(ROOT, 'src/parking/format.ts')).href);
ok(
  formatParkingFee('no', no) === 'Gratis' &&
    formatParkingFee('no', en) === 'Free' &&
    formatParkingFee('75 NOK', no) === '75 NOK',
  'the fee booleans become words; a price is left exactly as the mapper wrote it',
);
ok(
  formatParkingSurface('gravel', no) === 'Grus' &&
    formatParkingSurface('grass_paver', no) === 'Gressarmering',
  'surfaces are Norwegian, including the ones a driver would want to know about',
);
// The rule the whole module turns on: OSM tagging is open, so a value nobody
// has written a mapping for is a value the data gained, not one the sheet may
// quietly drop. Humanised is a small ugliness; hidden is a lie about the map.
ok(
  formatParkingSurface('woodchips', no) === 'Woodchips' &&
    formatParkingPayment('klarna', no) === 'Klarna',
  'a tag value nobody mapped is humanised rather than dropped',
);
ok(
  formatParkingAccess('yes', no) === null &&
    formatParkingAccess('public', no) === null &&
    formatParkingAccess('unknown', no) === null,
  'access says nothing when it only restates the reader\u2019s own assumption',
);
// 2,849 lots in the extract are access=customers, and eight hours on a tour is
// a long time to have left the car outside somebody's hotel by accident.
ok(
  formatParkingAccess('customers', no) === 'Kun for kunder' &&
    formatParkingAccess('customers', en) === 'Customers only',
  'and says it plainly when it is a restriction worth reading before walking off',
);
ok(
  formatParkingPayment('app,credit_cards', no) === 'App, Kredittkort' &&
    formatParkingPayment('Vipps,vipps,easypark', no) === 'Vipps, EasyPark',
  'payment is unpacked into a readable list; brands keep one spelling',
);
// `usage` is the one column that answers two questions at once — "do people
// start tours from here" and "what sort of place is it" — and the tab now reads
// the first beside the lot's name and the second in the attribute row. The
// split is asserted here because it is the only place the two can be told
// apart before they reach a screen.
ok(
  parkingUsage('hiking,multi-storey', no).purposes.join() === 'Turparkering' &&
    parkingUsage('hiking,multi-storey', no).kinds.join() === 'Parkeringshus',
  'usage splits into why a tour planner cares and what sort of place it is',
);
ok(
  parkingUsage('tourism=camp_site', no).kinds.join() === 'Campingplass' &&
    parkingUsage('tourism=camp_site', en).kinds.join() === 'Camp site',
  'a tag read on its value drops the key that carried it',
);
// The bug the badge was built on top of: `trailhead=yes` printed as "Yes",
// because the formatter kept the value and threw away the word that meant
// something. It is the same claim as `hiking=yes` and must not read as a
// second one.
ok(
  parkingUsage('trailhead=yes', no).purposes.join() === 'Turparkering' &&
    parkingUsage('trailhead=yes', no).kinds.length === 0 &&
    parkingUsage('hiking,trailhead=yes', no).purposes.length === 1,
  'a key=yes tag is read on its key, and says the same thing only once',
);
ok(
  parkingUsage('hiking,ski', en).purposes.length === 2 &&
    parkingUsage(null, no).purposes.length === 0 &&
    parkingUsage('grass_paddock', no).kinds.join() === 'Grass paddock',
  'both seasons survive, nothing is invented, and an unmapped kind is humanised',
);
// The fact that replaced NVDB's winter-maintenance column. It earns the slot
// because "app only" is what strands a driver in a valley with no signal, and
// because a facts cell silently missing a field is the failure this whole
// section is built to catch.
ok(
  /App, Kredittkort/.test(parked),
  'including how the lot is paid for, which is the column winter used to hold',
);
ok(
  /Grus/.test(parked) && /Kun for kunder/.test(parked) && /Gratis/.test(parked),
  'and the sheet prints what those formatters return, not what the tag said',
);
// The failure this is all here to prevent, asserted from the other side: one
// forgotten call and a Norwegian party drives to "Dekke: gravel · Avgift: no".
ok(
  !/\b(gravel|asphalt|customers|credit_cards)\b/.test(parked),
  'a raw OpenStreetMap tag never reaches the paper',
);
ok(
  !/null|undefined/.test(parked),
  'and the ones it does not carry are never printed as the absence of a value',
);
// ODbL §4.3: the sheet is a Produced Work and has to carry the notice. It is
// the one credit on this page that is a licence term rather than a courtesy,
// so it is asserted in both directions.
ok(
  /OpenStreetMap/.test(parked) && /ODbL/.test(parked),
  'the sheet credits the map it read, under the licence that map carries',
);
ok(
  !/OpenStreetMap/.test(
    plain(render(makeData({ ...DEFAULT_OPTIONS, parking: false }))),
  ),
  'and with the section off it credits OpenStreetMap for nothing it printed',
);

// The empty sheet, which is the common one. It has to say who did not know
// rather than what is not there.
// Against the markup, not the text: the class name is the thing being looked
// for and `plain` strips the attribute it lives in, so this pair and the one
// below it passed unconditionally for as long as they were written that way —
// including, briefly, while the section was mid-rewrite and rendering an empty
// <ol> here.
const unparkedRaw = render(makeData(DEFAULT_OPTIONS, { parking: [] }));
const unparked = plain(unparkedRaw);
ok(
  !/briefingParkingList/.test(unparkedRaw),
  'an empty result prints no list',
);
ok(
  /OpenStreetMap/.test(unparked) &&
    /(frivillige|volunteers)/.test(unparked),
  'it names the map and why the map, not the valley, is what came back empty',
);
ok(
  !/^(?:.|\n)*(Ingen parkering\.|No parking\.)/.test(unparked),
  'and it never states flatly that there is nowhere to park',
);

// A sheet still waiting on the query. Print is gated on this in the dialog, so this
// state should be unreachable on paper — which is exactly why it is worth
// checking that it degrades to a line of text rather than to a half-table.
const parkingPendingRaw = render(
  makeData(DEFAULT_OPTIONS, { parking: [], parkingLoading: true }),
);
const parkingPending = plain(parkingPendingRaw);
ok(
  !/briefingParkingList/.test(parkingPendingRaw) &&
    /(Laster|Loading)/.test(parkingPending),
  'a query still in flight prints as a waiting line, not as an empty valley',
);
ok(
  !/(frivillige|volunteers)/.test(parkingPending),
  'and does not blame the mappers for an answer that has not arrived',
);

// The radius reaches the page. A heading that always said 2 km would be a
// caption on someone else's search.
ok(
  /\b8 km\b/.test(
    plain(render(makeData(DEFAULT_OPTIONS, { parkingRadiusM: 8000 }))),
  ),
  'the heading prints the radius it was actually given',
);

// The stylesheet has to know the classes the section uses, or the list prints
// as a stack of bulleted default-size text in the middle of a sheet whose every
// other block is measured in sheet millimetres. It matters more since the row
// became a flex line of fixed boxes than it did when it was a table: a table
// with no CSS is still in columns, whereas these classes are the only thing
// holding the plate, the name, the distance and the facts apart.
for (const cls of [
  'briefingParkingList',
  'briefingParkingRow',
  'briefingParkingIndex',
  'briefingParkingName',
  'briefingParkingPurpose',
  'briefingParkingDist',
  'briefingParkingFacts',
  'briefingParkingFact',
  'briefingParkingFactLabel',
  'briefingParkingNote',
]) {
  ok(css.includes(`.${cls}`), `briefing.css styles .${cls}`);
}

// The parking section's height is the only figure in the vertical budget that is
// a ceiling rather than an estimate, and these two declarations are the whole
// reason. PARKING_FACT_BUDGET counts characters while the column is measured in
// millimetres, so a lot tagged with unusually wide values can spend under budget
// and still overrun the line; nowrap is what makes that cost the tail of one
// fact instead of a second line, five lots deep, on a page budgeted to 26 mm of
// headroom. A future edit that let this cell wrap would look like an improvement
// — nothing would be clipped any more — and would silently unbound the section,
// which is exactly how the four-column table it replaced came to be documented
// at 26 mm while really reaching 43.2. See takeParkingFacts.
{
  const rule = css.slice(
    css.indexOf('.briefingParkingFacts {'),
    css.indexOf('}', css.indexOf('.briefingParkingFacts {')),
  );
  ok(
    /white-space:\s*nowrap/.test(rule),
    'the facts cell cannot wrap, so no lot can cost the page a second line',
  );
  ok(
    /overflow:\s*hidden/.test(rule),
    'and overruns it cannot foresee are clipped rather than allowed to bleed',
  );
}

// The profile's vertical scale, which is inherited rather than observed: the
// guide has already chosen how to read this profile, on the panel behind the
// dialog. Everything below is a way of losing that choice or of keeping it too
// long.
const { rememberProfileScale, recallProfileScale, forgetProfileScale } =
  await import(pathToFileURL(join(ROOT, 'src/profileScale.ts')).href);

forgetProfileScale();
ok(
  recallProfileScale() === null,
  'a session where nobody touched the toggle asks the sheet for no opinion',
);
rememberProfileScale('true');
ok(
  recallProfileScale() === 'true',
  'and one where they did hands the export the scale they are reading at',
);
ok(
  /rememberProfileScale\(m\)/.test(
    readFileSync(join(ROOT, 'src/components/ProfilePanel.tsx'), 'utf8'),
  ),
  'the panel hands its scale on whenever the guide picks one',
);
ok(
  /const \[plannerScale\] = useState\(recallProfileScale\)/.test(dialogSrc),
  'the export reads it once, when it opens — not again as the guide works',
);
ok(
  /if \(plannerScale && !touched\.trueScale\)[\s\S]*?out\.trueScale = plannerScale === 'true'/.test(
    dialogSrc,
  ),
  'the inherited scale is the switch\u2019s opening position, not a lock on it',
);
// The one override that can turn something *on*, and so the one that can
// contradict a dependency: true scale is a way of drawing a profile that may
// have been switched off.
ok(
  withDependencies({ ...DEFAULT_OPTIONS, elevation: false, trueScale: true })
    .trueScale === false,
  'true scale cannot outlive the profile it measures',
);
ok(
  /return withDependencies\(out\);/.test(dialogSrc),
  'and the inherited one goes through that rule rather than around it',
);
// Not remembered between exports: it is answered afresh from the panel each
// time, and a stored copy could only ever be a stale second opinion.
ok(
  /REMEMBERED_KEYS = OPTION_KEYS\.filter\(\(k\) => k !== 'trueScale'\)/.test(
    optionsSrc,
  ),
  'the scale is left out of what a briefing remembers for the next one',
);

section('The profile, drawn to scale');

// Fit and true are two readings of the same tour, and only one of them can be
// checked by looking at it: at true scale the picture makes a claim about the
// terrain — this is how steep it is — and a sheet that got the arithmetic wrong
// would state it just as confidently. So the geometry is measured here rather
// than eyeballed in the preview.

/** The profile's own SVG out of a rendered sheet. */
const profileOf = (html) =>
  plain(html).match(/<svg class="briefingProfileSvg"[\s\S]*?<\/svg>/)?.[0] ?? '';
/** Its viewBox height — the plot plus its padding, in the SVG's own units. */
const viewH = (svg) => Number(/viewBox="0 0 1000 ([\d.]+)"/.exec(svg)?.[1]);
/** Where the elevation numbers ended up, top to bottom. They are the only text
 *  in the drawing anchored at the left gutter. */
const yLabels = (svg) =>
  [...svg.matchAll(/<text x="40" y="([-\d.]+)" class="briefingAxisText"/g)].map(
    (m) => Number(m[1]),
  );
const gridLines = (svg) => (svg.match(/class="briefingGrid"/g) ?? []).length;

/** A profile `distanceM` long climbing `lo`→`hi`, for asking what a given
 *  shape of tour does to the drawing. */
function tourShaped(distanceM, lo, hi) {
  const base = makeProfile(12, lo, hi);
  const seg = base.segments[0].map((p, i) => ({
    ...p,
    distance: (i / 11) * distanceM,
  }));
  return {
    ...base,
    segments: [seg],
    stats: { ...base.stats, distance: distanceM },
  };
}

const drawProfile = (trueScale, prof) =>
  profileOf(
    render(
      makeData({ ...DEFAULT_OPTIONS, elevation: true, trueScale }, { profile: prof }),
    ),
  );

/** What the plot's height has to be for a metre up to be as long as a metre
 *  along: the vertical span, in the units the horizontal one is drawn in. The
 *  span is the relief plus the 8% of air the drawing keeps above and below it,
 *  and 942 is the plot's width once the gutters are taken off. */
const trueplotH = (distanceM, relief) => ((relief * 1.16) / distanceM) * 942;
/** Padding: 10 above and 26 below. When the strip is too thin to hold a number
 *  the drawing makes room for the two it puts outside instead — 16 above and 40
 *  below — so the height a true-scale drawing ends up with is one of these two
 *  sums plus whatever the terrain asked for. */
const PAD_SUM = 36;
const PAD_SUM_OUTSIDE = 16 + 40;

const steepTour = tourShaped(4000, 420, 1480);
ok(
  viewH(drawProfile(false, steepTour)) === 210,
  'fit to view keeps the strip the fixed height the stylesheet was written for',
);
ok(
  !/aspect-ratio/.test(drawProfile(false, steepTour)),
  'and takes its shape from the stylesheet, not from the terrain',
);
ok(
  Math.abs(
    viewH(drawProfile(true, steepTour)) -
      (trueplotH(4000, 1060) + PAD_SUM),
  ) < 1,
  'at true scale a metre of climb is drawn exactly as long as a metre of ground',
);
ok(
  /aspect-ratio:1000 \/ /.test(drawProfile(true, steepTour)),
  'and the box takes the drawing\u2019s proportions, or the page would undo it',
);
// The claim is about proportion, so the test is a proportion: the same climb
// over twice the ground is half as steep and has to print half as tall.
const halfSteep = tourShaped(8000, 420, 1480);
ok(
  Math.abs(
    (viewH(drawProfile(true, steepTour)) - PAD_SUM) /
      (viewH(drawProfile(true, halfSteep)) - PAD_SUM) -
      2,
  ) < 0.01,
  'twice the ground for the same climb prints half as tall, which is what steepness is',
);
ok(
  viewH(drawProfile(false, steepTour)) === viewH(drawProfile(false, halfSteep)),
  'while fit to view prints both tours the same shape, which is what it is for',
);

// The extreme the honest drawing produces: a long approach with little relief
// is a few millimetres of strip, and four elevations cannot be written in it.
const longFlat = tourShaped(30000, 300, 500);
const flatTrue = drawProfile(true, longFlat);
const flatFit = drawProfile(false, longFlat);
ok(
  Math.abs(viewH(flatTrue) - (trueplotH(30000, 200) + PAD_SUM_OUTSIDE)) < 1,
  'a long gentle tour is printed as the thin strip it is, not padded out to fill one',
);
ok(
  viewH(flatTrue) < viewH(flatFit) / 2,
  'and the strip really is a strip: nothing like the height fit to view gives it',
);
ok(
  gridLines(flatFit) >= 3 && gridLines(flatTrue) <= 2,
  'the axis thins to what the height can hold, rather than stacking numbers',
);
ok(
  gridLines(flatFit) === yLabels(flatFit).length &&
    gridLines(flatTrue) === yLabels(flatTrue).length,
  'and thins line and number together: a gridline nobody can read is furniture',
);
const flatYs = yLabels(flatTrue);
ok(
  flatYs.length === 2 && Math.abs(flatYs[0] - flatYs[1]) >= 16,
  'the two numbers that survive are far enough apart to be two numbers',
);
ok(
  flatYs.every((v) => v > 0) && Math.max(...flatYs) < viewH(flatTrue) - 10,
  'and both are on the page rather than clipped off its top or lost in the distances',
);
// Steepness colouring and the scale are independent: one says how steep the
// ground is, the other how honestly the picture says it.
ok(
  viewH(
    profileOf(
      render(
        makeData(
          { ...DEFAULT_OPTIONS, steepness: false, trueScale: true },
          { profile: steepTour },
        ),
      ),
    ),
  ) === viewH(drawProfile(true, steepTour)),
  'a profile drawn plain is drawn at the same scale as one coloured by slope',
);
// And the sheet says which reading the reader is holding, since a strip drawn
// to fit exaggerates the climb and nothing on the page would otherwise admit it.
ok(
  /riktig m\u00e5lestokk|true scale/i.test(
    plain(render(makeData({ ...DEFAULT_OPTIONS, trueScale: true }))),
  ) &&
    !/riktig m\u00e5lestokk|true scale/i.test(
      plain(render(makeData({ ...DEFAULT_OPTIONS, trueScale: false }))),
    ),
  'the heading names the scale when it is the true one, and claims nothing when it is not',
);

section('Sections that decide for themselves, continued');

// The sheet itself, on a day Varsom has not rated. The section is off by
// default now, so both of its states have to hold: switched back on it must
// print the absence rather than an empty frame — a briefing that quietly omits
// the section reads as one nobody finished — and left off it must take the
// credit line with it, since citing Varsom for a page it did not appear on is
// a small lie. (`unrated` is the level-0 sheet built for the badge checks
// above; the same page answers both questions.)
ok(
  !/\b0 av 5\b|\b0 of 5\b/.test(plain(unrated)),
  'an unrated day is never printed as a danger level, which 0 is not',
);
ok(
  !plain(
    render(
      makeData(
        { ...DEFAULT_OPTIONS, avalanche: false },
        { avalancheLevel: 0, avalancheRegions: [] },
      ),
    ),
  ).includes('Varsom'),
  'and with the section off the sheet credits Varsom for nothing it printed',
);

section('The map wears what the planner was wearing');

// The planner drapes one of three layers over its map, and until now the export
// could only ever paint one of them — and it painted that one off the same
// switch that coloured the elevation profile. Two claims to hold, then: the
// sheet can now draw all three, and the map's layer and the profile's colouring
// are separate questions.

// Sources this section reads that no earlier one did. The rest — the sheet, the
// flat renderer, the dialog, the two terrain modules, the stylesheet — are
// already open above, and reading a file twice under two names is how two
// checks come to disagree about what it says.
const mapCssSrc = readFileSync(
  join(ROOT, 'src/components/Map.module.css'),
  'utf8',
);
const appSrc = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
const layersSrc = readFileSync(join(CORE, 'src/offline/layers.ts'), 'utf8');

// --- The split -------------------------------------------------------------

// The point of the whole change, stated as the two sheets that were impossible
// before: a clean map with the slope-angle numbers printed beside it, and a
// shaded map on a sheet with no profile at all.
const plainMapColouredProfile = render(
  makeData({
    ...DEFAULT_OPTIONS,
    map: true,
    mapOverlay: 'none',
    elevation: true,
    steepness: true,
  }),
);
ok(
  /Kart over ruta, nord opp|Route map, north up/.test(plainMapColouredProfile),
  'a bare map can be printed on a sheet that still prints the slope bands',
);
ok(
  /briefingBands/.test(plainMapColouredProfile) &&
    /Bratteste parti|Steepest section/.test(plainMapColouredProfile),
  'and those bands really are on it — the map did not take them with it',
);
const shadedMapNoProfile = render(
  makeData({
    ...DEFAULT_OPTIONS,
    map: true,
    mapOverlay: 'steepness',
    elevation: false,
    steepness: false,
  }),
);
ok(
  /bratthetslag|steepness overlay/.test(shadedMapNoProfile),
  'and a shaded map survives a sheet with no elevation profile to colour',
);
const withDepsBody =
  /export function withDependencies\([\s\S]*?\n\}/.exec(optionsSrc)?.[0] ?? '';
ok(
  withDepsBody.length > 0 && !/mapOverlay/.test(withDepsBody),
  'the map layer is not blanked with the map: nothing is stranded, so nothing is thrown away',
);
ok(
  withDependencies({ ...DEFAULT_OPTIONS, map: false }).mapOverlay ===
    DEFAULT_OPTIONS.mapOverlay,
  'switching the map off and on again gives back the layer that was chosen',
);
ok(
  /steepness={options\.steepness}\s+runout={options\.steepness}/.test(sheetSrc) &&
    /overlay={options\.mapOverlay}/.test(sheetSrc),
  'the profile reads the steepness switch and the map reads the layer choice',
);

// --- All three layers reach the page ---------------------------------------

for (const overlay of MAP_OVERLAYS) {
  for (const view of ['2d', '3d']) {
    const html = render(
      makeData({
        ...DEFAULT_OPTIONS,
        map: true,
        map3d: view === '3d',
        mapOverlay: overlay,
      }),
    );
    const label = /aria-label="([^"]*)"[^>]*class="briefingMapCanvas"|class="briefingMapCanvas"[^>]*aria-label="([^"]*)"/.exec(
      html,
    );
    const text = label ? (label[1] ?? label[2]) : '';
    ok(
      text.length > 0,
      `[${view}/${overlay}] the map still says what it is to a reader who cannot see it`,
    );
    ok(
      overlay === 'steepness'
        ? /bratthet|steepness/i.test(text)
        : overlay === 'snowdepth'
          ? /snødybde|snow depth/i.test(text)
          : !/bratthet|steepness|snødybde|snow depth/i.test(text),
      `[${view}/${overlay}] and names the layer it is actually wearing`,
    );
    ok(
      (view === '3d') === /3D/.test(text),
      `[${view}/${overlay}] the layer choice did not disturb which view is drawn`,
    );
  }
}

// --- Snow, drawn the planner's way -----------------------------------------

// seNorge stops at z9. Steepness gets a zoom ceiling because it has real detail
// at 16 to protect; snow has none at 9, and holding the whole frame to z9 would
// print a country where a valley was asked for.
ok(
  /overlay === 'steepness'\s*\?\s*Math\.min\(/.test(staticSrc),
  'only steepness holds the frame back to the zoom its tiles are published at',
);
ok(
  /const snowZoom = Math\.min\(zoom, OFFLINE_LAYERS\.snowdepth\.maxNativeZoom\)/.test(
    staticSrc,
  ),
  'snow is fetched on its own grid and stretched, the way the planner upsamples it',
);
ok(
  /Math\.round\(px\(\(sx \+ 1\) \* span\)\) - l/.test(staticSrc),
  'and its tiles are given the same shared edge, so the seams do not print either',
);
ok(
  /const snowdepth: OfflineLayer = \{[\s\S]*?maxNativeZoom: 9,/.test(layersSrc),
  'the ceiling being worked around is seNorge\u2019s own 1 km grid',
);
ok(
  /tileUrl\(snowZoom, wx, sy, \{ snowDate \}\)/.test(staticSrc),
  'the day the sheet is about is the day the tiles are asked for',
);
ok(
  /snowDate={snowDate}/.test(sheetSrc),
  'and that day is the sheet\u2019s own, so the map and the snow chart cannot differ',
);

// The planner greys the base under snow so the only colour left is the ramp's.
const grayscale = /grayscale\(100%\) contrast\(0\.9\) brightness\(1\.05\)/;
ok(
  grayscale.test(mapCssSrc) && grayscale.test(staticSrc),
  'the printed base is drained of colour under snow, exactly as the planner drains it',
);
ok(
  /ctx\.filter = 'none';/.test(staticSrc),
  'and only the base: the filter is cleared before the route and the dots are drawn',
);

// --- The two 3D maps are one picture ---------------------------------------

ok(
  /TERRAIN_STEEPNESS_OPACITY = 0\.6/.test(terrainViewSrc) &&
    /TERRAIN_SNOW_OPACITY = 0\.8/.test(terrainViewSrc),
  'the draped opacities are stated once, where the camera and the mesh are stated',
);
for (const name of ['TERRAIN_STEEPNESS_OPACITY', 'TERRAIN_SNOW_OPACITY']) {
  ok(
    new RegExp(`'raster-opacity': ${name}`).test(plannerThreeD) &&
      new RegExp(`'raster-opacity': ${name}`).test(terrainMapSrc),
    `both 3D maps read ${name} rather than each carrying a number`,
  );
}
ok(
  /source: 'snow',[\s\S]{0,160}visibility: overlay === 'snowdepth'/.test(
    terrainMapSrc,
  ),
  'the exported 3D map declares the snow layer and switches it, as the planner does',
);
ok(
  /offlineTileTemplate\('snowdepth', snowDate\)/.test(plannerThreeD) &&
    /offlineTileTemplate\('snowdepth', snowDate\)/.test(terrainMapSrc),
  'and asks for it through the same offline protocol, so a downloaded region prints',
);
ok(
  /maxzoom: 9/.test(terrainMapSrc),
  'capped at seNorge\u2019s native zoom, so MapLibre overzooms instead of 404ing',
);
ok(
  /\[route, overlay, snowDate, width, height, scale, canvasRef\]/.test(pictureSrc),
  'changing the layer rebuilds the terrain map rather than leaving the old drape',
);

// --- Inherited from the planner, and never remembered ----------------------

ok(
  /if \(plannerOverlay && !touched\.mapOverlay\) out\.mapOverlay = plannerOverlay/.test(
    dialogSrc,
  ),
  'the export opens on the layer the planner is showing',
);
ok(
  /overlay={overlay}/.test(appSrc),
  'which the planner actually hands it',
);
ok(
  /setTouched\(\(prev\) => \(\{ \.\.\.prev, mapOverlay: true \}\)\)/.test(
    dialogSrc,
  ),
  'and picking a different one here retires that inheritance for the rest of the dialog',
);
ok(
  !new RegExp("keep\\[key\\][\\s\\S]*mapOverlay").test(optionsSrc) &&
    !/REMEMBERED_KEYS[^\n]*mapOverlay/.test(optionsSrc),
  'nothing about the layer is written to storage — the planner is asked afresh each time',
);
ok(
  /for \(const key of REMEMBERED_KEYS\)[\s\S]{0,120}typeof rec\[key\] === 'boolean'/.test(
    optionsSrc,
  ),
  'and a stored selection can only ever restore switches, never a layer',
);

// The 3D view copies itself onto the printing canvas only when it settles, so
// between choosing a layer and that copy the screen and the paper disagree.
ok(
  /const rebuildsFor3D = options\.map && options\.map3d/.test(dialogSrc) &&
    /if \(rebuildsFor3D\) setMapReady\(false\)/.test(dialogSrc),
  'a layer picked in 3D holds Print until the new picture has been photographed',
);

// --- The control -----------------------------------------------------------

const choiceBlock = /<Choice[\s\S]*?\/>/.exec(dialogSrc)?.[0] ?? '';
ok(
  /value={options\.mapOverlay}/.test(choiceBlock) &&
    MAP_OVERLAYS.every((o) => new RegExp(`value: '${o}'`).test(choiceBlock)),
  'the layer is picked from the planner\u2019s three, not toggled',
);
ok(
  /disabled={!options\.map}/.test(choiceBlock) &&
    /onChange={setMapOverlay}/.test(choiceBlock),
  'and greys out with the map it is drawn on, rather than being blanked',
);
for (const cls of [
  'briefingChoice',
  'briefingChoiceChip',
  'briefingChoiceDisabled',
]) {
  ok(css.includes(`.${cls}`), `the choice row is styled: .${cls}`);
}

section('The 3D map can be moved, not only turned');

// The planner's 3D view can be dragged around as well as turned, and the export
// could only be turned. Closing that gap moves a gesture that already had a
// meaning, which is the interesting part: a plain drag now moves the map and a
// held Shift turns it, matching the planner rather than matching what this
// dialog did last week.
//
// Three things can go wrong here and none of them throws. The map can move the
// wrong way, which looks like a bug in the mouse. It can move without limit,
// which prints a sheet with no route on it. And the two renderers can end up
// with two different opinions about how far "far enough" is, which nobody
// notices until someone compares a flat export with a 3D one of the same tour.

// --- The gesture, and which hand it is in ----------------------------------

// The body of the implementation, not the declaration above it: `move(` appears
// in both, and a check that reads the interface would pass on a handle whose
// method does nothing at all.
const terrainMove =
  terrainMapSrc.match(
    /\n {6}move\(dxFraction, dyFraction\) \{[\s\S]*?\n {6}\},/,
  )?.[0] ?? '';
ok(
  terrainMove !== '' &&
    /move\(dxFraction: number, dyFraction: number\): void/.test(terrainMapSrc),
  'the terrain map can be asked to move, in the same frame fractions it is turned by',
);
ok(
  /gl\.panBy\(\[-dxFraction \* width, -dyFraction \* height\]/.test(terrainMove),
  'and the ground follows the pointer rather than running away from it',
);
ok(
  /duration: 0/.test(terrainMove),
  'the move lands at once, so the copy that prints is never mid-flight',
);

// Which meaning a drag has. The planner pans on a plain drag and rotates on a
// modifier; this had it the other way round, and the whole point of the change
// is that it no longer does.
const pointerDown =
  pictureSrc.match(/const onPointerDown[\s\S]*?\}, \[\]\);/)?.[0] ?? '';
const pointerMove =
  pictureSrc.match(/const onPointerMove[\s\S]*?\}, \[\]\);/)?.[0] ?? '';
ok(
  /turning: turns\(e\)/.test(pointerDown),
  'what a drag means is decided at the press',
);
ok(
  /from\.turning/.test(pointerMove) &&
    !/turns\(e\)/.test(pointerMove) &&
    /handle\.move\(dx, dy\)/.test(pointerMove),
  'and held for the whole stroke, so a released Shift cannot hand it to the other gesture',
);
ok(
  /shiftKey \|\| e\.ctrlKey \|\| \(e\.buttons \?\? 0\) === 2/.test(pictureSrc),
  'Shift, Ctrl and the right button turn it \u2014 the three ways the planner does',
);
ok(
  /onContextMenu=\{\(e\) => e\.preventDefault\(\)\}/.test(pictureSrc),
  'and the right button turning the map does not also open a menu over it',
);
// The keyboard is the same rule or it is a second thing to learn.
ok(
  /const unit = e\.shiftKey \? KEY_STEP : KEY_MOVE_STEP/.test(pictureSrc) &&
    /if \(e\.shiftKey\) handle\.turn\(aim\[0\], aim\[1\]\)/.test(pictureSrc),
  'the arrows mean whatever a drag means, and Shift flips them the same way',
);
ok(
  /else handle\.move\(-aim\[0\], -aim\[1\]\)/.test(pictureSrc),
  'pressing right walks the frame right, rather than shoving the ground right',
);

// --- The leash -------------------------------------------------------------

// PAN_REACH is the number that stops a briefing map being browsed to the next
// fjord. It was the flat map's alone; now both renderers answer to it, which is
// only worth anything if it is genuinely the same number in both places.
ok(
  typeof framing.PAN_REACH === 'number' && framing.PAN_REACH > 0.5,
  'the reach is more than half a frame, so either end of the route can be centred',
);
ok(
  /import \{ PAN_REACH \} from '\.\/mapFraming'/.test(terrainMapSrc) &&
    !/PAN_REACH = /.test(terrainMapSrc),
  'the terrain view imports that reach rather than keeping a second copy of it',
);
ok(
  /leash\(\);/.test(terrainMove),
  'every move is checked against it \u2014 an unchecked one is the whole failure',
);
// Measured from the base zoom, not the current one. Getting this wrong shortens
// the leash every time the guide zooms in, which strands them at the crux.
const leashBody =
  terrainMapSrc.match(/const leash = \(\) => \{[\s\S]*?\n {4}\};/)?.[0] ?? '';
ok(
  /2 \*\* base\.zoom/.test(leashBody) && !/gl\.getZoom\(\)/.test(leashBody),
  'the reach is a fixed distance over the ground, not one that shrinks as you close in',
);
ok(
  /lngToTileX/.test(leashBody) && /latToTileY/.test(leashBody),
  'and is measured in the projection the flat map stitches its tiles in',
);
ok(
  /base = \{ center: gl\.getCenter\(\), zoom: gl\.getZoom\(\) \};/.test(
    terrainMapSrc.match(/reset\(\) \{[\s\S]*?\n {6}\},/)?.[0] ?? '',
  ),
  'fitting the route again re-anchors both the zoom and the reach, not just the zoom',
);

// The claim the 3D leash formula rests on: that a reach stated in *fits* is a
// fixed distance over the ground however far in the frame is zoomed. Checked on
// the flat map's own model, because that is where the arithmetic is runnable —
// and because if it were ever false there, the 3D map would be enforcing a
// limit its own comment misdescribes.
{
  const walked = framing.panBy(framing.FIT, -99, 0); // hard against the stop
  let ground = walked.pan.x * 2 ** -walked.zoom;
  let held = true;
  let f = walked;
  for (let i = 0; i < 8; i++) {
    f = framing.zoomBy(f, framing.ZOOM_STEP);
    const now = f.pan.x * 2 ** -f.zoom;
    if (Math.abs(now - ground) > 1e-9) held = false;
    ground = now;
  }
  ok(
    held && f.zoom > walked.zoom,
    'a frame at the end of its reach stays the same distance out as it zooms in',
  );
  ok(
    Math.abs(walked.pan.x) === framing.PAN_REACH,
    'and that distance is the reach itself, in fits, at the framing it opened on',
  );
}

// The inverse projections the leash needs to turn a clamped position back into
// a centre. New, and wrong-by-a-little is the failure that would survive review:
// a map that creeps a few metres every time it is dragged to its limit.
{
  const tm = await import(
    pathToFileURL(join(CORE, 'src/offline/tileMath.ts')).href
  );
  let worst = 0;
  for (const lat of [-84, -60, 0, 45, 58.9, 62.5, 69.7, 78.2, 84]) {
    for (const lng of [-179, -30, 0, 5.3, 10.7, 31.1, 179]) {
      for (const z of [0, 5, 12]) {
        worst = Math.max(
          worst,
          Math.abs(tm.tileXToLng(tm.lngToTileX(lng, z), z) - lng),
          Math.abs(tm.tileYToLat(tm.latToTileY(lat, z), z) - lat),
        );
      }
    }
  }
  ok(
    worst < 1e-9,
    'lng/lat survives the round trip through tile space, from Svalbard to the equator',
  );
}

// --- Saying so -------------------------------------------------------------

// The hint under the map is the only place a guide is told any of this, and it
// is the one line that goes stale silently when the gesture changes under it.
ok(
  /Dra for \u00e5 flytte \u00b7 Shift for \u00e5 snu/.test(pictureSrc) &&
    /Drag to move \u00b7 Shift to turn/.test(pictureSrc),
  'the hint says the map moves, in both languages, and says what Shift is for',
);
ok(
  /Flytt kartet: dra det/.test(pictureSrc) &&
    /Move the map: drag it/.test(pictureSrc) &&
    /Hold Shift/.test(pictureSrc),
  'and so does the label a screen reader reaches the frame by',
);
ok(
  !/Dra for \u00e5 snu \u00b7 rull/.test(pictureSrc) &&
    !/Drag to turn \u00b7 scroll/.test(pictureSrc),
  'with no leftover line still telling people a drag turns it',
);
ok(
  /cursor: grab/.test(css) && /cursor: grabbing/.test(css),
  'and the cursor over the frame is the one every draggable map uses',
);

// --- The eyeball copy ------------------------------------------------------

// Everything above asserts the sheet; none of it shows the sheet to anybody, and
// several of the things that matter most about a printed page — whether it fits,
// whether the shading is too heavy, whether the weather card looks like the
// panel it re-presents — are only answerable by looking.
//
// briefing-preview.html used to be that look, made by hand: the stylesheet
// pasted into a <style> block and four rendered sheets pasted under it. Having
// no generator, it was a snapshot of the sheet as it stood on the afternoon
// somebody assembled it, and by the time the charts had been restyled it showed
// the old markup under the new CSS — worse than nothing, because it looked
// current. So the harness writes it now, from the fixtures it already has, every
// time it runs. A preview that regenerates itself alongside the assertions
// cannot disagree with them.
//
// The variants are the four the sheet is most likely to be got wrong on rather
// than four pretty ones: the ordinary hourly forecast, the coarse one MET serves
// for a tour further out, a half-day of forecast (which should come out shorter,
// not emptier), and the heaviest page the app can produce — danger 4, every
// section on — which is the one that has to hold a single side of A4.
const PREVIEW = join(ROOT, 'briefing-preview.html');
const worstCase = render(
  makeData(DEFAULT_OPTIONS, { avalancheLevel: 4 }),
);
const variants = [
  [
    'The ordinary case — MET is hourly, so each block averages its six readings.',
    full,
  ],
  [
    'Further out, where MET has dropped to six-hourly (00/06/12/18 UTC): one reading per block, and MET\u2019s own periods rather than the fixed grid.',
    sixHourly,
  ],
  [
    'Only the afternoon forecast. Periods neither anchor covers are dropped, not printed as rows of dashes.',
    partial,
  ],
  [
    'The heaviest sheet the app can produce: danger 4, a long bulletin, four problems, both charts and the full table. This is the one that has to stay above the fold.',
    worstCase,
  ],
];
writeFileSync(
  PREVIEW,
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Briefing preview</title>
<!-- Generated by scripts/verify-briefing.mjs. Do not edit: run the harness. -->
<style>
${css}
body { margin: 0; padding: 24px; background: #5b6875; font-family: Inter, system-ui, sans-serif; }
.previewNote { max-width: 210mm; margin: 28px auto 8px; color: #fff; font-size: 13px; line-height: 1.5; }
.previewWrap { position: relative; width: 210mm; margin: 0 auto 40px; background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,.35); }
/* The fold marker is a sibling of the sheet rather than a child, so it sits
   outside --briefing-zoom and 297mm here really is one page of paper. */
.previewFold { position: absolute; left: 0; right: 0; top: 297mm; border-top: 1px dashed #d33; pointer-events: none; }
.previewFold span { position: absolute; right: 4px; top: 2px; font-size: 10px; color: #d33; }
</style>
</head>
<body>
${variants
  .map(
    ([note, html]) => `    <p class="previewNote">${note}</p>
    <div class="previewWrap">
      ${html}
      <div class="previewFold"><span>A4 page 1 ends</span></div>
    </div>
`,
  )
  .join('\n')}</body>
</html>
`,
);

rmSync(ENTRY, { force: true });
rmSync(BUNDLE, { force: true });

console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : ''),
);
console.log('Wrote briefing-preview.html');
process.exit(failures ? 1 : 0);
