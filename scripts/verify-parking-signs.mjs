// Guards the parking signs on the map, and the highlight that ties a sign to
// its row in the Parking tab.
//
// The signs are permanent — five blue P plates standing on the five lots the
// Parking tab lists — and pointing at either a row or a sign lights that lot
// and fades the rest. None of what can go wrong with that is expressible as a
// type, and all of it is invisible in a build:
//
//   1. THE ANCHOR OFF THE GROUND. A divIcon is positioned by its iconAnchor. A
//      sign standing on a post marks the spot at the FOOT of the post, so the
//      anchor has to be [middle of plate, full height of the box]. Inherit
//      Leaflet's default, or centre it as the old numbered circle did, and
//      every sign silently marks a spot ~18px up-screen from the lot it names
//      — tens of metres at trailhead zoom, on the wrong side of a river often
//      enough to matter. Nothing about that looks like a bug; the sign is
//      there, it is just not where the car park is.
//
//   2. THE SCALE THAT MOVES WHAT IT HIGHLIGHTS. Hover grows the sign. CSS
//      scales about an element's centre by default, which walks the plate off
//      its lot at the exact moment the reader is being told which lot it is.
//      transform-origin has to be the anchor, and the two are written in
//      different units in different places, so they drift apart quietly.
//
//   3. THE UNCONDITIONAL CLEAR. Moving the pointer from row 2 to row 3 fires
//      enter(3) BEFORE leave(2). A leave handler that clears whatever is
//      hovered therefore erases the highlight the enter just set, and the
//      symptom is a highlight that works when approached slowly and dies when
//      the reader drags down the list. Hence clearHoveredParkingId(id), which
//      clears only if that id is still the current one.
//
//   4. THE STALE ID THAT FADES EVERYTHING. Fading the others is conditioned on
//      something being hovered. Move the radius slider while the pointer rests
//      on a row and the list is replaced under it: the hovered id now names a
//      lot that is not on the map, and every remaining sign fades to highlight
//      nothing at all.
//
// So: the geometry is computed for real from the module the map uses, the
// handlers are asserted against the source, and the three states are rendered
// to a picture at scripts/parking-signs.png for a human to look at.
//
// Run with:  node scripts/verify-parking-signs.mjs   (needs Node >= 22)
// Wired into `pnpm test:parking`.

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WEB } from './lib/tree.mjs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

// esbuild strips the types off src/parking/sign.ts so the geometry below is the
// real thing rather than numbers copied out of it. It is not a declared
// dependency — it arrives with vite, which is why this is a dev-only script and
// says so plainly when it is missing.
let build;
try {
  ({ build } = await import('esbuild'));
} catch {
  console.error(
    'esbuild not resolvable. It normally arrives with vite; run `pnpm install`.',
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
// Everything read below is under the web app's src/, so `root` here means the
// web package, not the repository. See lib/tree.mjs.
const root = WEB;
const src = (p) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) failures++;
}

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// The geometry, computed from the modules the maps actually render. esbuild
// strips the types; none of the three pulls in a browser or a map at import
// time, which is the whole reason they live apart from the renderers.
//
// signImage.ts is loadable here despite being the MapLibre half because its
// maplibre import is `import type` and the only line that touches `document` is
// inside the baking function, which nothing below calls.
// ---------------------------------------------------------------------------

// The bundled source is kept alongside the imported module: the picture at the
// bottom re-runs the canvas painter inside the browser, off this same text, so
// the two painters in the screenshot are two painters and not one plus a
// transcription.
async function load(entry) {
  const bundled = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'neutral',
  });
  const text = bundled.outputFiles[0].text;
  const module = await import(
    'data:text/javascript;base64,' + Buffer.from(text).toString('base64')
  );
  return { module, text };
}

const { module: signModule, text: signSource } = await load('src/parking/sign.ts');
const { module: signsModule } = await load('src/parking/signs.ts');
const { module: imageModule } = await load('src/parking/signImage.ts');

const {
  SIGN,
  POST_H,
  POST_W,
  POST_OUTLINE_W,
  POST_OUTLINE,
  BADGE,
  BADGE_RING,
  BADGE_OUTER,
  PLATE,
  PLATE_RING,
  OVERHANG,
  W,
  H,
  ANCHOR,
  IMAGE_W,
  IMAGE_H,
  IMAGE_PAD_LEFT,
  GROW,
  DIM,
  POST_COLOR,
} = signModule;
const { parkingSigns, plainParkingSigns } = signsModule;

// (1) The anchor is the foot of the post, not the middle of the plate.
check(
  'icon box is overhang + plate + post tall',
  H === OVERHANG + SIGN + POST_H,
  `H=${H}, expected ${OVERHANG + SIGN + POST_H}`,
);
check(
  'icon box is wide enough for the badge overhang',
  W === SIGN + OVERHANG,
  `W=${W}, expected ${SIGN + OVERHANG}`,
);
check(
  'badge overhang is half the badge',
  OVERHANG === BADGE / 2,
  `OVERHANG=${OVERHANG}, BADGE=${BADGE}`,
);
check(
  'anchor y is the foot of the post (the bottom of the box)',
  ANCHOR[1] === H,
  `anchor y=${ANCHOR[1]}, box height=${H}`,
);
check(
  'anchor x is the middle of the plate, so the post is plumb under it',
  ANCHOR[0] === SIGN / 2,
  `anchor x=${ANCHOR[0]}, plate middle=${SIGN / 2}`,
);
// The failure this is really about: the plate must sit clear ABOVE the anchor,
// so the sign stands on the point rather than covering it.
check(
  'the whole plate is above the anchor',
  OVERHANG + SIGN < ANCHOR[1],
  `plate bottom=${OVERHANG + SIGN}, anchor y=${ANCHOR[1]}`,
);

// (2) Growing on hover pivots on that same anchor.
const hoveredHtml = signModule.parkingSignHtml(3, 'hovered');
const plainHtml = signModule.parkingSignHtml(3, 'plain');
const dimmedHtml = signModule.parkingSignHtml(3, 'dimmed');

const origin = /transform-origin:([\d.]+)px ([\d.]+)px/.exec(hoveredHtml);
check('hovered sign declares a transform-origin', origin !== null);
if (origin) {
  check(
    'transform-origin is the anchor, so growing never moves the sign',
    Number(origin[1]) === ANCHOR[0] && Number(origin[2]) === ANCHOR[1],
    `origin=${origin[1]},${origin[2]} anchor=${ANCHOR[0]},${ANCHOR[1]}`,
  );
}
check(
  'hovered sign grows',
  hoveredHtml.includes(`scale(${GROW})`) && GROW > 1,
  `GROW=${GROW}`,
);
check(
  'only the hovered sign grows',
  !plainHtml.includes('scale(') && !dimmedHtml.includes('scale('),
);
check(
  'dimmed signs fade, and fade enough to read as fading',
  dimmedHtml.includes(`opacity:${DIM}`) && DIM > 0 && DIM < 0.6,
  `DIM=${DIM}`,
);
check(
  'a plain sign is at full strength',
  !plainHtml.includes('opacity:'),
  'nothing is faded when nothing is hovered',
);
check(
  'the hovered sign is not faded',
  !hoveredHtml.includes('opacity:'),
);
check(
  'every state says P and carries its list number',
  [plainHtml, hoveredHtml, dimmedHtml].every(
    (h) => h.includes('>P<') && h.includes('>3<'),
  ),
);

// ---------------------------------------------------------------------------
// The wiring, asserted against the source.
// ---------------------------------------------------------------------------

const layer = src('src/components/ParkingLayer.tsx');
const panel = src('src/components/ParkingPanel.tsx');
const store = src('src/parking/hover.ts');

// (3) The release is conditional on still owning the highlight.
check(
  'releasing the highlight is conditional on still holding it',
  /export function releaseParkingHighlight\(id: string\) \{\s*if \(current !== id\) return;/.test(
    store,
  ),
  'an unconditional release loses the highlight when crossing row to row',
);
check(
  'the panel row releases by id, never blindly',
  panel.includes('releaseParkingHighlight(area.id)'),
);
check(
  'the sign releases by id, never blindly',
  layer.includes('releaseParkingHighlight(sign.id)'),
);
// The two stores are one highlight, and stay one because only the pair in
// parking/hover touches them. A component reaching past it for setHoverPoint is
// how the sign and the dot come to point at different lots.
check(
  'the sign highlight and the coordinate dot move together',
  /setHoverPoint\(point, PARKING_PIN_COLOR\)/.test(store) &&
    /setHoverPoint\(null\)/.test(store),
);
check(
  'neither the panel nor the layer sets the dot behind the pair’s back',
  !panel.includes('setHoverPoint(') && !layer.includes('setHoverPoint('),
  'the two stores drift apart the moment a component drives one of them alone',
);

// The signs must be unconditional. If the layer ever renders them only while
// something is hovered, the map loses the thing that shows where to park.
//
// `signs.map`, not `areas.map`: the layer still calls areas.map, for the map of
// names its tooltips read, so testing for that would pass no matter what the
// markers were driven from.
check(
  'signs are drawn for every area, not only the hovered one',
  /signs\.map\(/.test(layer) && !/hovered\s*&&\s*<Marker/.test(layer),
);
check(
  'the layer bails out only when there is nothing to show',
  /if \(areas\.length === 0\) return null;/.test(layer),
);

// Both ends light the highlight, and the row reaches it by keyboard too.
check(
  'hovering a row lights its sign',
  /onMouseEnter=\{take\}/.test(panel) &&
    /takeParkingHighlight\(area\.id, area\.point\)/.test(panel),
);
check(
  'hovering a sign lights it as well',
  /mouseover: \(\) => takeParkingHighlight\(sign\.id, sign\.point\)/.test(layer),
);
check(
  'focusing a row lights its sign, so the list works from the keyboard',
  /onFocus=\{take\}/.test(panel) && /tabIndex=\{0\}/.test(panel),
);
check(
  'a row taken away while hovered releases the highlight',
  /useEffect\(\s*\(\) => \(\) => \{[\s\S]{0,200}releaseParkingHighlight\(area\.id\)/.test(
    panel,
  ),
  'switching tabs mid-hover fires no mouseleave',
);
// The lit sign has to come out on top of the ones it grew behind.
check(
  'the lit sign is lifted above its neighbours',
  /zIndexOffset=\{hovered \? (\d+) : (\d+)\}/.test(layer) &&
    (([, hi, lo]) => Number(hi) > Number(lo))(
      /zIndexOffset=\{hovered \? (\d+) : (\d+)\}/.exec(layer),
    ),
);
// The tooltip clears the plate, not just the anchor down at the post's foot.
check(
  'the tooltip opens clear of the plate',
  layer.includes('offset={[0, -(H - OVERHANG)]}'),
);

// The post used to be white to match the plate's ring, and vanished against
// snowfield and the pale paper of the topo tiles — the very terrain a trailhead
// lot sits on. A screenshot on one basemap would not have shown it.
check(
  'the post is not white, so it survives snow and pale tiles',
  POST_COLOR.toLowerCase() !== '#ffffff' && POST_COLOR.toLowerCase() !== '#fff',
  `POST_COLOR=${POST_COLOR}`,
);
check(
  'the post is outlined, so it survives dark forest and the steepness overlay',
  /box-shadow:0 0 0 1px rgba\(255,255,255/.test(plainHtml),
);

// The panel badge and the sign share a colour, and CSS modules cannot read the
// TS constant, so the duplicate is checked instead of trusted.
const pinTs = src('src/parking/pin.ts');
const panelCss = src('src/components/ParkingPanel.module.css');
const pinColor = /PARKING_PIN_COLOR = '(#[0-9a-fA-F]{6})'/.exec(pinTs)?.[1];
check('parking/pin.ts still declares the colour', Boolean(pinColor));
if (pinColor) {
  check(
    'the row badge is the same blue as the sign',
    panelCss.toLowerCase().includes(pinColor.toLowerCase()),
    `pin.ts says ${pinColor}`,
  );
  check(
    'the sign is drawn in that blue',
    plainHtml.toLowerCase().includes(pinColor.toLowerCase()),
  );
}

// ---------------------------------------------------------------------------
// (4) The numbering, and the hovered id that has left the list. Both used to
// live inside ParkingLayer and were grepped for there. Four renderers draw
// these signs now — the planner's two maps and the briefing's two — so the rule
// moved to parking/signs.ts, and a rule is better tested by running it than by
// matching the shape of the line that implements it. The renderers are then
// only checked for asking it, further down.
// ---------------------------------------------------------------------------

const lots = [
  { id: 'a', point: [61.5, 8.1] },
  { id: 'b', point: [61.6, 8.2] },
  { id: 'c', point: [61.7, 8.3] },
];
const nOf = (signs) => signs.map((s) => s.n);
const stateOf = (signs) => signs.map((s) => s.state);

const cold = parkingSigns(lots, null);
check(
  'signs are numbered 1..n in the order the Parking tab lists them',
  eq(nOf(cold), [1, 2, 3]) && eq(cold.map((s) => s.id), ['a', 'b', 'c']),
  `got ${JSON.stringify(nOf(cold))}`,
);
check(
  'the numbering follows the list, so sign 3 and row 3 are the same lot',
  eq(
    cold.map((s) => s.point),
    lots.map((l) => l.point),
  ),
  'nothing here may sort or filter — the fetcher decided which five they are',
);
check(
  'with nothing hovered, every sign is plain',
  eq(stateOf(cold), ['plain', 'plain', 'plain']),
  `got ${JSON.stringify(stateOf(cold))}`,
);

const litMiddle = parkingSigns(lots, 'b');
check(
  'the hovered lot is lit and the others fade back',
  eq(stateOf(litMiddle), ['dimmed', 'hovered', 'dimmed']),
  `got ${JSON.stringify(stateOf(litMiddle))}`,
);
check(
  'lighting one does not renumber the rest',
  eq(nOf(litMiddle), [1, 2, 3]),
);

// The failure this rule exists for: the radius slider moves while the pointer
// rests on a row, the list is replaced under it, and the id in the store now
// names a lot that is not on the map. Honouring it fades all five signs to
// highlight nothing at all.
const stale = parkingSigns(lots, 'gone');
check(
  'a hovered id not in the current list highlights nothing',
  !stale.some((s) => s.state === 'hovered'),
);
check(
  'a hovered id not in the current list fades nothing either',
  eq(stateOf(stale), ['plain', 'plain', 'plain']),
  'otherwise a re-fetch under the pointer dims every sign for no reason',
);
check(
  'an empty list is no signs rather than a throw',
  eq(parkingSigns([], 'a'), []) && eq(plainParkingSigns([]), []),
);

// The paper's own entry point: same numbering, no hovering, and no invented ids.
const printed = plainParkingSigns(lots.map((l) => l.point));
check(
  'the printed sheet numbers its signs exactly as the screen does',
  eq(nOf(printed), nOf(cold)) &&
    eq(
      printed.map((s) => s.point),
      cold.map((s) => s.point),
    ),
  'a sheet whose sign 3 is the screen’s sign 2 is worse than a sheet with none',
);
check(
  'every printed sign is plain, there being no pointer on paper',
  eq(stateOf(printed), ['plain', 'plain', 'plain']),
);
check(
  'the printed signs carry no lot id, rather than a made-up one',
  printed.every((s) => !('id' in s)),
);

// ---------------------------------------------------------------------------
// (5) The bitmap and the symbol layer, which is how both 3D views draw these.
//
// MapLibre anchors an icon by a named edge of its image, not by a point inside
// it, so the divIcon's iconAnchor has no equivalent: the only anchor that puts
// the foot of the post on the lot is 'bottom' — the middle of the bitmap's
// bottom edge — and the bitmap therefore has to be padded until its horizontal
// middle IS the anchor. The box's own middle is not, because the badge hangs off
// the right and nothing balances it on the left. Get this wrong and every sign
// in 3D stands a few metres east of its car park, on both the planner's view and
// the printed one, which is the same failure the divIcon's anchor exists to
// avoid and is invisible in any single screenshot.
// ---------------------------------------------------------------------------

check(
  'the bitmap is the icon box plus padding for the badge on both sides',
  IMAGE_W === SIGN + 2 * OVERHANG,
  `IMAGE_W=${IMAGE_W}, expected ${SIGN + 2 * OVERHANG}`,
);
check(
  'the bitmap’s middle is the anchor, so “bottom” lands on the lot',
  IMAGE_PAD_LEFT + ANCHOR[0] === IMAGE_W / 2,
  `pad=${IMAGE_PAD_LEFT} + anchor x=${ANCHOR[0]} != ${IMAGE_W / 2}`,
);
check(
  'the padded box still fits the bitmap, so nothing is clipped',
  IMAGE_PAD_LEFT + W <= IMAGE_W,
  `pad=${IMAGE_PAD_LEFT} + W=${W} > IMAGE_W=${IMAGE_W}`,
);
check(
  'the bitmap is a pixel taller than the box, for the post’s outline',
  IMAGE_H === H + POST_OUTLINE_W,
  `IMAGE_H=${IMAGE_H}, expected ${H + POST_OUTLINE_W}`,
);

const layout = imageModule.PARKING_SIGN_LAYOUT;
const paint = imageModule.PARKING_SIGN_PAINT;
check(
  'the symbol layer anchors on the bottom edge',
  layout['icon-anchor'] === 'bottom',
  `icon-anchor=${layout['icon-anchor']}`,
);
check(
  'and offsets by the outline pixel, so the foot and not the outline is on the lot',
  eq(layout['icon-offset'], [0, POST_OUTLINE_W]),
  `icon-offset=${JSON.stringify(layout['icon-offset'])}`,
);
// Five lots at a trailhead are routinely 50 m apart. MapLibre's default is to
// drop a symbol colliding with one already placed, which would show four of the
// five numbered rows with no hint which one is missing.
check(
  'no sign is dropped for colliding with its neighbour',
  layout['icon-allow-overlap'] === true &&
    layout['icon-ignore-placement'] === true,
);
// Hover in 3D is the same two changes as on the flat maps, by expression rather
// than by restyling a marker — and off the same two constants, so the growing
// and the fading cannot come out at one strength on one map and another on the
// next.
check(
  'the lit sign grows in 3D by the same amount as on the flat maps',
  eq(layout['icon-size'], ['case', ['==', ['get', 'state'], 'hovered'], GROW, 1]),
  `icon-size=${JSON.stringify(layout['icon-size'])}`,
);
check(
  'the others fade in 3D by the same amount as on the flat maps',
  eq(paint['icon-opacity'], ['case', ['==', ['get', 'state'], 'dimmed'], DIM, 1]),
  `icon-opacity=${JSON.stringify(paint['icon-opacity'])}`,
);

// The features the layer reads. Route and parking coordinates are [lat, lng]
// everywhere in this codebase and GeoJSON wants [lng, lat]; getting the swap
// wrong puts a Norwegian trailhead off Somalia on a good day and in the next
// valley on a bad one, which is the kind that ships.
const collection = imageModule.parkingSignsGeoJSON(parkingSigns(lots, 'b'));
check(
  'every sign becomes a feature',
  collection.type === 'FeatureCollection' && collection.features.length === 3,
);
check(
  'the coordinates are swapped to GeoJSON order, not passed through',
  eq(
    collection.features.map((f) => f.geometry.coordinates),
    lots.map((l) => [l.point[1], l.point[0]]),
  ),
  'a sign at 8.1°N 61.5°E is in the Arabian Sea',
);
check(
  'the features carry the number, the state and the lot',
  eq(
    collection.features.map((f) => [
      f.properties.n,
      f.properties.state,
      f.properties.id,
    ]),
    [
      [1, 'dimmed', 'a'],
      [2, 'hovered', 'b'],
      [3, 'dimmed', 'c'],
    ],
  ),
);
// The sprite id is put on the feature by the same function that bakes it, rather
// than assembled by an expression in the style — two places building
// 'parking-sign-3' is two places to spell it, and the symptom of a mismatch is a
// map with no signs and one warning in a console nobody printed.
check(
  'the icon on each feature is the id the baker answers to',
  collection.features.every(
    (f, i) => f.properties.icon === imageModule.parkingSignIcon(i + 1),
  ),
  `got ${JSON.stringify(collection.features.map((f) => f.properties.icon))}`,
);
check(
  'the layer reads that id off the feature rather than building its own',
  eq(layout['icon-image'], ['get', 'icon']),
  `icon-image=${JSON.stringify(layout['icon-image'])}`,
);
// The printed maps are handed bare coordinates, so their features have no lot.
// Null rather than absent, so a reader of the property can tell "no lot" from
// "no such property" — and so queryRenderedFeatures in the planner gets a value
// it can type-check rather than undefined.
check(
  'a sign with no lot behind it says so with null',
  imageModule.parkingSignsGeoJSON(printed).features.every(
    (f) => f.properties.id === null,
  ),
);
check(
  'an empty list is still a valid empty FeatureCollection',
  eq(imageModule.parkingSignsGeoJSON([]), {
    type: 'FeatureCollection',
    features: [],
  }),
  'every caller declares this source before it has any lots to put in it',
);

// ---------------------------------------------------------------------------
// (6) ONE SIGN, TWO PAINTERS. The markup above is drawn by a browser laying out
// HTML; the printed flat map and both 3D bitmaps are drawn by drawParkingSign
// onto a canvas. A sign that is 26 px wide on screen and 22 on paper is not a
// bug anyone reports — it is an export that quietly does not look like the
// screen it came from — so the two are compared part by part here.
//
// The canvas painter is run against a recording stub rather than a real
// context: what is being checked is where it puts things, and a stub can be
// asked, whereas a screenshot has to be looked at. It tracks translate/scale
// because the painter uses both, and it is the reason the hover checks below
// can assert that growing does not move the foot of the post.
// ---------------------------------------------------------------------------

function recordSign(n, state) {
  const ops = [];
  let m = { a: 1, d: 1, e: 0, f: 0 };
  const stack = [];
  let path = [];
  const at = (x, y) => [m.a * x + m.e, m.d * y + m.f];
  const span = (pts) => ({
    x0: Math.min(...pts.map((p) => p[0])),
    x1: Math.max(...pts.map((p) => p[0])),
    y0: Math.min(...pts.map((p) => p[1])),
    y1: Math.max(...pts.map((p) => p[1])),
  });
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: '',
    textBaseline: '',
    save() {
      stack.push({ m: { ...m }, alpha: this.globalAlpha });
    },
    restore() {
      const s = stack.pop();
      if (s) {
        m = s.m;
        this.globalAlpha = s.alpha;
      }
    },
    translate(dx, dy) {
      m.e += m.a * dx;
      m.f += m.d * dy;
    },
    scale(sx, sy) {
      m.a *= sx;
      m.d *= sy;
    },
    beginPath() {
      path = [];
    },
    closePath() {},
    moveTo(x, y) {
      path.push(at(x, y));
    },
    lineTo(x, y) {
      path.push(at(x, y));
    },
    // The control point of an arcTo is the corner the arc is cutting, which is
    // exactly the bounding box's corner — so a rounded rectangle's extent comes
    // out right without tracing the curves.
    arcTo(x1, y1, x2, y2) {
      path.push(at(x1, y1), at(x2, y2));
    },
    arc(cx, cy, r) {
      path.push(at(cx - r, cy - r), at(cx + r, cy + r));
    },
    fillRect(x, y, w, h) {
      ops.push({
        op: 'rect',
        style: this.fillStyle,
        alpha: this.globalAlpha,
        ...span([at(x, y), at(x + w, y + h)]),
      });
    },
    fill() {
      ops.push({
        op: 'fill',
        style: this.fillStyle,
        alpha: this.globalAlpha,
        ...span(path),
      });
    },
    stroke() {
      ops.push({
        op: 'stroke',
        style: this.strokeStyle,
        width: this.lineWidth * m.a,
        alpha: this.globalAlpha,
        ...span(path),
      });
    },
    fillText(text, x, y) {
      const [tx, ty] = at(x, y);
      ops.push({
        op: 'text',
        text,
        x: tx,
        y: ty,
        font: this.font,
        style: this.fillStyle,
        align: this.textAlign,
        baseline: this.textBaseline,
        alpha: this.globalAlpha,
      });
    },
  };
  // Planted on the origin, so every recorded coordinate is already relative to
  // the anchor and adding ANCHOR back gives the markup's own box coordinates.
  signModule.drawParkingSign(ctx, 0, 0, n, state);
  return ops;
}

const r3 = (v) => Math.round(v * 1000) / 1000;
// A recorded op in the markup's box coordinates: x from the left edge of the
// icon box, y from its top, which is what the CSS `left`/`top` below are.
const inBox = (o, grow = 0) => ({
  x: r3(o.x0 - grow + ANCHOR[0]),
  y: r3(o.y0 - grow + ANCHOR[1]),
  w: r3(o.x1 - o.x0 + 2 * grow),
  h: r3(o.y1 - o.y0 + 2 * grow),
});
const atBox = (o) => ({ x: r3(o.x + ANCHOR[0]), y: r3(o.y + ANCHOR[1]) });

// The markup's own geometry, read back out of the string it produces — so the
// comparison is against what the browser is told, not against a second copy of
// the numbers.
const styleNum = (style, prop) => {
  const m = new RegExp(`(?:^|;)${prop}:(-?[\\d.]+)(?:px)?(?:;|$)`).exec(style);
  return m === null ? null : Number(m[1]);
};
// A CSS `border` grows outwards from the content box — `width` is the content —
// so the painted part of a bordered box is width + 2 * border. This is the one
// piece of arithmetic the canvas painter has to reproduce by hand, and the one
// it has got wrong twice.
const styleBorder = (style) => Number(/(?:^|;)border:([\d.]+)px solid/.exec(style)?.[1] ?? 0);
const styleFont = (style) => /(?:^|;)font:([^;]*)/.exec(style)?.[1] ?? null;

const parts = [...plainHtml.matchAll(/<div style="([^"]*)"/g)].map((m) => m[1]);
check(
  'the markup is a box holding a post, a plate and a badge',
  parts.length === 4,
  `${parts.length} divs, expected 4`,
);
const [wrapperCss, postCss, plateCss, badgeCss] = parts;

const cssPost = {
  x: styleNum(postCss, 'left'),
  y: styleNum(postCss, 'top'),
  w: styleNum(postCss, 'width'),
  h: styleNum(postCss, 'height'),
};
const plateRing = styleBorder(plateCss);
const cssPlate = {
  x: styleNum(plateCss, 'left'),
  y: styleNum(plateCss, 'top'),
  w: styleNum(plateCss, 'width') + 2 * plateRing,
  h: styleNum(plateCss, 'height') + 2 * plateRing,
};
const cssPlateBlue = {
  x: cssPlate.x + plateRing,
  y: cssPlate.y + plateRing,
  w: styleNum(plateCss, 'width'),
  h: styleNum(plateCss, 'height'),
};
const badgeRing = styleBorder(badgeCss);
const cssBadge = {
  // `right:0` pins the border box's right edge to the wrapper's, so the left
  // edge is however wide the painted disc turns out to be.
  x:
    styleNum(wrapperCss, 'width') -
    styleNum(badgeCss, 'right') -
    (styleNum(badgeCss, 'width') + 2 * badgeRing),
  y: styleNum(badgeCss, 'top'),
  w: styleNum(badgeCss, 'width') + 2 * badgeRing,
  h: styleNum(badgeCss, 'height') + 2 * badgeRing,
};
// Flexbox centres the type in the CONTENT box, which for a symmetric border is
// the centre of the painted box too — but only for a symmetric border, so it is
// computed rather than assumed.
const middle = (b, ring, cw, ch) => ({
  x: r3(b.x + ring + cw / 2),
  y: r3(b.y + ring + ch / 2),
});

check(
  'the markup declares the ring widths this check reads',
  plateRing === PLATE_RING && badgeRing === BADGE_RING,
  `plate ring=${plateRing}/${PLATE_RING}, badge ring=${badgeRing}/${BADGE_RING}`,
);
check(
  'the plate a browser paints is the plate plus a ring on each side',
  cssPlate.w === PLATE && PLATE === SIGN + 2 * PLATE_RING,
  `css=${cssPlate.w}, PLATE=${PLATE}`,
);
check(
  'the badge a browser paints is the badge plus a hairline on each side',
  cssBadge.w === BADGE_OUTER && BADGE_OUTER === BADGE + 2 * BADGE_RING,
  `css=${cssBadge.w}, BADGE_OUTER=${BADGE_OUTER}`,
);

const plainOps = recordSign(3, 'plain');
const rects = plainOps.filter((o) => o.op === 'rect');
const fills = plainOps.filter((o) => o.op === 'fill');
const strokes = plainOps.filter((o) => o.op === 'stroke');
const texts = plainOps.filter((o) => o.op === 'text');
check(
  'the canvas painter draws a post, its outline, a plate, its ring, a badge and two labels',
  rects.length === 2 && fills.length === 3 && strokes.length === 1 && texts.length === 2,
  `rects=${rects.length} fills=${fills.length} strokes=${strokes.length} texts=${texts.length}`,
);

const canvasPostOutline = rects.find((o) => o.style === POST_OUTLINE);
const canvasPost = rects.find((o) => o.style === POST_COLOR);
check(
  'the post is in the same place on canvas as in the markup',
  canvasPost && eq(inBox(canvasPost), cssPost),
  `canvas=${JSON.stringify(canvasPost && inBox(canvasPost))} css=${JSON.stringify(cssPost)}`,
);
check(
  'the post’s outline surrounds it, a hairline on every side',
  canvasPostOutline &&
    eq(inBox(canvasPostOutline), {
      x: cssPost.x - POST_OUTLINE_W,
      y: cssPost.y - POST_OUTLINE_W,
      w: cssPost.w + 2 * POST_OUTLINE_W,
      h: cssPost.h + 2 * POST_OUTLINE_W,
    }),
  'a stroke on the post would eat half of its 3px instead of surrounding it',
);
check(
  'the plate is the same size and place on canvas as in the markup',
  eq(inBox(fills[0]), cssPlate),
  `canvas=${JSON.stringify(inBox(fills[0]))} css=${JSON.stringify(cssPlate)}`,
);
check(
  'the blue sits inside the ring rather than under half of it',
  eq(inBox(fills[1]), cssPlateBlue),
  `canvas=${JSON.stringify(inBox(fills[1]))} css=${JSON.stringify(cssPlateBlue)}`,
);
// The disc and its hairline together, the hairline being centred on the arc.
check(
  'the badge is the same size and place on canvas as in the markup',
  eq(inBox(strokes[0], strokes[0].width / 2), cssBadge),
  `canvas=${JSON.stringify(inBox(strokes[0], strokes[0].width / 2))} css=${JSON.stringify(cssBadge)}`,
);
check(
  'the badge’s white disc fills it out to that hairline',
  eq(inBox(fills[2], strokes[0].width / 2), cssBadge),
);
check(
  'the P and the number are centred where flexbox would centre them',
  eq(atBox(texts[0]), middle(cssPlate, plateRing, SIGN, SIGN)) &&
    eq(atBox(texts[1]), middle(cssBadge, badgeRing, BADGE, BADGE)),
  `P=${JSON.stringify(atBox(texts[0]))} want ${JSON.stringify(middle(cssPlate, plateRing, SIGN, SIGN))}; ` +
    `n=${JSON.stringify(atBox(texts[1]))} want ${JSON.stringify(middle(cssBadge, badgeRing, BADGE, BADGE))}`,
);
check(
  'the canvas centres its type by hand, there being no flexbox',
  texts.every((t) => t.align === 'center' && t.baseline === 'middle'),
  'without these two, fillText’s point is a left edge and a baseline',
);
check(
  'the P and the number are set in the markup’s own fonts',
  texts[0].font === styleFont(plateCss) &&
    texts[1].font === styleFont(badgeCss),
  `canvas P=${texts[0].font} css=${styleFont(plateCss)}`,
);
check(
  'the sign says P and carries its list number on canvas too',
  texts[0].text === 'P' && texts[1].text === '3',
);

// The canvas equivalent of the transform-origin check above: the painter is
// handed the lot itself, and what has to land on it is the foot of the post —
// the middle of its width, at its very bottom.
const footOf = (o) => ({ x: r3((o.x0 + o.x1) / 2), y: r3(o.y1) });
const foot = footOf(canvasPost);
check(
  'the canvas sign stands on the point it was given',
  eq(foot, { x: 0, y: 0 }),
  `foot at ${foot.x},${foot.y} rather than 0,0`,
);
check(
  'the whole canvas sign is above the point, not draped over it',
  fills[0].y1 < 0 && fills[2].y1 < 0,
  `plate bottom=${fills[0].y1}, badge bottom=${fills[2].y1}`,
);

// The plate leans two pixels right of its post, because `left:0` positions a
// border box and the ring grows from that corner rather than from the middle —
// see PLATE_RING in sign.ts, where the decision to keep it is written down. What
// is checked is not that the lean is zero but that it is the SAME in both
// painters: a lean on screen and none on paper, or the reverse, is the drift
// this whole section exists to catch, and is invisible unless the two are put
// side by side.
const cssLean = r3(cssPlate.x + cssPlate.w / 2 - ANCHOR[0]);
const canvasLean = r3((fills[0].x0 + fills[0].x1) / 2);
check(
  'both painters lean the plate off the post by the same amount',
  cssLean === canvasLean,
  `markup leans ${cssLean}px, canvas leans ${canvasLean}px`,
);
check(
  'and that amount is the ring, not something new',
  cssLean === PLATE_RING,
  `lean=${cssLean}px, ring=${PLATE_RING}px — if this changed, so did the sign`,
);

const hoveredOps = recordSign(3, 'hovered');
const dimmedOps = recordSign(3, 'dimmed');
check(
  'growing on canvas scales every part by GROW',
  hoveredOps.length === plainOps.length &&
    hoveredOps.every((o, i) =>
      o.op === 'text'
        ? r3(o.x) === r3(plainOps[i].x * GROW) &&
          r3(o.y) === r3(plainOps[i].y * GROW)
        : r3(o.x0) === r3(plainOps[i].x0 * GROW) &&
          r3(o.y1) === r3(plainOps[i].y1 * GROW),
    ),
  `GROW=${GROW}`,
);
// Which, because the painter grows about the point rather than about the middle
// of the plate, is what keeps the lit sign on its lot.
const grownPost = hoveredOps.find((o) => o.style === POST_COLOR);
check(
  'growing does not move the foot of the post off the lot',
  eq(footOf(grownPost), foot),
  `grown foot at ${JSON.stringify(footOf(grownPost))}, was ${JSON.stringify(foot)}`,
);
check(
  'a dimmed canvas sign fades whole, by the same amount as the markup',
  dimmedOps.every((o) => o.alpha === DIM) && plainOps.every((o) => o.alpha === 1),
  `DIM=${DIM}`,
);
check(
  'fading and growing leave the drawing itself alone',
  eq(
    dimmedOps.map((o) => [o.op, o.x0, o.y0]),
    plainOps.map((o) => [o.op, o.x0, o.y0]),
  ),
);

// ---------------------------------------------------------------------------
// (7) Every renderer asks for the numbering rather than working it out. This is
// the check that keeps the four maps agreeing with the numbered rows on the
// printed sheet, which is the entire point of the badge.
// ---------------------------------------------------------------------------

const renderers = [
  ['the planner’s flat map', 'src/components/ParkingLayer.tsx', 'parkingSigns('],
  ['the planner’s 3D view', 'src/components/Map3DParkingSigns.tsx', 'parkingSigns('],
  ['the printed flat map', 'src/briefing/staticMap.ts', 'plainParkingSigns('],
  ['the printed 3D map', 'src/briefing/terrainMap.ts', 'plainParkingSigns('],
];
for (const [what, path, call] of renderers) {
  const code = src(path);
  check(
    `${what} takes its numbering from parking/signs`,
    code.includes("from '../parking/signs'") && code.includes(call),
    `expected ${call} and the import in ${path}`,
  );
  check(
    `${what} numbers nothing itself`,
    !/\bi \+ 1\b/.test(code) && !/index \+ 1/.test(code),
    'a fifth copy of the numbering is a fifth chance to disagree with the list',
  );
}

// Both 3D views draw the signs the same way — same layer id, same layout, same
// paint — because they are the same signs and one of them is a photograph of
// the other's subject.
//
// The two files differ per view because the planner splits the work: the layer
// is part of the style Map3DView declares, while the icon serving and the
// source-setting live in a child component, so that a pointer crossing the
// Parking tab re-renders four lines instead of a nine-hundred-line map. The
// printed map has no stores to subscribe to and does both itself.
for (const [what, layerFile, iconFile] of [
  [
    'the planner’s 3D view',
    'src/components/Map3DView.tsx',
    'src/components/Map3DParkingSigns.tsx',
  ],
  ['the printed 3D map', 'src/briefing/terrainMap.ts', 'src/briefing/terrainMap.ts'],
]) {
  const style = src(layerFile);
  check(
    `${what} declares the shared symbol layer rather than its own`,
    style.includes('PARKING_SIGN_LAYER') &&
      style.includes('PARKING_SIGN_LAYOUT') &&
      style.includes('PARKING_SIGN_PAINT'),
  );
  check(
    `${what} bakes its icons through serveParkingSignIcons`,
    src(iconFile).includes('serveParkingSignIcons'),
    'MapLibre asks for an icon it lacks exactly once, and only then',
  );
}
// A style-image server left running outlives the map that needed it. The
// planner's is an effect, so React unsubscribes it by returning it; the printed
// map has to say so.
check(
  'the printed 3D map stops serving icons when it is torn down',
  /stopServingIcons\(\);\s*\n\s*gl\.remove\(\);/.test(src('src/briefing/terrainMap.ts')),
);
check(
  'the planner unsubscribes its icon server with the map',
  /return serveParkingSignIcons\(map\);/.test(src('src/components/Map3DParkingSigns.tsx')),
);
// Pointing at a sign on the terrain lights the same lot as pointing at its row,
// through the same pair of functions — and a sign still lit at unmount would
// leave four rows dimmed for a hover nobody is doing.
const signs3d = src('src/components/Map3DParkingSigns.tsx');
check(
  'pointing at a sign in 3D lights it through the shared pair',
  signs3d.includes('takeParkingHighlight(area.id, area.point)') &&
    signs3d.includes('releaseParkingHighlight(lit)') &&
    !signs3d.includes('setHoverPoint('),
);
check(
  'a sign lit in 3D is released before its neighbour is taken',
  /if \(lit !== null\) releaseParkingHighlight\(lit\);\s*\n\s*lit = id;/.test(signs3d),
  'otherwise two signs own one highlight as the pointer slides between them',
);
check(
  'the 3D view lets go of the highlight when it goes away',
  /map\.off\('movestart', clear\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*clear\(\);/.test(signs3d),
);
// queryRenderedFeatures throws on a layer the style does not have yet, and the
// pointer can be over the canvas before `load`.
check(
  'the 3D hit test survives a pointer arriving before the style',
  /if \(!map\.getLayer\(PARKING_SIGN_LAYER\)\) return null;/.test(signs3d),
);

// The sheet feeds its maps from the same array, in the same order, as the
// numbered rows it prints beside them — no sort, no slice, no second fetch.
const sheet = src('src/briefing/BriefingSheet.tsx');
check(
  'the printed maps get the lots the printed list shows, in its order',
  /parking\.map\(\(p\) => p\.point\)/.test(sheet),
  'anything else and the sheet’s own map disagrees with its own list',
);
check(
  'the sheet does not re-sort or trim the lots on the way to the map',
  !/parkingPoints[\s\S]{0,120}\.(sort|slice|filter)\(/.test(sheet),
);
// The lots follow the Parking section's switch rather than gaining one of their
// own: an empty array IS the off position, which is why there is no third state
// to get wrong.
check(
  'turning the Parking section off takes the signs off the map with it',
  /options\.parking \? parking\.map/.test(sheet),
  'the signs follow the existing switch; a second switch could contradict it',
);
check(
  'the array handed to the maps is stable, so a sheet does not rebuild its terrain',
  /useMemo<readonly LatLng\[\]>/.test(sheet),
  'a fresh array every render rebuilds the 3D map and throws away its tiles',
);

// Changing the lots must not rebuild the terrain map — the DEM, the tiles and
// the camera would all go with it — and must not photograph the frame from
// before the signs were drawn.
const picture = src('src/briefing/TerrainPicture.tsx');
check(
  'new lots reach the 3D map through setParking, not a rebuild',
  /handleRef\.current\?\.setParking\(parking\)/.test(picture) &&
    /\}, \[parking, built\]\)/.test(picture),
);
check(
  'the build effect does not depend on the lots',
  !/\}, \[route, overlay, snowDate, width, height, scale, canvasRef, parking\]/.test(
    picture,
  ) && /parkingRef/.test(picture),
  'the lots arrive from Overpass seconds after the map is built',
);
check(
  'setting the lots does not capture the frame drawn before them',
  !/setParking\(parking\);\s*\n\s*[\s\S]{0,40}capture\(/.test(picture),
  'the idle handler inside terrainMap takes the copy once the signs are drawn',
);

// ---------------------------------------------------------------------------
// The picture. Renders the three states side by side, each with a crosshair on
// its anchor, so "the sign stands on the point" is something a human can see
// rather than something only the arithmetic above believes.
// ---------------------------------------------------------------------------

const CELL = 120;

// The backgrounds a sign has to stay legible on: the topo tiles' pale paper,
// snowfield, forest, and the steepness overlay's dark red. A sign checked only
// against one of these is a sign checked against none of them.
const TERRAIN = [
  ['paper', '#f3efe6'],
  ['snow', '#ffffff'],
  ['forest', '#4a7a3f'],
  ['steep', '#8c2d2d'],
];

// The lot's coordinate, at the middle of a cell: the thing every sign in the
// picture has to be standing on.
const crosshair =
  `<div style="position:absolute;left:${CELL / 2}px;top:${CELL / 2}px;` +
  `width:1px;height:1px;box-shadow:0 0 0 1px #dc2626;z-index:2">` +
  `<div style="position:absolute;left:-9px;top:0;width:19px;height:1px;` +
  `background:rgba(220,38,38,.55)"></div>` +
  `<div style="position:absolute;left:0;top:-9px;width:1px;height:19px;` +
  `background:rgba(220,38,38,.55)"></div></div>`;

const frame = (label, inner, bg = '#e9eef2') =>
  `<figure style="margin:0;width:${CELL}px;text-align:center">` +
  `<div style="position:relative;height:${CELL}px;background:${bg};` +
  `border:1px solid #cbd5e1;border-radius:6px;overflow:hidden">` +
  crosshair +
  inner +
  `</div>` +
  `<figcaption style="font:600 11px system-ui;color:#334155;padding-top:6px">` +
  `${label}</figcaption></figure>`;

const cell = (label, html, bg = '#e9eef2') =>
  frame(
    label,
    // The sign, positioned exactly as Leaflet positions a divIcon: box's
    // top-left placed at the point minus the anchor.
    `<div style="position:absolute;left:${CELL / 2 - ANCHOR[0]}px;` +
      `top:${CELL / 2 - ANCHOR[1]}px">${html}</div>`,
    bg,
  );

// The same sign, painted by the canvas half of sign.ts inside the same browser,
// so the pair can be compared in one screenshot rather than trusted. The canvas
// is oversampled and scaled back down, which is what both real callers do — the
// briefing's flat map and the baked MapLibre icon — so this is also a look at
// the resolution the printed sign is drawn at.
const SHOT_RATIO = 3;
const canvasCell = (label, n, state, bg = '#e9eef2') =>
  frame(
    label,
    `<canvas data-sign="${n}" data-state="${state}" ` +
      `width="${CELL * SHOT_RATIO}" height="${CELL * SHOT_RATIO}" ` +
      `style="position:absolute;left:0;top:0;width:${CELL}px;height:${CELL}px"></canvas>`,
    bg,
  );

// Runs after the markup above is laid out; the export list of the bundle is
// harmless in an inline module and puts drawParkingSign in scope.
const painterScript =
  `<script type="module">\n${signSource}\n` +
  `for (const el of document.querySelectorAll('canvas[data-sign]')) {\n` +
  `  const ctx = el.getContext('2d');\n` +
  `  ctx.scale(${SHOT_RATIO}, ${SHOT_RATIO});\n` +
  `  drawParkingSign(ctx, ${CELL / 2}, ${CELL / 2},\n` +
  `    Number(el.dataset.sign), el.dataset.state);\n` +
  `}\n</script>`;

const caption = (text) =>
  `<div style="font:600 11px system-ui;color:#64748b;letter-spacing:.04em;` +
  `text-transform:uppercase">${text}</div>`;

const row = (contents) =>
  `<div style="display:flex;gap:16px;align-items:flex-start;` +
  `width:max-content">${contents}</div>`;

const page =
  `<!doctype html><meta charset="utf-8">` +
  `<body style="margin:0;padding:16px;background:#fff;` +
  `display:flex;flex-direction:column;gap:12px;width:max-content">` +
  // The three states, with a crosshair on the lot each sign is planted on.
  caption('markup — the planner’s flat map') +
  row(
    cell('plain', plainHtml) +
      cell('hovered', hoveredHtml) +
      cell('dimmed', dimmedHtml) +
      // A crowded pair, which is the case the fading exists for: two lots close
      // enough to overlap, one of them lit.
      `<figure style="margin:0;width:${CELL}px;text-align:center">` +
      `<div style="position:relative;height:${CELL}px;background:#e9eef2;` +
      `border:1px solid #cbd5e1;border-radius:6px;overflow:hidden">` +
      `<div style="position:absolute;left:34px;` +
      `top:${CELL / 2 - ANCHOR[1] + 6}px">` +
      `${signModule.parkingSignHtml(4, 'dimmed')}</div>` +
      `<div style="position:absolute;left:52px;` +
      `top:${CELL / 2 - ANCHOR[1] + 18}px">` +
      `${signModule.parkingSignHtml(5, 'hovered')}</div>` +
      `</div><figcaption style="font:600 11px system-ui;color:#334155;` +
      `padding-top:6px">overlapping</figcaption></figure>`,
  ) +
  // The same three states from the other painter — the one that draws the
  // printed flat map and bakes the icons for both 3D views. Directly under the
  // markup row so a drift between the two is a thing the eye catches: the
  // arithmetic above compares them part by part, but only a human notices that
  // the type has come out a shade heavier.
  caption('canvas — the printed map, and both 3D views’ icons') +
  row(
    canvasCell('plain', 3, 'plain') +
      canvasCell('hovered', 3, 'hovered') +
      canvasCell('dimmed', 3, 'dimmed') +
      canvasCell('sign 12', 12, 'plain'),
  ) +
  // The same sign on the terrain it has to be legible against, in both
  // painters, because "legible on snow" is a question about the drawing and not
  // about which code drew it.
  caption('legibility — markup above, canvas below') +
  row(TERRAIN.map(([label, bg]) => cell(label, plainHtml, bg)).join('')) +
  row(TERRAIN.map(([, bg], i) => canvasCell(TERRAIN[i][0], 3, 'plain', bg)).join('')) +
  painterScript +
  `</body>`;

const outPng = join(here, 'parking-signs.png');
const tmp = mkdtempSync(join(tmpdir(), 'parking-signs-'));
const htmlPath = join(tmp, 'signs.html');
writeFileSync(htmlPath, page);

let rendered = false;
// Firefox is the one headless browser this repo can count on being present in
// CI images; a missing browser is not a test failure, only a missing picture.
for (const bin of ['firefox', 'chromium', 'google-chrome']) {
  try {
    if (bin === 'firefox') {
      execFileSync(
        bin,
        ['--headless', '--window-size=620,790', `--screenshot=${outPng}`, htmlPath],
        { stdio: 'ignore', timeout: 90_000 },
      );
    } else {
      execFileSync(
        bin,
        [
          '--headless',
          '--no-sandbox',
          '--force-device-scale-factor=3',
          '--window-size=620,790',
          `--screenshot=${outPng}`,
          htmlPath,
        ],
        { stdio: 'ignore', timeout: 90_000 },
      );
    }
    rendered = existsSync(outPng);
    if (rendered) break;
  } catch {
    // try the next one
  }
}

// ---------------------------------------------------------------------------

const width = Math.max(...checks.map((c) => c.name.length));
for (const c of checks) {
  const mark = c.ok ? 'ok  ' : 'FAIL';
  const detail = c.detail && !c.ok ? `   → ${c.detail}` : '';
  console.log(`${mark} ${c.name.padEnd(width)}${detail}`);
}
console.log(
  rendered
    ? `\nrendered ${outPng}`
    : '\nno headless browser found; skipped the picture',
);
console.log(
  failures === 0
    ? `\n${checks.length} checks passed.`
    : `\n${failures} of ${checks.length} checks FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
