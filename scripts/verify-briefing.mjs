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
    });
  }
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
    `[${name}] the weather heading carries the tour date`,
  );
  ok(
    options.snow ===
      /(Sn\u00f8dybde|Snow depth) \u00b7 seNorge \u00b7 [^<]*2026/.test(flat),
    `[${name}] the snow heading carries the date it was modelled for`,
  );

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

// Both anchors present: the two forecasts share rows rather than stacking two
// tables, and a full day is thinned to daylight hours at three-hour steps —
// 06, 09, 12, 15, 18, 21. A briefing does not need 03:00.
const paired = render(makeData(DEFAULT_OPTIONS));
const bodyRows = (paired.split('<tbody>')[1] ?? '').split('<tr').length - 1;
ok(bodyRows === 6, `a full day thins to six daylight rows (got ${bodyRows})`);
ok(
  (paired.match(/briefingGroupHead/g) ?? []).length === 2,
  'both anchors get their own column group',
);

// A hole in one anchor's series must leave a gap in that anchor's columns, not
// pull the following hour's numbers up a row against the other anchor's.
const gappy = render(
  makeData(DEFAULT_OPTIONS, {
    weatherHigh: {
      elevationM: 1480,
      hours: hours({ skip: [12] }),
      fetchedAt: HIGH_FETCHED_AT,
    },
  }),
);
const gappyRows = (gappy.split('<tbody>')[1] ?? '').split('<tr').length - 1;
ok(gappyRows === 6, 'a missing hour on one anchor does not drop a row');
ok(
  gappy.includes('\u2013'),
  'the missing hour prints as a dash rather than the next hour\u2019s numbers',
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
  'the weather heading still names MET and the tour date',
);
ok(
  retrievedLines(noWeatherFetch).length === 2,
  'the weather section drops its retrieval line while the others keep theirs',
);
ok(
  !retrievedLines(noWeatherFetch).some((line) => /07:32|09:53/.test(line)),
  'no other section inherits the weather timestamps',
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
  headings(noFetch).some((h) => /Varsom/.test(h)),
  'the avalanche heading still names its source',
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
