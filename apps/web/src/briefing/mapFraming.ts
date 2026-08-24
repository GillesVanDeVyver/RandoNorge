// How close the printed map is drawn, and where it is pointed.
//
// A briefing opens on the whole tour, which is the right picture often enough
// to be the default and wrong often enough to need a way out: a 14 km traverse
// fitted into 128 mm of paper is a line, and the col the party actually has to
// judge is four pixels of it. So the frame can be moved and closed in. What
// governs that is deliberately small — a handful of steps, a bounded reach —
// because the frame is a picture being composed for one sheet, not a map being
// browsed.
//
// Two renderers answer to these numbers. The flat map (staticMap.ts) stitches
// Web-Mercator tiles and honours the whole Framing below, zoom and pan
// together. The 3D view (terrainMap.ts) flies a MapLibre camera, and takes the
// zoom as a number but the pan only as a limit: a camera that is pitched and
// turned is the one thing that knows how a drag across the glass becomes a
// distance over the ground, so it does that arithmetic itself and asks this
// module only how far it is then allowed to be from the route.
//
// Stating the zoom here, as an offset from each renderer's own fit rather than
// as a zoom level, is what makes one press mean the same amount of closer in
// both — and what makes 0 mean "the map as it was before anyone touched it" on
// a short tour and a long one alike. Stating the reach in fits does the same
// for wandering: one number, so a frame cannot be walked off the route on one
// renderer and held to it on the other.

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** Steps out from the fit. Two shows four times the ground, which is enough to
 *  put a tour in its valley; further out and the route is a scratch on an
 *  otherwise empty map, which no briefing has ever needed. */
export const ZOOM_MIN = -2;

/** Steps in. Four is sixteen times closer, which on a typical tour is a couple
 *  of hundred metres across — the scale a cornice or a gully entrance is
 *  judged at, and about where Kartverket's and NVE's deepest tiles give out.
 *  Past that the picture stops gaining detail and only gains blur. */
export const ZOOM_MAX = 4;

/** What one press of a button moves. Half a level rather than a whole one: a
 *  whole step doubles the scale, which on the way in overshoots the feature
 *  the guide was aiming at more often than it lands on it. */
export const ZOOM_STEP = 0.5;

/** How far the frame's centre may leave the route's, measured in *fits* — in
 *  units of the framing that shows the whole tour, not of the frame currently
 *  being looked through.
 *
 *  This is the only reach that behaves. A limit stated in frames would let a
 *  fitted map wander a whole tour clear of the route while a closely zoomed
 *  one could travel a hundred metres, which is exactly backwards: the fitted
 *  map already shows everything and has nowhere to go, and it is the close map
 *  that needs to walk the length of the route to the crux.
 *
 *  Exported because the 3D view enforces the same reach on its own camera. Note
 *  what "in fits" buys there: because the limit below is multiplied by the zoom
 *  and the frame is divided by it, the two cancel, and the reach is a fixed
 *  distance over the ground — three quarters of the fitted frame, at every
 *  zoom. That is a sentence a camera can act on without owning a Framing, which
 *  is why the 3D map can obey this number while keeping its own arithmetic.
 *
 *  Three quarters is chosen to be plainly more than half: half a frame puts the
 *  route's far end exactly on the edge of the picture, and either end of a tour
 *  is precisely what a guide zooms in to look at. */
export const PAN_REACH = 0.75;

export interface Framing {
  /** Zoom offset from the renderer's own fit-to-route framing, in map zoom
   *  levels. Fractional, so a wheel moves smoothly rather than in jumps of a
   *  factor of two; 0 is always the untouched fit. */
  zoom: number;
  /** The frame's centre relative to the route's, in fractions of the frame's
   *  own width and height. Fractions rather than pixels so that a gesture
   *  measured on a 360-pixel preview means the same thing to the 1280-pixel
   *  render behind it. */
  pan: { x: number; y: number };
}

/** The whole tour, untouched. What every briefing opens on, and what the way
 *  back leads to. */
export const FIT: Framing = { zoom: 0, pan: { x: 0, y: 0 } };

export const clampZoom = (zoom: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/** The pan limit at a given zoom, in frames. See PAN_REACH. */
const panLimit = (zoom: number): number => PAN_REACH * 2 ** zoom;

function clampPan(pan: Framing['pan'], zoom: number): Framing['pan'] {
  const limit = panLimit(zoom);
  return {
    x: Math.min(limit, Math.max(-limit, pan.x)),
    y: Math.min(limit, Math.max(-limit, pan.y)),
  };
}

/** True when nothing has been asked of the framing, and so there is nothing to
 *  undo. The way back is offered either way — a button that appears only once
 *  it is needed is a button nobody knows is there — but it can say so. */
export const isFit = (f: Framing): boolean =>
  f.zoom === 0 && f.pan.x === 0 && f.pan.y === 0;

/**
 * Move the frame by a drag, given as fractions of the frame the user can see.
 * The map follows the pointer, so the frame's own centre goes the other way.
 */
export function panBy(f: Framing, dx: number, dy: number): Framing {
  return {
    zoom: f.zoom,
    pan: clampPan({ x: f.pan.x - dx, y: f.pan.y - dy }, f.zoom),
  };
}

/**
 * Zoom by `delta` levels, keeping whatever is under `anchor` where it is.
 *
 * `anchor` is a point in the frame as fractions from its centre, so (0, 0) is
 * the middle and (0.5, -0.5) the top-right corner. The buttons pass the
 * middle, having nothing better to aim at; the wheel passes the pointer,
 * because a map that zooms away from the thing being pointed at has to be
 * chased across the frame afterwards.
 */
export function zoomBy(
  f: Framing,
  delta: number,
  anchor: { x: number; y: number } = { x: 0, y: 0 },
): Framing {
  const zoom = clampZoom(f.zoom + delta);
  // The clamp ate the step. Handing back the same object leaves React's state
  // untouched, so a wheel spun on at the limit does not redraw the map — and
  // a redraw here means refetching every tile in the frame.
  if (zoom === f.zoom) return f;
  // The frame now covers 2^-delta of the ground it did, so a point that was
  // `n` frames from its centre is `n * 2^delta` frames from it.
  const k = 2 ** (zoom - f.zoom);
  return {
    zoom,
    pan: clampPan(
      {
        x: (f.pan.x + anchor.x) * k - anchor.x,
        y: (f.pan.y + anchor.y) * k - anchor.y,
      },
      zoom,
    ),
  };
}

/** How much of a zoom level one notch of a wheel is worth. Browsers report
 *  wheels in three different units and no two mice agree on the size of a
 *  notch, so the delta is normalised towards the ~100-per-notch a plain mouse
 *  reports and divided down from there: a notch moves a quarter of a level,
 *  four notches to a doubling. Fine enough to stop where you meant, coarse
 *  enough to cross the whole range in a flick. */
const WHEEL_PER_LEVEL = 400;
/** A "line" and a "page", for the browsers that report wheels in those. */
const WHEEL_LINE = 16;
const WHEEL_PAGE = 400;

/**
 * Zoom `ref`'s element with the wheel, reporting the pointer as the anchor.
 *
 * Attached by hand rather than through React's `onWheel` for one reason that
 * matters: React registers its wheel listener passively, where preventDefault
 * does nothing, and without preventDefault a wheel aimed at the map scrolls
 * the sheet out from under the pointer instead of zooming.
 */
export function useWheelZoom<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onZoom: (delta: number, anchor: { x: number; y: number }) => void,
): void {
  // Held in a ref so a caller passing a fresh closure each render does not
  // detach and reattach the listener between one wheel tick and the next.
  const cb = useRef(onZoom);
  useEffect(() => {
    cb.current = onZoom;
  }, [onZoom]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const unit =
        e.deltaMode === 1 ? WHEEL_LINE : e.deltaMode === 2 ? WHEEL_PAGE : 1;
      // Up the wheel is in, matching every map anyone has used.
      cb.current(-(e.deltaY * unit) / WHEEL_PER_LEVEL, {
        x: (e.clientX - box.left) / box.width - 0.5,
        y: (e.clientY - box.top) / box.height - 0.5,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);
}
