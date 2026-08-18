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
//
// Rendering is done by bundling the sheet with esbuild and importing it under
// react-dom/server. The bundle is written into the repo (not /tmp) so Node can
// resolve react from node_modules, and removed again afterwards.
//
// Run with:  node scripts/verify-briefing.mjs   (needs Node >= 22.18)
// Wired into `pnpm test:briefing`.

import { ensureTypeStripping } from './lib/type-stripping.mjs';
ensureTypeStripping();

import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

section('Section switches');

const allOn = { ...DEFAULT_OPTIONS };
ok(
  OPTION_KEYS.every((k) => typeof DEFAULT_OPTIONS[k] === 'boolean'),
  'defaults cover every option key',
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

// ---------------------------------------------------------------------------
// 2. Reading a gridded model
// ---------------------------------------------------------------------------

const { summariseSnow } = await import(
  pathToFileURL(join(ROOT, 'src/briefing/snowSummary.ts')).href
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
  // has no bearing on the markup.
  external: ['react', 'react-dom', 'react-dom/server'],
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
    ...over,
  };
}

/** Every combination of the seven switches, with the dependency applied — 128
 *  nominal, fewer distinct, and all of them reachable by clicking. */
const combos = [];
for (let mask = 0; mask < 128; mask++) {
  const raw = {};
  OPTION_KEYS.forEach((k, i) => {
    raw[k] = Boolean(mask & (1 << i));
  });
  combos.push(withDependencies(raw));
}

const BAD = ['NaN', 'undefined', 'Infinity', 'null cm', '[object Object]'];

/** React splices `<!-- -->` between adjacent text expressions. A reader sees
 *  one continuous line, so the harness should read one too — otherwise a
 *  heading like "Weather · MET · Sat 14 March 2026" is unmatchable. */
const plain = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

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

/** The body of the weather table, comments stripped. */
const tbody = (html) =>
  plain(html).split('<tbody>')[1]?.split('</tbody>')[0] ?? '';

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
  ok(
    options.snow === html.includes('seNorge'),
    `[${name}] seNorge is credited when its depths are printed`,
  );
  ok(
    options.weather === html.includes('MET Norway'),
    `[${name}] MET is credited when its forecast is printed`,
  );

  // When the profile is drawn it is coloured by slope only if asked; the plain
  // teal is the planner's own route colour.
  const colouredBySlope = /stroke="#(?!0f766e)[0-9a-f]{6}"/i.test(html);
  ok(
    options.steepness === colouredBySlope,
    `[${name}] the profile is coloured by slope only when steepness is on`,
  );
}
ok(renderedAll === 128, 'every switch combination rendered');

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
  coarseCells[4] === '0.4\u20132.6',
  `a coarse row prints MET's six-hour precipitation band (got ${coarseCells[4]})`,
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
  rowCells(mixed, '18\u201324')[4] === '9.0',
  `the coarse row prints its own total, not a rate (got ${rowCells(mixed, '18\u201324')[4]})`,
);
ok(
  rowCells(mixed, '18\u201324')[4] !== '1.5',
  'a six-hour total is not divided down into the hours it covers',
);
ok(
  rowCells(mixed, '06\u201309')[4] === '3.0',
  `an hourly row still sums its three hours (got ${rowCells(mixed, '06\u201309')[4]})`,
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
// Index 1 is the sky column, which holds an icon and so reads as empty text.
ok(
  aggCells[2] === '10\u00b0',
  `temperature is the period's average (got ${aggCells[2]})`,
);
ok(
  aggCells[3] === '\u00d8 5 (22)' || aggCells[3] === 'E 5 (22)',
  `mean wind averages and the gust takes the period's peak (got ${aggCells[3]})`,
);
// 6.0 rather than 6: precipitation under 10 mm keeps one decimal, which is the
// same rule the weather panel uses. What matters here is the 6 — averaging
// would have printed 2.0, understating the period threefold.
ok(
  Number(aggCells[4]) === 6,
  `precipitation sums across the period rather than averaging (got ${aggCells[4]})`,
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
  /^N /.test(wrapCells[3]),
  `directions either side of north average to north (got ${wrapCells[3]})`,
);
// Averaged as plain numbers these three come to 237° — a southwesterly, which is
// the wrong half of the compass. Any southerly answer is the bug, so the check is
// on the letter rather than on one wrong value.
ok(
  !/^S/.test(wrapCells[3]),
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
  gappyCells[6] === '\u2013' &&
    gappyCells[7] === '\u2013' &&
    gappyCells[8] === '\u2013',
  "the anchor missing that period prints dashes across its figures",
);
// And no icon, rather than a stale or invented one: an icon with no reading
// behind it is the one cell on the row that would look like data.
ok(
  gappyCells[5] === '' && rowIcons(gappy, '12\u201315').length === 1,
  'the missing anchor draws no sky icon',
);
ok(
  gappyCells[2] !== '\u2013',
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

rmSync(ENTRY, { force: true });
rmSync(BUNDLE, { force: true });

console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : ''),
);
process.exit(failures ? 1 : 0);
