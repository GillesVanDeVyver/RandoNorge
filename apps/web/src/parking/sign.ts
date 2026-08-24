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
 *  and not the middle of the plate.
 *
 *  ONE SIGN, TWO PAINTERS. The same sign now has to appear on four maps: the
 *  planner's flat map and its 3D view, and the printed briefing's flat map and
 *  its 3D one. Two of those are drawn by a browser laying out HTML (Leaflet's
 *  divIcon), and two are drawn onto a canvas — the briefing's flat renderer
 *  paints straight onto the page's canvas, and MapLibre wants a bitmap for its
 *  symbol layer. So this file has both painters, `parkingSignHtml` and
 *  `drawParkingSign`, standing on one set of numbers.
 *
 *  They must not drift. A sign that is 26 px wide on screen and 22 on paper is
 *  not a bug anyone reports, it is a printed sheet that quietly does not look
 *  like the screen it was exported from — so every dimension either painter
 *  uses is a constant declared here, and verify-parking-signs.mjs renders the
 *  pair side by side for a human to compare. */

import { PARKING_PIN_COLOR, PARKING_PIN_RING } from './pin';

export const SIGN = 22; // blue plate, edge to edge
export const POST_H = 11; // post below the plate
export const BADGE = 14; // number badge, centred on the plate's top-right corner

/** The plate's white ring, and the plate that ends up on screen because of it.
 *
 *  CSS draws the ring as a `border` on a content box, so the plate a browser
 *  actually paints is SIGN plus a ring on each side — 26 px, not 22. That is
 *  the sign everyone has been looking at since the feature shipped, so it is
 *  the sign the canvas painter has to draw too, and the arithmetic is stated
 *  here rather than left implicit in a stylesheet where the other painter
 *  cannot see it.
 *
 *  A side effect worth knowing about, because it looks like a bug in whichever
 *  painter you happen to be reading: `left:0` places the plate's BORDER box, so
 *  the ring grows rightwards and downwards from the positioned corner rather
 *  than outwards from the middle. The painted plate therefore spans 0..26 in box
 *  coordinates while the post — plumb under SIGN's own middle, which is where
 *  ANCHOR is — stands at 11. The sign leans two pixels right of its post.
 *
 *  It is left that way deliberately. That is the sign the planner's flat map has
 *  shown since the feature shipped, the lot is marked by the foot of the post
 *  and not by the middle of the plate, and moving the plate would move every
 *  sign on screen to fix something no reader has an opinion about. What must not
 *  happen is one painter leaning and the other not, so the offset is asserted in
 *  verify-parking-signs.mjs rather than merely tolerated. */
export const PLATE_RING = 2;
export const PLATE = SIGN + 2 * PLATE_RING;

/** Corner radius of the plate, on its outer edge and on the blue inside it. A
 *  border rounds its inner edge by whatever is left after its own width, which
 *  is what keeps the ring an even thickness round the corner instead of
 *  pinching. */
export const PLATE_RADIUS = 4;
export const PLATE_INNER_RADIUS = PLATE_RADIUS - PLATE_RING;

/** The badge's hairline, and the badge that ends up on screen because of it.
 *
 *  The same arithmetic as PLATE above, and worth stating twice because the two
 *  painters got it right for the plate and wrong for the badge: the ring is a
 *  CSS `border` on a content box, so the disc a browser paints is BADGE plus a
 *  hairline on each side — 16 px, not 14. A canvas painter that sizes its arc
 *  from BADGE and lets the stroke straddle it draws 14, and the number that ties
 *  a sign to its row comes out an eighth smaller on paper than on screen, one
 *  pixel off centre, on a glyph that is nine pixels tall to begin with.
 *
 *  BADGE stays the content diameter, because that is what the markup's `width`
 *  is and OVERHANG is measured from it. */
export const BADGE_RING = 1;
export const BADGE_OUTER = BADGE + 2 * BADGE_RING;

/** Width of the post, and of the hairline outline round it. */
export const POST_W = 3;
export const POST_OUTLINE_W = 1;

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

/** The same sign as a bitmap, for MapLibre's symbol layer — which is what draws
 *  the signs in both 3D views. See signImage.ts for the baking.
 *
 *  Taller and wider than the box above, and for one reason: MapLibre anchors an
 *  icon by a named edge of its image, not by a point inside it, and the only
 *  anchor that puts the foot of the post on the lot is 'bottom' — the middle of
 *  the image's bottom edge. The box's own middle is not its anchor (the badge
 *  hangs off the right-hand side and nothing balances it on the left), so the
 *  bitmap is padded on the left until the two coincide. Get this wrong and every
 *  sign in 3D stands a few metres east of its car park, which is precisely the
 *  failure the divIcon's anchor exists to avoid.
 *
 *  The extra pixel of height is the post's outline, which the CSS box-shadow
 *  spills a pixel below the foot; without it the bitmap clips the outline off
 *  the bottom of the post and the two painters disagree at the one place a
 *  reader is looking. It is also why the symbol layer carries an icon-offset of
 *  that one pixel downwards: 'bottom' would otherwise plant the outline on the
 *  lot rather than the foot. */
export const IMAGE_PAD_LEFT = OVERHANG;
export const IMAGE_W = SIGN + 2 * OVERHANG;
export const IMAGE_H = H + POST_OUTLINE_W;

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

/** The two bits of type on the sign, and the badge's hairline. Shared by both
 *  painters below so the "P" — which is the whole sign at a glance — cannot come
 *  out at one weight on screen and another on paper. */
const P_FONT = '700 13px/1 system-ui,sans-serif';
const BADGE_FONT = '700 9px/1 system-ui,sans-serif';

/** Where the post stands, in box coordinates: plumb under the middle of the
 *  plate, and overlapping its bottom edge by a pixel so no seam opens between
 *  them at fractional device pixel ratios. */
const POST_X = SIGN / 2 - POST_W / 2;
const POST_Y = OVERHANG + SIGN - 1;

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
    `position:absolute;left:${POST_X}px;top:${POST_Y}px;` +
    `width:${POST_W}px;height:${POST_H + 1}px;` +
    `background:${POST_COLOR};` +
    `box-shadow:0 0 0 ${POST_OUTLINE_W}px ${POST_OUTLINE},` +
    `0 1px 2px rgba(0,0,0,.35);` +
    `"></div>` +
    // The plate.
    `<div style="` +
    `position:absolute;left:0;top:${OVERHANG}px;` +
    `width:${SIGN}px;height:${SIGN}px;` +
    `display:flex;align-items:center;justify-content:center;` +
    `border-radius:${PLATE_RADIUS}px;` +
    `background:${PARKING_PIN_COLOR};` +
    `border:${PLATE_RING}px solid ${PARKING_PIN_RING};` +
    `box-shadow:${halo};` +
    `color:#fff;font:${P_FONT};` +
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
    `border:${BADGE_RING}px solid ${PARKING_PIN_COLOR};` +
    `color:${PARKING_PIN_COLOR};font:${BADGE_FONT};` +
    `font-variant-numeric:tabular-nums;` +
    `">${n}</div>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// The same sign, painted onto a canvas.
//
// Two maps need this rather than the markup above. The printed briefing's flat
// map is a canvas the tiles and the route line are already drawn onto, so the
// signs go on with them; and MapLibre — which draws both 3D views — takes an
// icon as a bitmap, which is this painter run over an offscreen canvas (see
// signImage.ts).
//
// Everything below is positioned from the constants at the top of this file and
// from ANCHOR, so a sign painted here stands on the same point, at the same
// size, as the divIcon on the planner's flat map. Nothing here may reach for a
// number of its own.
// ---------------------------------------------------------------------------

/** Canvas has no border-radius, so the path is traced. Kept private: callers
 *  want a sign, not a rectangle. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/**
 * Paint the sign for list row `n` standing on (`x`, `y`).
 *
 * (`x`, `y`) is the lot itself — the foot of the post, the same point ANCHOR
 * names for the divIcon — not a corner of the drawing. A caller with a
 * coordinate projected onto its canvas can pass it straight in.
 *
 * Sizes are in the context's current units, so a caller working in logical
 * pixels on an oversampled canvas (which both callers are) gets a sign at the
 * same printed size as the one on screen, drawn at the backing store's
 * resolution.
 */
export function drawParkingSign(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  n: number,
  state: SignState = 'plain',
): void {
  ctx.save();
  // Grown about the foot of the post and faded by the same amounts the CSS
  // uses, for the same reasons — see GROW and DIM. Neither state is reachable
  // on paper, where nothing is hovered, but the 3D planner's signs come from
  // this painter too and its reader can point at them.
  ctx.translate(x, y);
  if (state === 'hovered') ctx.scale(GROW, GROW);
  if (state === 'dimmed') ctx.globalAlpha = DIM;

  // Box coordinates, as the markup states them, moved so that the anchor is
  // the origin. Every offset below is then literally the one in the HTML.
  const bx = -ANCHOR[0];
  const by = -ANCHOR[1];

  // Text is centred by hand rather than by a flexbox.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // The post, first, so the plate is drawn over its top rather than under it.
  // The outline is a rectangle behind it rather than a stroke on it: a stroke
  // straddles the edge and would eat half the post's 3 px.
  ctx.fillStyle = POST_OUTLINE;
  ctx.fillRect(
    bx + POST_X - POST_OUTLINE_W,
    by + POST_Y - POST_OUTLINE_W,
    POST_W + 2 * POST_OUTLINE_W,
    POST_H + 1 + 2 * POST_OUTLINE_W,
  );
  ctx.fillStyle = POST_COLOR;
  ctx.fillRect(bx + POST_X, by + POST_Y, POST_W, POST_H + 1);

  // The plate: the white ring as the outer shape, the blue laid inside it. Two
  // filled paths rather than a fill and a stroke, because a stroke is centred
  // on its path and the ring has to sit wholly outside the blue — otherwise the
  // plate ends up SIGN + PLATE_RING wide instead of PLATE, and the printed sign
  // is a size the screen never showed.
  const plateX = bx;
  const plateY = by + OVERHANG;
  roundedRect(ctx, plateX, plateY, PLATE, PLATE, PLATE_RADIUS);
  ctx.fillStyle = PARKING_PIN_RING;
  ctx.fill();
  roundedRect(
    ctx,
    plateX + PLATE_RING,
    plateY + PLATE_RING,
    SIGN,
    SIGN,
    PLATE_INNER_RADIUS,
  );
  ctx.fillStyle = PARKING_PIN_COLOR;
  ctx.fill();

  ctx.font = P_FONT;
  ctx.fillStyle = '#fff';
  ctx.fillText('P', plateX + PLATE / 2, plateY + PLATE / 2);

  // The badge, on the plate's top-right corner: white disc, blue hairline, blue
  // number. Colours inverted from the plate so it reads as a label attached to
  // the sign rather than as part of what the sign says.
  //
  // BADGE_OUTER, not BADGE, and the arc inset by half the hairline it is about
  // to be stroked with — so the stroke's outer edge lands on the outer edge of
  // the disc the markup paints, rather than straddling a circle drawn at the
  // content diameter. See BADGE_OUTER: getting this wrong is a badge an eighth
  // too small everywhere except the planner's flat map.
  const badgeX = bx + W - BADGE_OUTER / 2;
  const badgeY = by + BADGE_OUTER / 2;
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, BADGE_OUTER / 2 - BADGE_RING / 2, 0, Math.PI * 2);
  ctx.fillStyle = PARKING_PIN_RING;
  ctx.fill();
  ctx.lineWidth = BADGE_RING;
  ctx.strokeStyle = PARKING_PIN_COLOR;
  ctx.stroke();

  ctx.font = BADGE_FONT;
  ctx.fillStyle = PARKING_PIN_COLOR;
  ctx.fillText(String(n), badgeX, badgeY);

  ctx.restore();
}
