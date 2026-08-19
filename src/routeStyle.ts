// How a route looks, wherever it is drawn.
//
// The route is painted by three unrelated renderers — Leaflet polylines in the
// planner (DrawingHandler), a 2D canvas for the printable briefing and the
// library thumbnails (briefing/staticMap), and a MapLibre line layer in the 3D
// view. Each used to carry its own copy of the colour and the widths, with a
// comment asking the next person to keep them in step, and they drifted anyway:
// the briefing printed a line more than twice the planner's relative weight, so
// the exported map read as a different, blunter drawing of the same tour.
//
// So the numbers live here once. The weights are in CSS/logical pixels against
// a map roughly the width of the planner's own; the static renderer works in
// logical pixels too and is handed these directly, which is what makes the
// printed map a miniature of the screen rather than a redrawing of it.
//
// The thumbnails deliberately do NOT use these: a 4 px line on a 160 px tile
// would vanish, so RouteThumbnail passes its own heavier weights. Proportion,
// not the number, is what carries across sizes.

/** The app's accent teal (--accent), the route's colour everywhere. */
export const ROUTE_COLOR = '#2dd4bf';

/** Route line width, in logical pixels. */
export const ROUTE_WEIGHT = 4;

/** White halo under the route, so the line stays readable over the red and
 *  orange of the steepness ramp. */
export const HALO_COLOR = '#ffffff';
export const HALO_WEIGHT = ROUTE_WEIGHT + 3;
export const HALO_OPACITY = 0.9;

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
