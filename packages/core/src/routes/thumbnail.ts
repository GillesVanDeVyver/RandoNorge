// Fit a route's shape into a fixed box, north-up — the arithmetic behind the
// mini-map that leads every row of the route library.
//
// WHY IT IS HERE AND NOT IN A COMPONENT. The plan's rule for the phone is that
// nothing non-visual gets written inside apps/mobile, and a Mercator projection
// with an aspect-preserving fit is about as non-visual as a picture gets: it is
// the same numbers whether the result is stroked onto a canvas, emitted as SVG,
// or checked in a test. The drawing — colours, weights, the tile behind it —
// stays in the component.
//
// WHAT IT IS NOT. apps/web's RouteThumbnail draws this shape ON a stitched
// steepness map (see apps/web/src/briefing/staticMap.ts, which shares its tile
// code with the printed briefing). That renderer picks an INTEGER zoom, because
// tiles only exist at integer zooms and a half-zoom would mean resampling
// them. Nothing here is bounded that way: with no tiles to line up with, the
// scale is continuous and the route fills its padded box exactly rather than
// landing somewhere between two powers of two. So the same route is framed a
// little tighter here than on the web — which is the honest trade for a phone
// that would otherwise fetch sixteen tiles per row.

import type { Route } from '../types';

/** A point in the output box's coordinates: x right, y down, origin top-left. */
export interface BoxPoint {
  x: number;
  y: number;
}

export interface FitRouteOptions {
  route: Route;
  /** Box width, in whatever unit the caller draws in. */
  width: number;
  /** Box height, same unit. */
  height: number;
  /** Fraction of EACH side kept clear around the shape. 0.12 matches the web's
   *  thumbnail; the usable box is therefore 76% of each dimension. */
  padding?: number;
}

/**
 * Project every segment of `route` into the box, or null when there is nothing
 * to draw.
 *
 * Null — rather than an empty array — for fewer than two points in total, which
 * is what "unparseable geometry" and "a route saved with a single tap" both
 * look like coming out of the API. The caller wants to swap in a placeholder
 * icon in that case, and a null is harder to render by accident than a [].
 *
 * Segments are preserved as segments: an eraser gap in the middle of a route is
 * a real hole and joining the ends across it would draw a line the user
 * deliberately removed.
 *
 * A route confined to a single point in one axis (drawn due north, say) has a
 * zero-width bounding box. Rather than divide by it, the scale falls back to
 * the other axis, so a straight line renders as a straight line down the middle
 * instead of NaN.
 */
export function fitRouteToBox({
  route,
  width,
  height,
  padding = 0.12,
}: FitRouteOptions): BoxPoint[][] | null {
  let count = 0;
  for (const seg of route) count += seg.length;
  if (count < 2) return null;

  // Web Mercator into a unit square. The zoom is irrelevant to the shape — it
  // is a uniform scale, and the fit below divides it straight back out — so
  // this projects at "zoom 0, world size 1" and skips the constant entirely.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const projected: BoxPoint[][] = route.map((seg) =>
    seg.map(([lat, lng]) => {
      const x = (lng + 180) / 360;
      const sin = Math.sin((clampLat(lat) * Math.PI) / 180);
      const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      return { x, y };
    }),
  );

  const availW = width * (1 - 2 * padding);
  const availH = height * (1 - 2 * padding);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  // The smaller of the two scales is the one that fits both; a degenerate span
  // contributes nothing and lets the other axis decide.
  const scaleX = spanX > 0 ? availW / spanX : Infinity;
  const scaleY = spanY > 0 ? availH / spanY : Infinity;
  const scale = Math.min(scaleX, scaleY);
  // Both spans zero means every point is the same coordinate — a route of two
  // identical taps. It has passed the count test but has no shape; centring it
  // at scale 1 puts a dot in the middle, which is the truthful picture.
  const s = Number.isFinite(scale) ? scale : 1;

  // Centre what is left over, so the shape sits in the middle of the box rather
  // than against the padded edge of whichever axis was not the constraint.
  const offsetX = (width - spanX * s) / 2;
  const offsetY = (height - spanY * s) / 2;

  return projected.map((seg) =>
    seg.map(({ x, y }) => ({
      x: offsetX + (x - minX) * s,
      y: offsetY + (y - minY) * s,
    })),
  );
}

/** Web Mercator's latitude limit; past it the log runs to infinity. Mirrors
 *  MAX_MERCATOR_LAT in ../geometry/viewport.ts, which is not imported because
 *  that module is about a live camera and this one is about a still picture. */
function clampLat(lat: number): number {
  return Math.max(-85.051129, Math.min(85.051129, lat));
}
