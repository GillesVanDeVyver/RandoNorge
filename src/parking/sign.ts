/** The parking sign drawn on the map for every lot the Parking tab lists:
 *  geometry and markup, with no Leaflet in sight.
 *
 *  Separate from ParkingLayer for two reasons. The layer's job is subscribing
 *  to stores and handing Leaflet an icon; the sign's job is arithmetic and a
 *  string, and the arithmetic is the part that has a wrong answer. Kept here it
 *  can be rendered and checked outside a map — see
 *  scripts/verify-parking-signs.mjs, which asserts the anchor lands on the foot
 *  of the post and renders the three states to a picture.
 *
 *  It is the road sign rather than a dot on purpose: a blue plate with a white
 *  P is what the driver is hunting for at the roadside, so it needs no key. The
 *  post is not decoration — it is what makes the glyph point at one spot on the
 *  ground instead of hovering over an area, which is why the anchor is its foot
 *  and not the middle of the plate. */

import { PARKING_PIN_COLOR, PARKING_PIN_RING } from './pin';

export const SIGN = 22; // blue plate, edge to edge
export const POST_H = 11; // post below the plate
export const BADGE = 14; // number badge, centred on the plate's top-right corner

/** How far the badge escapes the plate — and therefore how much empty room the
 *  icon box needs above the plate for it. */
export const OVERHANG = BADGE / 2;

/** Icon box. Wide enough for the plate plus the badge's overhang, tall enough
 *  for that overhang, the plate and the post. */
export const W = SIGN + OVERHANG;
export const H = OVERHANG + SIGN + POST_H;

/** The point the sign is planted on: horizontally the middle of the plate, so
 *  the post is plumb under it; vertically the very bottom of the box, which is
 *  the foot of the post. Anything else and the sign marks a spot several metres
 *  from the one it was given. */
export const ANCHOR: readonly [number, number] = [SIGN / 2, H];

/** Hover is three changes at once, because "which one is row three" has to
 *  survive a glance: the pointed-at sign grows, gains a halo in its own blue,
 *  and its neighbours fade back. Growth alone reads poorly where two lots sit
 *  50 m apart and overlap on screen — the fading is what makes the answer
 *  unambiguous there. */
export const GROW = 1.3;
export const DIM = 0.42;

/** The post is grey with a thin white outline, and it is grey for a reason a
 *  screenshot on one basemap will not show: it was white to match the plate's
 *  ring, and a white post is invisible against snowfield, glacier and the pale
 *  paper of the topo tiles — exactly the terrain a trailhead lot sits on. Grey
 *  reads on those; the white outline keeps it readable on forest and on the
 *  steepness overlay's dark reds. */
export const POST_COLOR = '#475569';
export const POST_OUTLINE = 'rgba(255,255,255,.92)';

export type SignState = 'plain' | 'hovered' | 'dimmed';

export function parkingSignHtml(n: number, state: SignState): string {
  const hovered = state === 'hovered';

  // Scaled about the foot of the post, so growing never moves the point the
  // sign is planted on. Scaling about the centre — the default — would walk the
  // sign several pixels off its lot at the exact moment the reader is being
  // told which lot it is, and a highlight that shifts the thing it highlights
  // reads as the map having moved.
  const grow = hovered
    ? `transform:scale(${GROW});transform-origin:${ANCHOR[0]}px ${ANCHOR[1]}px;`
    : '';
  const fade = state === 'dimmed' ? `opacity:${DIM};` : '';
  const halo = hovered
    ? '0 0 0 3px rgba(47,111,237,.45),0 0 0 5px rgba(47,111,237,.2),' +
      '0 2px 5px rgba(0,0,0,.45)'
    : '0 1px 3px rgba(0,0,0,.4)';

  return (
    `<div style="position:relative;width:${W}px;height:${H}px;${grow}${fade}">` +
    // Post first, so the plate's shadow falls over it rather than under it. It
    // overlaps the plate by 1px so no seam opens between them at fractional
    // device pixel ratios.
    `<div style="` +
    `position:absolute;left:${SIGN / 2 - 1.5}px;top:${OVERHANG + SIGN - 1}px;` +
    `width:3px;height:${POST_H + 1}px;` +
    `background:${POST_COLOR};` +
    `box-shadow:0 0 0 1px ${POST_OUTLINE},0 1px 2px rgba(0,0,0,.35);` +
    `"></div>` +
    // The plate.
    `<div style="` +
    `position:absolute;left:0;top:${OVERHANG}px;` +
    `width:${SIGN}px;height:${SIGN}px;` +
    `display:flex;align-items:center;justify-content:center;` +
    `border-radius:4px;` +
    `background:${PARKING_PIN_COLOR};` +
    `border:2px solid ${PARKING_PIN_RING};` +
    `box-shadow:${halo};` +
    `color:#fff;font:700 13px/1 system-ui,sans-serif;` +
    `">P</div>` +
    // The list number, in a badge on the corner. A real sign carries no number,
    // but this one has to answer "which row is this", and the badge is the
    // entire mechanism tying a sign to its row. Colours inverted from the plate
    // so it reads as a label attached to the sign rather than as part of what
    // the sign says.
    `<div style="` +
    `position:absolute;right:0;top:0;` +
    `width:${BADGE}px;height:${BADGE}px;` +
    `display:flex;align-items:center;justify-content:center;` +
    `border-radius:50%;` +
    `background:${PARKING_PIN_RING};` +
    `border:1px solid ${PARKING_PIN_COLOR};` +
    `color:${PARKING_PIN_COLOR};font:700 9px/1 system-ui,sans-serif;` +
    `font-variant-numeric:tabular-nums;` +
    `">${n}</div>` +
    `</div>`
  );
}
