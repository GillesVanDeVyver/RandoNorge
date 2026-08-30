// How a route looks, wherever it is drawn.
//
// The route is painted by four unrelated renderers — Leaflet polylines in the
// web planner (DrawingHandler), a 2D canvas for the printable briefing and the
// library thumbnails (briefing/staticMap), a MapLibre line layer in the 3D
// view, and MapLibre again on the phone (apps/mobile's route screen). Each used
// to carry its own copy of the colour and the widths, with a comment asking the
// next person to keep them in step, and they drifted anyway: the briefing
// printed a line more than twice the planner's relative weight, so the exported
// map read as a different, blunter drawing of the same tour.
//
// So the numbers live here once. The weights are in CSS/logical pixels against
// a map roughly the width of the planner's own; the static renderer works in
// logical pixels too and is handed these directly, which is what makes the
// printed map a miniature of the screen rather than a redrawing of it. React
// Native's density-independent pixels are the same idea under another name, so
// the phone takes them directly as well.
//
// The thumbnails deliberately do NOT use these: a 4 px line on a 160 px tile
// would vanish, so RouteThumbnail passes its own heavier weights. Proportion,
// not the number, is what carries across sizes.
//
// THIS FILE WAS apps/web/src/routeStyle.ts until Phase 2 of
// docs/mobile-web-parity-plan.md. The phone could not import it there — one app
// may not reach into another — so apps/mobile/app/route/[id].tsx spelled the
// four numbers out as literals under a comment naming this file as the fix, and
// scripts/verify-mobile-app.mjs carried an allowlist entry excusing the
// duplicated white. Moving it here is what that comment asked for, and it is
// the parity plan's one rule applied: anything not purely visual lives in
// packages/core and both apps import it.

/** The app's accent teal (--accent), the route's colour everywhere. */
export const ROUTE_COLOR = '#2dd4bf';

/** Route line width, in logical pixels. */
export const ROUTE_WEIGHT = 4;

/** White halo under the route, so the line stays readable over the red and
 *  orange of the steepness ramp. */
export const HALO_COLOR = '#ffffff';
export const HALO_WEIGHT = ROUTE_WEIGHT + 3;
export const HALO_OPACITY = 0.9;

/** The dotted line bridging a gap between one segment and the next.
 *
 *  A route is an ordered list of segments with possible gaps (the eraser makes
 *  them), and segment order is travel order. Drawn as bare polylines, two
 *  segments either side of a gap read as two unrelated tours; the connector is
 *  what says they are one, and in which order it is walked.
 *
 *  Deliberately NOT the route's teal: the connector is not terrain anybody
 *  traced. Gray and thin, it reads as a link between drawn things rather than
 *  as a drawn thing itself — the same language NavigationLayer already uses for
 *  its off-route connector, and for the same reason. It is never counted in the
 *  tour's distance or ascent, because nobody drew it. */
export const CONNECTOR_COLOR = '#6b7280';

/** Dot and gap of the dotted pattern, as multiples of the connector's own
 *  width. Stated as a ratio rather than a pair of pixel numbers because this
 *  has to come out as the same picture through three renderers that disagree
 *  about units: Leaflet and canvas want absolute pixels (see connectorDash),
 *  MapLibre's line-dasharray is already in multiples of line width and takes
 *  this pair directly. */
export const CONNECTOR_DASH_RATIO: readonly [number, number] = [1 / 3, 3];

/** Connector width for a route drawn at `routeWeight`, in logical pixels.
 *  Thinner than the line it joins, and derived from it so the two stay in
 *  proportion at thumbnail size as well as on the printed sheet. Floored at 1
 *  so it never thins away to nothing on the smallest tiles. */
export function connectorWeight(weight: number = ROUTE_WEIGHT): number {
  return Math.max(1, weight * 0.75);
}

/** The dotted pattern in absolute logical pixels, for a connector drawn at
 *  `weight` — the form Leaflet's dashArray and canvas's setLineDash want. At
 *  the planner's own weights this is [1, 9], the pattern NavigationLayer uses.
 */
export function connectorDash(
  weight: number = connectorWeight(),
): [number, number] {
  return [weight * CONNECTOR_DASH_RATIO[0], weight * CONNECTOR_DASH_RATIO[1]];
}

/** Start and finish dots. Green for where the day begins, red for where it
 *  ends — the one piece of the picture that says which way round the route is
 *  meant to be walked, which a bare line cannot. */
export const START_COLOR = '#16a34a';
export const FINISH_COLOR = '#dc2626';

/** Radius of those dots and the width of their white ring, in logical pixels.
 *  Sized off the line so the dots stay in proportion if the line ever changes,
 *  and floored so they never shrink into the line at small weights. */
export const ENDPOINT_RADIUS = Math.max(4, ROUTE_WEIGHT * 1.6);
export const ENDPOINT_RING = Math.max(1.5, ENDPOINT_RADIUS * 0.4);
