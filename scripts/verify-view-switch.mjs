// Guards the 2D/3D switch against the ways it has been made to hang.
//
// The switch is not one mechanism but a handshake between four: a Leaflet map,
// a MapLibre map, a camera passed between them (src/viewCamera.ts), and the
// hand-over state machine in App.tsx. Nothing type-checks the handshake. Every
// failure it has had looked, from the inside, like code that ran fine — the
// press was received, the state was set, and then the view simply did not
// change, or changed several seconds later.
//
// The three that had to be found by hand, and which this script exists to stop
// coming back:
//
//   1. THE isStyleLoaded() DEADLOCK. MapLibre's `isStyleLoaded()` is false not
//      only before the style is up but any time a source has tiles in flight.
//      Pair it with `once('load')` — "run now if ready, else when it loads" —
//      and you get a trap: taken after the map's single `load` has gone by, a
//      false reading queues the work on an event that will never fire again.
//      The tilt was queued that way. Press 2D while any tile was arriving and
//      the switch was dead until the view was rebuilt.
//
//   2. THE `opening` GUARD ON THE WAY OUT. The tilt effect returned early
//      unless the view had been *entered* through the switch. A terrain view
//      reached any other way — or one whose hand-over offer had already been
//      withdrawn — therefore had a 2D button that set a flag and did nothing
//      else, permanently.
//
//   3. THE SEQUENTIAL HAND-OVER. The incoming map was built only after the
//      outgoing animation had finished, so its tile fetch ran after the tilt
//      instead of underneath it. The visible result was a finished picture
//      sitting frozen on screen for a second or more before the swap.
//
// None of these is expressible as a type, and all three are invisible in a
// build. So they are asserted here, against the source, plus one property that
// can be run for real: the arithmetic the overlap in (3) depends on.
//
// Run with:  node scripts/verify-view-switch.mjs   (needs Node >= 22)
// Wired into `pnpm test:viewswitch`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureTypeStripping } from './lib/type-stripping.mjs';
import { stripComments } from './lib/strip-comments.mjs';

ensureTypeStripping();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Comments in these files describe the bugs below at length, and would match
// almost every pattern this script searches for. Strip them: the checks are
// about what the code does.
const terrainSrc = stripComments(read('src/components/Map3DView.tsx'));
const appSrc = stripComments(read('src/App.tsx'));
const flatSrc = stripComments(read('src/components/Map.tsx'));
// Read raw: these are matched on selectors and declarations, and the rules in
// question are short enough that their bodies are unambiguous.
const appCss = read('src/App.module.css');
const terrainCss = read('src/components/Map3DView.module.css');
const rule = (css, selector) =>
  css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    if (detail) console.log(`        ${detail}`);
  }
};

// ---------------------------------------------------------------------------
// 1. The deadlock pattern is gone from the terrain view.
// ---------------------------------------------------------------------------
console.log('\n[1] deferred style work cannot be queued behind a past event');

// The shape of the bug: any `once('load', …)` reached by way of an
// isStyleLoaded() test, in either spelling.
const deadlock =
  /if\s*\(\s*map\.isStyleLoaded\(\)\s*\)[\s\S]{0,120}?map\.once\(\s*['"]load['"]/;
check(
  'no "isStyleLoaded() ? now : once(load)" pairing remains',
  !deadlock.test(terrainSrc),
  'this is the trap itself — isStyleLoaded() also goes false for tile ' +
    'traffic, so after the map has loaded once this drops the work forever; ' +
    'use whenStyleReady()',
);

check(
  'whenStyleReady() exists and remembers `load` rather than re-testing it',
  /const styleLoaded = new WeakSet<maplibregl\.Map>\(\)/.test(terrainSrc) &&
    /function whenStyleReady\(/.test(terrainSrc) &&
    /styleLoaded\.has\(map\)/.test(terrainSrc),
  'the helper is what makes "is the style up?" answerable after load',
);

check(
  'the map registers itself as loaded from inside its `load` handler',
  /map\.on\(['"]load['"],\s*\(\)\s*=>\s*\{\s*styleLoaded\.add\(map\)/.test(
    terrainSrc,
  ),
  'must be the first thing that handler does, before any other `load` ' +
    'listener gets a turn',
);

// Every remaining isStyleLoaded() must be inside the helper itself. Anywhere
// else it is the same misreading of the name, whatever it guards.
const strayReadiness = terrainSrc
  .split('\n')
  .map((line, i) => [i + 1, line])
  .filter(([, line]) => line.includes('isStyleLoaded()'))
  .filter(([n]) => {
    const helper = terrainSrc.slice(0, terrainSrc.indexOf('function whenStyleReady('));
    const helperStartLine = helper.split('\n').length;
    return n < helperStartLine || n > helperStartLine + 12;
  });
check(
  'isStyleLoaded() appears only inside whenStyleReady()',
  strayReadiness.length === 0,
  strayReadiness.map(([n, l]) => `line ${n}: ${l.trim()}`).join('; '),
);

// ---------------------------------------------------------------------------
// 2. The way out works however the view was entered.
// ---------------------------------------------------------------------------
console.log('\n[2] the flatten is not conditional on how 3D was reached');

const tiltGuard = terrainSrc.match(
  /const map = mapRef\.current;\s*\n\s*if \(!map \|\| ([^)]*)\) return;\s*\n\s*if \(!flatten && !opening\) return;/,
);
check(
  'the tilt effect gates on handBack only, then excludes just the tilt *up*',
  tiltGuard !== null && !tiltGuard[1].includes('opening'),
  tiltGuard
    ? `guard is "!map || ${tiltGuard[1]}" — \`opening\` in it kills the ` +
      'flatten as well as the open'
    : 'expected `if (!map || handBack) return;` followed by ' +
      '`if (!flatten && !opening) return;`',
);

check(
  'the flatten starts the camera moving without waiting for style readiness',
  /const stopWaiting = flatten \? \(run\(\), \(\) => \{\}\) : whenStyleReady\(map, run\)/.test(
    terrainSrc,
  ),
  'tilting down only takes relief away, so there is nothing to wait for — ' +
    'waiting here is what made the press feel ignored',
);

check(
  'the hand-over reports the standpoint the camera actually landed on',
  /onFlattenedRef\.current\?\.\(landed\)/.test(terrainSrc) &&
    /onFlattened\?: \(landed: ViewCamera\) => void/.test(
      read('src/components/Map3DView.tsx'),
    ),
  'the flat map opens on a prediction; this is the correction',
);

// ---------------------------------------------------------------------------
// 3. The incoming map loads during the outgoing animation, not after it.
// ---------------------------------------------------------------------------
console.log('\n[3] the two halves of a switch overlap');

check(
  'the flat map is mounted while the terrain view is still tilting',
  /\(view === '2d' \|\| holdover === '2d' \|\| prewarmFlat\)/.test(appSrc),
  'without a third arm here the Leaflet map is built only at the hand-over ' +
    'and the user waits out its tiles after the animation has finished',
);

check(
  'but not in the frame of the press itself',
  /if \(!flattening\) return;\s*\n\s*const first = requestAnimationFrame\([\s\S]{0,200}?requestAnimationFrame\([\s\S]{0,60}?setPrewarmFlat\(\s*true,?\s*\)/.test(
    appSrc,
  ),
  'mounting a Leaflet map costs main thread; spent on the tilt\u2019s first ' +
    'frames it reads as the switch stalling, which is the symptom being fixed',
);

check(
  'and it is released when the switch goes back the other way',
  /const handleShow3D = useCallback\(\(\) => \{[\s\S]{0,600}?setPrewarmFlat\(false\)/.test(
    appSrc,
  ),
  'nothing else retires it — left set, a Leaflet map stays alive under the ' +
    'terrain view for the rest of the session',
);

check(
  'the hand-over offer survives long enough for that map to take it up',
  /if \(!holdover && !flattening\) disarmViewHandoff\(\)/.test(appSrc),
  'withdrawing the offer while `flattening` would have the pre-built flat ' +
    'map open on the whole of Norway',
);

check(
  'pressing 2D arms the hand-over there and then',
  /const handleShow2D = useCallback\(\(\) => \{[\s\S]{0,200}?armViewHandoff\(\);/.test(
    appSrc,
  ),
  'the flat map mounts on this render, so the standpoint has to be offered ' +
    'before it does',
);

check(
  'the hand-over does not throw away a paint that already happened',
  !/const handleFlattened = useCallback\([\s\S]{0,400}?setFlatPainted\(false\)/.test(
    appSrc,
  ),
  'the flat map has been loading for the whole tilt; clearing `flatPainted` ' +
    'at the swap makes every hand-back wait for a second paint',
);

check(
  'pressing 2D clears the previous map\u2019s paint report instead',
  /const handleShow2D = useCallback\(\(\) => \{[\s\S]{0,300}?setFlatPainted\(false\)/.test(
    appSrc,
  ),
  'a fresh map is mounting, so the old report is not about it',
);

// The overlap in (3) puts two maps in the pane at once, which is only safe if
// the one that is merely loading behaves like it is underneath. It does not by
// default: Leaflet's container is positioned but declares no z-index, so its
// panes and this map's controls (z-index 1000+) are ranked against the page
// rather than against their own map — and the terrain view they are supposed
// to be under declares no z-index at all. The prewarm makes that overlap
// happen on every single hand-back, for the whole length of the tilt, so what
// used to be a brief flicker on the way in becomes a second set of controls
// sitting over the 3D view and swallowing clicks meant for it.
check(
  'the map that is only loading is confined to a layer of its own',
  /className=\{`\$\{styles\.flatLayer\}/.test(appSrc),
  'without a wrapper there is nothing to rank Leaflet\u2019s z-indices ' +
    'against, and they escape into the page',
);

check(
  'that layer is sealed off whenever the terrain view is the picture',
  /view === '3d' \? styles\.flatCovered/.test(appSrc) &&
    /isolation:\s*isolate/.test(rule(appCss, '.flatCovered')),
  '`isolation` is what makes the wrapper a stacking context; without it the ' +
    'wrapper is transparent to z-index and changes nothing',
);

check(
  'and it does not answer the pointer while it is behind another map',
  /pointer-events:\s*none/.test(rule(appCss, '.flatCovered')),
  'a click belongs to the map being looked at, not to the one loading behind it',
);

check(
  'the terrain view still claims no z-index of its own to be ranked by',
  !/z-index/.test(rule(terrainCss, '.root')),
  'the seal above assumes the terrain view wins on document order; giving ' +
    '.root a z-index would silently move the contest somewhere else',
);

check(
  'the flat map accepts the landing standpoint and applies it without animating',
  /function SyncTo\(/.test(flatSrc) &&
    /map\.setView\(there, zoom, \{ animate: false \}\)/.test(flatSrc) &&
    /<SyncTo camera=\{syncTo\} \/>/.test(flatSrc),
  'a pan during the tilt moves the camera off the predicted landing point',
);

// ---------------------------------------------------------------------------
// 4. The ceilings are ceilings, not the normal path.
// ---------------------------------------------------------------------------
console.log('\n[4] the fallback timers stay out of the way');

const num = (name, src = appSrc) => {
  const m = src.match(new RegExp(`${name} = (\\d+)`));
  return m ? Number(m[1]) : null;
};
const flatCeiling = num('FLAT_PAINT_TIMEOUT_MS');
const terrainCeiling = num('TERRAIN_PAINT_TIMEOUT_MS');
const fade = num('HANDBACK_FADE_MS');
const tilt = num('VIEW_TILT_MS', read('src/viewCamera.ts'));

check(
  'the two paint ceilings are separate numbers',
  flatCeiling !== null && terrainCeiling !== null,
  'one shared ceiling makes the flat map — which has had the whole tilt to ' +
    'load — wait as long as a terrain view being built from nothing',
);
check(
  'the flat map\u2019s ceiling is shorter than the terrain view\u2019s',
  flatCeiling < terrainCeiling,
  `flat ${flatCeiling}ms vs terrain ${terrainCeiling}ms`,
);
check(
  'a stalled hand-back cannot outlast the tilt by more than the tilt again',
  flatCeiling <= tilt * 2,
  `${flatCeiling}ms against a ${tilt}ms tilt — this is what the user reads ` +
    'as "it did not switch"',
);
check(
  'the fade is given at least the CSS transition it is matched to',
  fade >= 200,
  `HANDBACK_FADE_MS is ${fade}ms; --dur in src/index.css is 200ms`,
);

// ---------------------------------------------------------------------------
// 5. The arithmetic the overlap rests on, run for real.
// ---------------------------------------------------------------------------
//
// Building the flat map at the press rather than at the hand-over is only
// sound if the two agree on the zoom. They are computed by different routes:
//
//   at the press     Leaflet is handed toLeafletZoom(standing.zoom) — the
//                    terrain view's live, unrounded zoom — and snaps it itself
//   at the landing   the terrain view eases to flatZoom(zoom) and the flat map
//                    is told toLeafletZoom() of that
//
// If those disagree by a level, the map the user has been watching load jumps
// by a factor of two at the exact moment it is uncovered — the one thing the
// whole tilt exists to prevent. Leaflet snaps with Math.round and clamps to
// [minZoom, maxZoom], in that order, which is what is modelled here.
// ---------------------------------------------------------------------------
console.log('\n[5] the predicted zoom is the zoom that is landed on');

const { FLAT_MAX_ZOOM, FLAT_MIN_ZOOM, flatZoom, toLeafletZoom } = await import(
  '../src/viewCamera.ts'
);

const leafletSnap = (z) =>
  Math.min(FLAT_MAX_ZOOM, Math.max(FLAT_MIN_ZOOM, Math.round(z)));

const disagreements = [];
for (let z = FLAT_MIN_ZOOM - 2; z <= FLAT_MAX_ZOOM + 2; z += 0.05) {
  const zoom = Number(z.toFixed(2));
  const atPress = leafletSnap(toLeafletZoom(zoom));
  const atLanding = leafletSnap(toLeafletZoom(flatZoom(zoom)));
  if (atPress !== atLanding) disagreements.push(`${zoom}: ${atPress}/${atLanding}`);
}
check(
  'every zoom the terrain view can hold predicts its own landing level',
  disagreements.length === 0,
  `first few: ${disagreements.slice(0, 5).join(', ')}`,
);

check(
  'flatZoom() always lands inside the range the flat map can actually hold',
  [2, 3, 7.4, 12.5, 12.49, 17, 18, 19, 25].every((z) => {
    const l = toLeafletZoom(flatZoom(z));
    return l >= FLAT_MIN_ZOOM && l <= FLAT_MAX_ZOOM;
  }),
  'a standpoint outside the range is clamped at the swap, and a clamp is a jump',
);

check(
  'flatZoom() is idempotent, so re-rounding an interrupted tilt cannot drift',
  [3.2, 7.4, 12.5, 12.49, 16.8].every((z) => flatZoom(flatZoom(z)) === flatZoom(z)),
  'the flatten rounds once when it starts easing and again when it lands',
);

console.log(
  failures === 0
    ? '\nAll view-switch checks passed.\n'
    : `\n${failures} view-switch check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
