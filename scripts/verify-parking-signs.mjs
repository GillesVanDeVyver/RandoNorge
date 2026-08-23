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
const root = join(here, '..');
const src = (p) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) failures++;
}

// ---------------------------------------------------------------------------
// The geometry, computed from the module the map actually renders. esbuild
// strips the types; the module imports nothing but colour constants, which is
// the whole reason the markup lives apart from the Leaflet layer.
// ---------------------------------------------------------------------------

const bundled = await build({
  entryPoints: [join(root, 'src/parking/sign.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'neutral',
});
const signModule = await import(
  'data:text/javascript;base64,' +
    Buffer.from(bundled.outputFiles[0].text).toString('base64')
);

const { SIGN, POST_H, BADGE, OVERHANG, W, H, ANCHOR, GROW, DIM, POST_COLOR } =
  signModule;

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
  layer.includes('releaseParkingHighlight(a.id)'),
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
check(
  'signs are drawn for every area, not only the hovered one',
  /areas\.map\(/.test(layer) && !/hovered\s*&&\s*<Marker/.test(layer),
);
check(
  'the layer bails out only when there is nothing to show',
  /if \(areas\.length === 0\) return null;/.test(layer),
);

// (4) A hovered id that has left the list highlights nothing, rather than
// fading everything.
check(
  'a hovered id not in the current list is ignored',
  /areas\.some\(\(a\) => a\.id === hoveredId\)/.test(layer),
  'otherwise a re-fetch under the pointer fades every sign',
);
check(
  'the fading is keyed off the checked id, not the raw store value',
  /active !== null\s*\?\s*'dimmed'/.test(layer) &&
    !/hoveredId !== null\s*\n?\s*\?\s*'dimmed'/.test(layer),
);

// Both ends light the highlight, and the row reaches it by keyboard too.
check(
  'hovering a row lights its sign',
  /onMouseEnter=\{take\}/.test(panel) &&
    /takeParkingHighlight\(area\.id, area\.point\)/.test(panel),
);
check(
  'hovering a sign lights it as well',
  /mouseover: \(\) => takeParkingHighlight\(a\.id, a\.point\)/.test(layer),
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

const cell = (label, html, bg = '#e9eef2') =>
  `<figure style="margin:0;width:${CELL}px;text-align:center">` +
  `<div style="position:relative;height:${CELL}px;background:${bg};` +
  `border:1px solid #cbd5e1;border-radius:6px;overflow:hidden">` +
  // The lot's coordinate, at the middle of the cell.
  `<div style="position:absolute;left:${CELL / 2}px;top:${CELL / 2}px;` +
  `width:1px;height:1px;box-shadow:0 0 0 1px #dc2626">` +
  `<div style="position:absolute;left:-9px;top:0;width:19px;height:1px;` +
  `background:rgba(220,38,38,.55)"></div>` +
  `<div style="position:absolute;left:0;top:-9px;width:1px;height:19px;` +
  `background:rgba(220,38,38,.55)"></div></div>` +
  // The sign, positioned exactly as Leaflet positions a divIcon: box's
  // top-left placed at the point minus the anchor.
  `<div style="position:absolute;left:${CELL / 2 - ANCHOR[0]}px;` +
  `top:${CELL / 2 - ANCHOR[1]}px">${html}</div>` +
  `</div>` +
  `<figcaption style="font:600 11px system-ui;color:#334155;padding-top:6px">` +
  `${label}</figcaption></figure>`;

const row = (contents) =>
  `<div style="display:flex;gap:16px;align-items:flex-start;` +
  `width:max-content">${contents}</div>`;

const page =
  `<!doctype html><meta charset="utf-8">` +
  `<body style="margin:0;padding:16px;background:#fff;` +
  `display:flex;flex-direction:column;gap:16px;width:max-content">` +
  // The three states, with a crosshair on the lot each sign is planted on.
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
  // The same sign on the terrain it has to be legible against.
  row(TERRAIN.map(([label, bg]) => cell(label, plainHtml, bg)).join('')) +
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
        ['--headless', '--window-size=620,330', `--screenshot=${outPng}`, htmlPath],
        { stdio: 'ignore', timeout: 90_000 },
      );
    } else {
      execFileSync(
        bin,
        [
          '--headless',
          '--no-sandbox',
          '--force-device-scale-factor=3',
          '--window-size=620,330',
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
