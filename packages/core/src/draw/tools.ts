import type { LatLng, Route, Segment } from '../types';

/** The numbers and the geometry behind drawing a route, for every client.
 *
 *  This module exists because of the parity plan's Phase 4 warning: "keep both
 *  identical to the web or the same drag produces different routes on the two
 *  clients". Three constants and one algorithm decide what a drag turns into,
 *  and they were previously written out twice inside apps/web —
 *  DrawingHandler.tsx (Leaflet, 2D) and Map3DView.tsx (MapLibre, 3D) held
 *  character-for-character identical copies of the eraser, differing only in
 *  which project/unproject pair they called. A phone client would have made
 *  three. Two copies that agree are luck; three would not have lasted.
 *
 *  Nothing here touches a map object, a DOM node or a React import. The map is
 *  passed in as the two functions below, which is the whole reason the same
 *  code can serve Leaflet, MapLibre GL JS and MapLibre React Native. */

/** RDP simplification tolerance for a finished freehand stroke, in metres.
 *
 *  A freehand drag arrives as one point per pointer event, which is a function
 *  of how long the finger was moving rather than how far — `simplify` is what
 *  turns that into a polyline whose vertex count follows the shape. 8m is well
 *  under the width of the drawn line at planning zooms, so the simplified route
 *  looks the same as the raw one while carrying a small fraction of the points.
 *
 *  It also sets the floor on how far apart consecutive vertices can end up,
 *  which matters to the eraser below: on a straight leg the surviving vertices
 *  can be hundreds of metres apart, far beyond the eraser's reach, so the
 *  eraser cannot work vertex-by-vertex. Hence the mid-edge cut. */
export const RDP_EPSILON_M = 8;

/** Eraser "effect radius", in screen pixels.
 *
 *  Deliberately in pixel space rather than metres: the eraser is a tool held
 *  against the screen, so it should stay a constant, comfortable size under the
 *  finger or cursor at every zoom. Its ground-distance reach then scales up
 *  proportionally as the user zooms out, which is what a user zooming out to
 *  clear a whole hillside expects. 32px is a little under the 44px minimum
 *  touch target — a radius, not a diameter, so the disk is 64px across. */
export const ERASER_RADIUS_PX = 32;

/** Minimum pixel distance between consecutive accepted points while drawing.
 *
 *  Caps the number of accumulated points to be proportional to stroke length
 *  rather than stroke duration. Without it, holding still with the button down
 *  keeps appending coincident points, and the per-frame live redraw (which
 *  copies the in-progress stroke) turns into O(N²) work on a long slow drag. */
export const MIN_DRAW_PX = 3;

/** Squared form, for comparing against a squared distance without a sqrt. */
export const MIN_DRAW_PX2 = MIN_DRAW_PX * MIN_DRAW_PX;

/** A point in the map's screen-pixel space. Structurally what Leaflet's
 *  L.Point and MapLibre's Point both are, so both can be passed straight
 *  through without a wrapper. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** Map-supplied lat/lng → screen pixels. Must be synchronous: the eraser runs
 *  once per pointer sample and calls it once per route vertex. */
export type ProjectFn = (ll: LatLng) => ScreenPoint;

/** Map-supplied screen pixels → lat/lng, the inverse of ProjectFn. Used only
 *  for the handful of cut points the eraser inserts. */
export type UnprojectFn = (x: number, y: number) => LatLng;

/** Erase every part of `route` that lies inside a disk of `radiusPx` around
 *  `cursor`, returning the new route — or null when the disk touched nothing,
 *  so a caller can skip a state update and the elevation recompute behind it.
 *
 *  Works edge-by-edge rather than vertex-by-vertex, because RDP (see
 *  RDP_EPSILON_M) can leave vertices tens or hundreds of metres apart: dropping
 *  only the vertices inside the disk would leave a long edge running straight
 *  through the middle of it, visibly un-erased. Where an edge crosses the disk
 *  boundary the intersection point is inserted, so the surviving line ends
 *  cleanly at the rim instead of at the last vertex outside it.
 *
 *  All of it happens in the projected pixel space the caller provides, where
 *  the disk is a real circle and the maths is planar and fast. That also means
 *  the eraser follows whatever the caller's projection is doing — on the web's
 *  3D view the disk lies on the terrain surface for free, because MapLibre's
 *  own project() accounts for the pitch.
 *
 *  One-point fragments are dropped rather than kept: a route segment with a
 *  single vertex has no length, draws as nothing, and would still count as a
 *  segment for the dotted connector legs that bridge gaps.
 *
 *  The function is pure — it never mutates `route`. Callers accumulate the
 *  result across a drag in a ref and commit once on release, which is the
 *  single point where the expensive elevation/snow recompute is allowed. */
export function eraseDisk(
  route: Route,
  cursor: LatLng,
  project: ProjectFn,
  unproject: UnprojectFn,
  radiusPx: number = ERASER_RADIUS_PX,
): Route | null {
  const cursorPx = project(cursor);
  const R2 = radiusPx * radiusPx;

  const next: Route = [];
  let changed = false;

  for (const seg of route) {
    if (seg.length === 0) continue;
    const pxs = seg.map(project);
    const inside = pxs.map((pt) => {
      const dx = pt.x - cursorPx.x;
      const dy = pt.y - cursorPx.y;
      return dx * dx + dy * dy <= R2;
    });

    let current: Segment = [];
    if (!inside[0]) current.push(seg[0]);
    else changed = true;

    for (let i = 1; i < seg.length; i++) {
      const a = pxs[i - 1];
      const b = pxs[i];
      const aIn = inside[i - 1];
      const bIn = inside[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const fx = a.x - cursorPx.x;
      const fy = a.y - cursorPx.y;
      // Solve |a + t*(b-a) - cursor|² = R² for t ∈ [0,1].
      const qa = dx * dx + dy * dy;
      const qb = 2 * (fx * dx + fy * dy);
      const qc = fx * fx + fy * fy - R2;

      if (aIn && bIn) {
        // Edge fully inside the disk — drop entirely.
        changed = true;
      } else if (aIn && !bIn) {
        // Exit point: start fresh at where the edge leaves the disk.
        if (qa > 0) {
          const disc = qb * qb - 4 * qa * qc;
          if (disc >= 0) {
            const sq = Math.sqrt(disc);
            const t = (-qb + sq) / (2 * qa);
            if (t > 0 && t < 1) {
              current.push(unproject(a.x + t * dx, a.y + t * dy));
            }
          }
        }
        current.push(seg[i]);
        changed = true;
      } else if (!aIn && bIn) {
        // Entry point: end current at where the edge enters the disk.
        if (qa > 0) {
          const disc = qb * qb - 4 * qa * qc;
          if (disc >= 0) {
            const sq = Math.sqrt(disc);
            const t = (-qb - sq) / (2 * qa);
            if (t > 0 && t < 1) {
              current.push(unproject(a.x + t * dx, a.y + t * dy));
            }
          }
        }
        if (current.length >= 2) next.push(current);
        current = [];
        changed = true;
      } else {
        // Both endpoints outside: the edge may still pass through the disk
        // (mid-edge cut). Split iff the quadratic has two roots in (0,1).
        let split = false;
        if (qa > 0) {
          const disc = qb * qb - 4 * qa * qc;
          if (disc > 0) {
            const sq = Math.sqrt(disc);
            const t1 = (-qb - sq) / (2 * qa);
            const t2 = (-qb + sq) / (2 * qa);
            if (t1 > 0 && t2 < 1 && t1 < t2) {
              current.push(unproject(a.x + t1 * dx, a.y + t1 * dy));
              if (current.length >= 2) next.push(current);
              current = [unproject(a.x + t2 * dx, a.y + t2 * dy), seg[i]];
              changed = true;
              split = true;
            }
          }
        }
        if (!split) current.push(seg[i]);
      }
    }

    if (current.length >= 2) {
      next.push(current);
    } else if (current.length > 0) {
      changed = true; // dropped a 1-point fragment
    }
  }

  return changed ? next : null;
}
