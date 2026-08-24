import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  useMap,
  useMapEvents,
  CircleMarker,
  Marker,
  Polyline,
} from 'react-leaflet';
import type { DrawStyle, LatLng, Mode, Route, Segment } from '@fjellrute/core/types';
import { routeConnectors, routeEnds, simplify } from '@fjellrute/core/geometry';
// The route's colour, widths and endpoint dots. Shared with the canvas
// renderer behind the printed briefing, so the exported map is a miniature of
// this one rather than a second, heavier drawing of the same tour.
import {
  ROUTE_COLOR,
  ROUTE_WEIGHT,
  HALO_COLOR,
  HALO_WEIGHT,
  HALO_OPACITY,
  START_COLOR,
  FINISH_COLOR,
  ENDPOINT_RADIUS,
  ENDPOINT_RING,
  CONNECTOR_COLOR,
  connectorWeight,
  connectorDash,
} from '../routeStyle';
import { useT } from '@fjellrute/core/i18n';
import styles from './DrawingHandler.module.css';

interface Props {
  mode: Mode;
  /** Freehand (fluent line) or straight lines between clicked vertices. */
  drawStyle?: DrawStyle;
  route: Route;
  onRouteChange: (route: Route) => void;
}

const RDP_EPSILON_M = 8;
// Eraser "effect radius" in screen pixels. Defining it in pixel space
// (rather than metres) keeps the eraser a constant, comfortable size on
// screen — so the ground-distance radius automatically scales up
// proportionally as the user zooms out.
const ERASER_RADIUS_PX = 32;
// Minimum pixel distance between consecutive accepted points while drawing.
// Caps the number of accumulated points to be proportional to stroke length
// rather than stroke duration, which otherwise blows up O(N²) work on long
// strokes (slice + Polyline rebuild on every mousemove).
const MIN_DRAW_PX = 3;
const MIN_DRAW_PX2 = MIN_DRAW_PX * MIN_DRAW_PX;

// Path options are module constants rather than inline literals: react-leaflet
// re-applies setStyle() whenever the `pathOptions` reference changes, which
// would repaint every committed polyline on each re-render — and lines mode
// re-renders once per animation frame while the rubber band follows the
// cursor. Stable references keep those repaints to the geometry that moved.
const HALO_STYLE = {
  color: HALO_COLOR,
  weight: HALO_WEIGHT,
  opacity: HALO_OPACITY,
} as const;
const LIVE_HALO_STYLE = {
  color: HALO_COLOR,
  weight: HALO_WEIGHT,
  opacity: HALO_OPACITY * 0.7,
} as const;
const LINE_STYLE = { color: ROUTE_COLOR, weight: ROUTE_WEIGHT } as const;
const LIVE_LINE_STYLE = {
  color: ROUTE_COLOR,
  weight: ROUTE_WEIGHT,
  opacity: 0.7,
} as const;
// Dashed leg from the last placed vertex to the cursor, so the next straight
// segment is visible before it is committed.
const RUBBER_BAND_STYLE = {
  color: ROUTE_COLOR,
  weight: ROUTE_WEIGHT - 1,
  opacity: 0.75,
  dashArray: '6 7',
} as const;
// Dotted leg across a gap between two consecutive segments, so an erased or
// multi-part tour still reads as one tour walked in one order. Gray rather than
// teal because nobody drew this ground — see routeStyle's CONNECTOR_COLOR.
const CONNECTOR_STYLE = {
  color: CONNECTOR_COLOR,
  weight: connectorWeight(),
  dashArray: connectorDash().join(' '),
  lineCap: 'round',
} as const;
// Start and finish dots, white-ringed so they read against both the topo base
// and the steepness ramp. Non-interactive, like every other decoration on this
// layer: a dot that swallowed a click would put a hole in the drawing surface
// exactly where a route most often needs extending.
const START_STYLE = {
  color: '#ffffff',
  weight: ENDPOINT_RING,
  fillColor: START_COLOR,
  fillOpacity: 1,
} as const;
const FINISH_STYLE = {
  color: '#ffffff',
  weight: ENDPOINT_RING,
  fillColor: FINISH_COLOR,
  fillOpacity: 1,
} as const;

// ---- Straight-line mode ---------------------------------------------------
// Size of the draggable vertex dots, kept in sync with DrawingHandler.module.css
// so the anchor sits exactly on the point.
const VERTEX_PX = 14;
const MIDPOINT_PX = 11;
// Don't offer a midpoint handle on edges shorter than this on screen — the
// ghost dot would sit on top of its own two vertices and just add clutter.
const MIN_MIDPOINT_EDGE_PX = 34;
// Two clicks of a double-click land within a few pixels of each other. The
// second one has already appended a vertex by the time `dblclick` fires, so
// anything this close to its predecessor is treated as that duplicate and
// dropped before the line is finished.
const DUP_CLICK_PX = 8;
// A vertex edit (click, drag, delete) republishes the route so the elevation
// profile and stats follow along, but doing that on every single click would
// re-run the whole worker + Kartverket fetch a dozen times while the user is
// still placing points. Edits are therefore coalesced: the route is published
// once the user pauses — and immediately when the line is finished.
const LINES_COMMIT_DELAY_MS = 500;

// Pink tilted eraser block matching the toolbar icon, used as the
// cursor while in erase mode. Hotspot is set to the bottom-left
// working corner of the rotated rect (~(7, 22) in the 28×28 viewport),
// so the disk is centred on the visible eraser tip.
const ERASER_CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 44 44'>
  <g transform='rotate(-30 22 22)' fill='#FFFFFF' stroke='#111' stroke-width='1.6' stroke-linejoin='round' stroke-linecap='round'>
    <rect x='5' y='18' width='34' height='10' rx='2.5'/>
    <rect x='5' y='14' width='34' height='8' rx='2.5'/>
    <line x1='19' y1='14' x2='19' y2='22'/>
  </g>
</svg>`;
const ERASER_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(ERASER_CURSOR_SVG)}") 10 36, cell`;

export function DrawingHandler({
  mode,
  drawStyle = 'freehand',
  route,
  onRouteChange,
}: Props) {
  const map = useMap();
  const t = useT();
  const drawingRef = useRef<Segment | null>(null);
  const erasingRef = useRef(false);
  const [livePoints, setLivePoints] = useState<Segment>([]);
  // Last accepted cursor position in container-pixel space, used by the
  // distance gate in draw mode.
  const lastDrawPxRef = useRef<{ x: number; y: number } | null>(null);
  // rAF id for the coalesced live-preview update. At most one re-render of
  // the in-progress Polyline per animation frame, regardless of mousemove
  // event rate.
  const liveRafRef = useRef<number | null>(null);

  // Which pencil is live. Freehand drags a stroke; lines places vertices.
  const freehandActive = mode === 'draw' && drawStyle === 'freehand';
  const linesActive = mode === 'draw' && drawStyle === 'lines';

  const scheduleLiveUpdate = () => {
    if (liveRafRef.current !== null) return;
    liveRafRef.current = requestAnimationFrame(() => {
      liveRafRef.current = null;
      if (drawingRef.current) setLivePoints(drawingRef.current.slice());
    });
  };

  const cancelLiveUpdate = () => {
    if (liveRafRef.current !== null) {
      cancelAnimationFrame(liveRafRef.current);
      liveRafRef.current = null;
    }
  };
  // While the user holds the eraser, mutations are accumulated here so the
  // expensive elevation/snow recompute (driven by onRouteChange) only fires
  // once on mouseup. Null when not actively erasing.
  const eraseRouteRef = useRef<Route | null>(null);
  const [eraseRoute, setEraseRoute] = useState<Route | null>(null);

  // Toggle map interactions and cursor based on mode.
  useEffect(() => {
    const container = map.getContainer();
    if (mode === 'idle') {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      container.style.cursor = '';
      container.style.touchAction = '';
    } else if (linesActive) {
      // Vertices are placed by clicking, so panning and pinch-zooming stay
      // available while drawing — exactly like the ut.no / norgeskart tools,
      // where you can drag the map between clicks to follow a valley.
      // Double-click zoom stays off: that gesture finishes the line.
      map.dragging.enable();
      map.doubleClickZoom.disable();
      container.style.cursor = 'crosshair';
      container.style.touchAction = '';
    } else {
      map.dragging.disable();
      map.doubleClickZoom.disable();
      container.style.cursor = mode === 'draw' ? 'crosshair' : ERASER_CURSOR;
      // Stop the browser from treating a one-finger drag as page pan/zoom
      // so touchmove events reach the drawing handlers below.
      container.style.touchAction = 'none';
    }
    return () => {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      container.style.cursor = '';
      container.style.touchAction = '';
    };
  }, [mode, linesActive, map]);

  // Erase every part of the route that lies inside a disk of radius
  // ERASER_RADIUS_PX around the cursor. Works edge-by-edge so the user
  // can cut through the middle of a long edge between vertices (RDP
  // simplification can leave vertices tens of metres apart, well beyond
  // the eraser radius). Where an edge crosses the disk boundary we
  // insert the intersection point so the visible line ends cleanly at
  // the disk edge. Mutates the in-progress eraseRouteRef rather than
  // the committed route so the elevation/snow recompute is deferred to
  // mouseup.
  const eraseAt = (cursor: LatLng) => {
    const source = eraseRouteRef.current ?? route;
    // Work in container-pixel space for fast planar geometry. The radius
    // is defined directly in pixels so the eraser covers the same
    // on-screen area at any zoom level — i.e. its ground-distance reach
    // scales proportionally as the user zooms out.
    const cursorPx = map.latLngToContainerPoint([cursor[0], cursor[1]]);
    const R = ERASER_RADIUS_PX;
    const R2 = R * R;

    const toLL = (x: number, y: number): LatLng => {
      const ll = map.containerPointToLatLng([x, y]);
      return [ll.lat, ll.lng];
    };

    const next: Route = [];
    let changed = false;

    for (const seg of source) {
      if (seg.length === 0) continue;
      const pxs = seg.map((p) =>
        map.latLngToContainerPoint([p[0], p[1]]),
      );
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
                current.push(toLL(a.x + t * dx, a.y + t * dy));
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
                current.push(toLL(a.x + t * dx, a.y + t * dy));
              }
            }
          }
          if (current.length >= 2) next.push(current);
          current = [];
          changed = true;
        } else {
          // Both endpoints outside: the edge may still pass through the
          // disk (mid-edge cut). Split iff the quadratic has two roots
          // in (0,1).
          let split = false;
          if (qa > 0) {
            const disc = qb * qb - 4 * qa * qc;
            if (disc > 0) {
              const sq = Math.sqrt(disc);
              const t1 = (-qb - sq) / (2 * qa);
              const t2 = (-qb + sq) / (2 * qa);
              if (t1 > 0 && t2 < 1 && t1 < t2) {
                current.push(toLL(a.x + t1 * dx, a.y + t1 * dy));
                if (current.length >= 2) next.push(current);
                current = [toLL(a.x + t2 * dx, a.y + t2 * dy), seg[i]];
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

    if (changed) {
      eraseRouteRef.current = next;
      setEraseRoute(next);
    }
  };

  // Commit any pending eraser changes to the parent state. Called when
  // the mouse button is released — the single point where the heavy
  // recompute is allowed to run.
  const commitErase = () => {
    erasingRef.current = false;
    const pending = eraseRouteRef.current;
    eraseRouteRef.current = null;
    setEraseRoute(null);
    if (pending) onRouteChange(pending);
  };

  // Finalize the in-progress draw stroke: simplify and commit it to the
  // parent state if it has at least two points.
  const finishDraw = () => {
    if (!drawingRef.current) return;
    cancelLiveUpdate();
    const simplified = simplify(drawingRef.current, RDP_EPSILON_M);
    if (simplified.length >= 2) {
      onRouteChange([...route, simplified]);
    }
    drawingRef.current = null;
    lastDrawPxRef.current = null;
    setLivePoints([]);
  };

  // A stroke must only be committed when the user actually releases the
  // mouse button — never merely because the cursor left the map container
  // (e.g. brushing over the toolbar or the window edge mid-stroke). The
  // map's own mouseup doesn't fire when the button is released off-map,
  // so we arm a one-shot document-level mouseup listener at stroke start.
  // If the cursor wanders off the map and comes back with the button
  // still held, drawing/erasing simply resumes.
  const docMouseUpRef = useRef<(() => void) | null>(null);
  const armDocMouseUp = () => {
    if (docMouseUpRef.current) return; // already armed for this stroke
    const handler = () => {
      docMouseUpRef.current = null;
      finishDraw();
      commitErase();
    };
    docMouseUpRef.current = handler;
    document.addEventListener('mouseup', handler, { once: true });
  };

  // If the component unmounts (or the mode changes) mid-stroke, drop the
  // pending listener so it can't fire against stale state.
  useEffect(() => {
    return () => {
      if (docMouseUpRef.current) {
        document.removeEventListener('mouseup', docMouseUpRef.current);
        docMouseUpRef.current = null;
      }
    };
  }, [mode]);

  // =======================================================================
  // Straight-line ("lines") mode: click to place vertices, joined by
  // straight segments — the drawing model used by ut.no and norgeskart.
  //
  // The line being placed lives here as a local draft rather than directly
  // in the route, so clicking, dragging and deleting vertices stay instant.
  // The draft is published to the parent (debounced) so the elevation
  // profile and stats keep up, and flushed the moment the line is finished.
  // =======================================================================
  const [draft, setDraftState] = useState<Segment>([]);
  const draftRef = useRef<Segment>([]);
  // The committed route the draft is stacked on top of. Held both as state
  // (the render needs it: while a draft is in progress it, not `route`, is the
  // committed geometry to draw) and as a ref, so the publish/finish helpers
  // can read the current value synchronously from timers and cleanups.
  const [base, setBaseState] = useState<Route>(route);
  const baseRef = useRef<Route>(route);
  const setBase = useCallback((next: Route) => {
    baseRef.current = next;
    setBaseState(next);
  }, []);
  // The exact array last handed to onRouteChange. Lets the route coming back
  // in as a prop be told apart from an external change (clear, import, undo,
  // an eraser stroke) that must reset the draft.
  const emittedRef = useRef<Route | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  // Rubber-band end: the cursor position, drawn as a dashed leg from the
  // last placed vertex so the next segment is visible before it's committed.
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const cursorRafRef = useRef<number | null>(null);
  const pendingCursorRef = useRef<LatLng | null>(null);
  // Live geometry while a handle is being dragged. `insert` distinguishes a
  // midpoint handle (which adds a vertex at `index`) from a vertex handle
  // (which moves the one already at `index`).
  const [handleDrag, setHandleDrag] = useState<{
    index: number;
    pos: LatLng;
    insert: boolean;
  } | null>(null);
  // Current zoom, so midpoint handles can be hidden on edges that are too
  // short on screen to be worth a handle.
  const [zoom, setZoom] = useState(() => map.getZoom());

  // Keep the latest callback in a ref so the publish/finish helpers below can
  // stay referentially stable (they're wired into effects and cleanups).
  const onRouteChangeRef = useRef(onRouteChange);
  useEffect(() => {
    onRouteChangeRef.current = onRouteChange;
  }, [onRouteChange]);

  const publishDraft = useCallback(() => {
    commitTimerRef.current = null;
    const base = baseRef.current;
    const pending = draftRef.current;
    // A single point isn't a line yet: publish the bare base instead, which
    // also cleans up after deleting a two-point line down to one.
    const next = pending.length >= 2 ? [...base, pending] : base;
    if (next === emittedRef.current) return; // already published
    if (next === base && emittedRef.current === null) return; // nothing to undo
    emittedRef.current = next;
    onRouteChangeRef.current(next);
  }, []);

  /** Replace the draft and schedule a (coalesced) publish. */
  const updateDraft = useCallback(
    (next: Segment) => {
      draftRef.current = next;
      setDraftState(next);
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
      }
      commitTimerRef.current = window.setTimeout(
        publishDraft,
        LINES_COMMIT_DELAY_MS,
      );
    },
    [publishDraft],
  );

  // Vertex edits, expressed against the draft as it stands when the gesture
  // ends. Kept as stable callbacks rather than inline handlers so the marker
  // event objects don't have to reach for the draft themselves.
  const insertVertex = useCallback(
    (index: number, pos: LatLng) => {
      const next = draftRef.current.slice();
      next.splice(index, 0, pos);
      updateDraft(next);
    },
    [updateDraft],
  );
  const moveVertex = useCallback(
    (index: number, pos: LatLng) => {
      const next = draftRef.current.slice();
      next[index] = pos;
      updateDraft(next);
    },
    [updateDraft],
  );
  const removeVertex = useCallback(
    (index: number) => {
      updateDraft(draftRef.current.filter((_, j) => j !== index));
    },
    [updateDraft],
  );

  /**
   * Stop editing the current line: publish it immediately and hand it over
   * to the committed route. Safe (and a no-op) with no draft in progress.
   */
  const finishLine = useCallback(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setCursor(null);
    setHandleDrag(null);
    if (draftRef.current.length === 0) return;
    publishDraft();
    // Everything published is now part of the committed base, so a following
    // line stacks on top of it instead of replacing it.
    setBase(emittedRef.current ?? baseRef.current);
    draftRef.current = [];
    setDraftState([]);
  }, [publishDraft, setBase]);

  // Reconcile with route changes that didn't come from here — a clear, an
  // import, the undo toast, an eraser stroke or a freehand stroke. The
  // draft's base would be stale, so the draft is dropped rather than
  // resurrecting geometry the user just removed.
  useEffect(() => {
    if (route === emittedRef.current) return;
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setBase(route);
    emittedRef.current = null;
    draftRef.current = [];
    setDraftState([]);
    setCursor(null);
    setHandleDrag(null);
  }, [route, setBase]);

  // Leaving lines mode (switching tool, pressing Esc, unmounting) finishes
  // the line instead of losing it.
  const finishLineRef = useRef(finishLine);
  useEffect(() => {
    finishLineRef.current = finishLine;
  }, [finishLine]);
  useEffect(() => {
    if (linesActive) return;
    finishLineRef.current();
  }, [linesActive]);
  useEffect(
    () => () => {
      finishLineRef.current();
    },
    [],
  );

  // Keyboard shortcuts while placing a line: Enter finishes it, and
  // Backspace / Delete / Ctrl-Z step back one vertex at a time. (Esc is
  // handled app-wide — it leaves draw mode, which finishes the line.)
  useEffect(() => {
    if (!linesActive) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
      ) {
        return; // the user is typing, not drawing
      }
      const undo =
        e.key === 'Backspace' ||
        e.key === 'Delete' ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z');
      if (e.key === 'Enter') {
        e.preventDefault();
        finishLine();
      } else if (undo && draftRef.current.length > 0) {
        e.preventDefault();
        updateDraft(draftRef.current.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [linesActive, finishLine, updateDraft]);

  const scheduleCursor = (ll: LatLng) => {
    pendingCursorRef.current = ll;
    if (cursorRafRef.current !== null) return;
    cursorRafRef.current = requestAnimationFrame(() => {
      cursorRafRef.current = null;
      setCursor(pendingCursorRef.current);
    });
  };

  useEffect(
    () => () => {
      if (cursorRafRef.current !== null) {
        cancelAnimationFrame(cursorRafRef.current);
      }
    },
    [],
  );

  // Touch support for freehand/erase strokes. Leaflet only synthesises mouse
  // events for taps — a finger *drag* never produces the mousedown/mousemove
  // map events used below, so on mobile drawing silently did nothing. Handle
  // touch strokes with native listeners on the map container instead.
  // Listeners are registered with passive: false so preventDefault() can
  // actually stop the browser's default pan/scroll while a stroke is in
  // progress. Lines mode is deliberately excluded: it is driven by taps
  // (which Leaflet does synthesise as clicks) and must keep one-finger
  // panning between them.
  useEffect(() => {
    if (mode === 'idle' || linesActive) return;
    const container = map.getContainer();

    const touchLatLng = (touch: Touch): LatLng => {
      const rect = container.getBoundingClientRect();
      const ll = map.containerPointToLatLng([
        touch.clientX - rect.left,
        touch.clientY - rect.top,
      ]);
      return [ll.lat, ll.lng];
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        // Second finger down (pinch gesture): commit whatever stroke is in
        // progress and let Leaflet's touchZoom take over.
        finishDraw();
        commitErase();
        return;
      }
      e.preventDefault();
      const ll = touchLatLng(e.touches[0]);
      if (mode === 'draw') {
        drawingRef.current = [ll];
        lastDrawPxRef.current = map.latLngToContainerPoint(ll);
        setLivePoints(drawingRef.current.slice());
      } else {
        erasingRef.current = true;
        eraseAt(ll);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const ll = touchLatLng(e.touches[0]);
      if (mode === 'draw' && drawingRef.current) {
        const pt = map.latLngToContainerPoint(ll);
        const last = lastDrawPxRef.current;
        if (last) {
          const dx = pt.x - last.x;
          const dy = pt.y - last.y;
          if (dx * dx + dy * dy < MIN_DRAW_PX2) return;
        }
        lastDrawPxRef.current = pt;
        drawingRef.current.push(ll);
        scheduleLiveUpdate();
      } else if (mode === 'erase' && erasingRef.current) {
        eraseAt(ll);
      }
    };

    const onTouchEnd = () => {
      finishDraw();
      commitErase();
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, linesActive, map, route, onRouteChange]);

  useMapEvents({
    mousedown(e) {
      if (freehandActive) {
        drawingRef.current = [[e.latlng.lat, e.latlng.lng]];
        lastDrawPxRef.current = map.latLngToContainerPoint(e.latlng);
        setLivePoints(drawingRef.current.slice());
        armDocMouseUp();
      } else if (mode === 'erase') {
        erasingRef.current = true;
        eraseAt([e.latlng.lat, e.latlng.lng]);
        armDocMouseUp();
      }
    },
    mousemove(e) {
      if (freehandActive && drawingRef.current) {
        const pt = map.latLngToContainerPoint(e.latlng);
        const last = lastDrawPxRef.current;
        if (last) {
          const dx = pt.x - last.x;
          const dy = pt.y - last.y;
          if (dx * dx + dy * dy < MIN_DRAW_PX2) return;
        }
        lastDrawPxRef.current = pt;
        drawingRef.current.push([e.latlng.lat, e.latlng.lng]);
        scheduleLiveUpdate();
      } else if (mode === 'erase' && erasingRef.current) {
        eraseAt([e.latlng.lat, e.latlng.lng]);
      } else if (linesActive && !handleDrag && draftRef.current.length > 0) {
        // Not while a handle is being dragged: the rubber band is hidden then,
        // so following the cursor would only cost a re-render (and a full
        // canvas repaint of the route) per mouse move.
        scheduleCursor([e.latlng.lat, e.latlng.lng]);
      }
    },
    // Lines mode: one click, one vertex. Leaflet already swallows the click
    // that ends a map pan, so dragging the map between vertices is safe.
    click(e) {
      if (!linesActive) return;
      updateDraft([...draftRef.current, [e.latlng.lat, e.latlng.lng]]);
      scheduleCursor([e.latlng.lat, e.latlng.lng]);
    },
    // Double-click finishes the line. Its second click has usually already
    // landed on the last vertex handle (which finishes the line itself), but
    // when it reaches the map instead it has appended a duplicate vertex —
    // drop that before finishing.
    dblclick() {
      if (!linesActive) return;
      const pending = draftRef.current;
      if (pending.length >= 2) {
        const a = map.latLngToContainerPoint(pending[pending.length - 1]);
        const b = map.latLngToContainerPoint(pending[pending.length - 2]);
        if (a.distanceTo(b) <= DUP_CLICK_PX) {
          draftRef.current = pending.slice(0, -1);
          setDraftState(draftRef.current);
        }
      }
      finishLine();
    },
    // The rubber band shouldn't dangle off a cursor that has left the map.
    mouseout() {
      if (linesActive) setCursor(null);
    },
    zoomend() {
      setZoom(map.getZoom());
    },
    // Note: no mouseup handler here. Committing a freehand stroke is handled
    // exclusively by the document-level mouseup listener armed in mousedown,
    // so leaving the map container mid-stroke does NOT interrupt or save the
    // route — only releasing the button does.
  });

  // ---- Lines mode geometry & handles ------------------------------------
  // The line as it should look right now, including any handle being dragged.
  const previewDraft = useMemo(() => {
    if (!handleDrag) return draft;
    const next = draft.slice();
    if (handleDrag.insert) next.splice(handleDrag.index, 0, handleDrag.pos);
    else next[handleDrag.index] = handleDrag.pos;
    return next;
  }, [draft, handleDrag]);

  // Midpoint of every draft edge that is long enough on screen to deserve a
  // handle. Projected at the current zoom so the dot sits on the visual
  // middle of the leg (a plain lat/lng average drifts in Web Mercator).
  const midpoints = useMemo(() => {
    if (!linesActive || draft.length < 2) return [];
    const out: { index: number; pos: LatLng }[] = [];
    for (let i = 1; i < draft.length; i++) {
      const a = map.project(draft[i - 1], zoom);
      const b = map.project(draft[i], zoom);
      if (a.distanceTo(b) < MIN_MIDPOINT_EDGE_PX) continue;
      const mid = map.unproject(a.add(b).divideBy(2), zoom);
      out.push({ index: i, pos: [mid.lat, mid.lng] });
    }
    return out;
  }, [linesActive, draft, map, zoom]);

  const vertexIcon = useMemo(
    () =>
      L.divIcon({
        className: styles.vertex,
        iconSize: [VERTEX_PX, VERTEX_PX],
        iconAnchor: [VERTEX_PX / 2, VERTEX_PX / 2],
      }),
    [],
  );
  const lastVertexIcon = useMemo(
    () =>
      L.divIcon({
        className: `${styles.vertex} ${styles.vertexLast}`,
        iconSize: [VERTEX_PX, VERTEX_PX],
        iconAnchor: [VERTEX_PX / 2, VERTEX_PX / 2],
      }),
    [],
  );
  const midpointIcon = useMemo(
    () =>
      L.divIcon({
        className: styles.midpoint,
        iconSize: [MIDPOINT_PX, MIDPOINT_PX],
        iconAnchor: [MIDPOINT_PX / 2, MIDPOINT_PX / 2],
      }),
    [],
  );

  const markerLatLng = (e: L.LeafletEvent): LatLng => {
    const ll = (e.target as L.Marker).getLatLng();
    return [ll.lat, ll.lng];
  };

  // While a draft is in progress it is rendered from `previewDraft`, so the
  // committed part of the route must exclude it — otherwise the published
  // copy would sit underneath, stale, while a handle is being dragged.
  const displayRoute = eraseRoute ?? (draft.length > 0 ? base : route);
  const showRubberBand =
    linesActive && !handleDrag && cursor !== null && draft.length > 0;

  // Where the day starts and where it ends. Read off the geometry actually on
  // screen — committed segments first, then whatever is being placed or drawn
  // right now, which is the order publishDraft stacks them in — so the finish
  // dot follows the pen instead of waiting for the stroke to be committed.
  //
  // The rule itself lives in geometry/routeEnds, because the printed map and
  // the 3D view mark the same two places and three copies of "first point of
  // the first drawn segment, last point of the last" would eventually disagree
  // about an out-and-back, which puts both dots in one spot, red over green.
  const endpoints = useMemo(
    () => routeEnds([...displayRoute, previewDraft, livePoints]),
    [displayRoute, previewDraft, livePoints],
  );

  // Dotted legs bridging the gaps between committed segments, so a tour cut in
  // two by the eraser still reads as one tour in one order.
  //
  // Committed geometry only — unlike the endpoint dots above, which follow the
  // pen. A finish dot travelling with the stroke is the drawing keeping up; a
  // dotted line rubber-banding across the map from the previous segment on
  // every mousemove is just a second rubber band arguing with the real one.
  // Since `displayRoute` is the eraser's pending result while erasing, the
  // connector still appears the moment the eraser opens a gap.
  const connectors = useMemo(() => routeConnectors(displayRoute), [displayRoute]);

  return (
    <>
      {/* Gap connectors at the very bottom, so the drawn route and its halo
          always win where the two meet and the dots tuck under the line
          instead of crossing it. */}
      {connectors.map((leg, i) => (
        <Polyline
          key={`gap-${i}`}
          positions={leg}
          pathOptions={CONNECTOR_STYLE}
          interactive={false}
        />
      ))}
      {/* White halos first, so every teal line renders on top of every halo. */}
      {displayRoute.map((seg, i) => (
        <Polyline key={`halo-${i}`} positions={seg} pathOptions={HALO_STYLE} />
      ))}
      {previewDraft.length >= 2 && (
        <Polyline positions={previewDraft} pathOptions={HALO_STYLE} />
      )}
      {livePoints.length >= 2 && (
        <Polyline positions={livePoints} pathOptions={LIVE_HALO_STYLE} />
      )}
      {displayRoute.map((seg, i) => (
        <Polyline key={i} positions={seg} pathOptions={LINE_STYLE} />
      ))}
      {previewDraft.length >= 2 && (
        <Polyline positions={previewDraft} pathOptions={LINE_STYLE} />
      )}
      {showRubberBand && (
        <Polyline
          positions={[previewDraft[previewDraft.length - 1], cursor]}
          pathOptions={RUBBER_BAND_STYLE}
        />
      )}
      {livePoints.length >= 2 && (
        <Polyline positions={livePoints} pathOptions={LIVE_LINE_STYLE} />
      )}
      {/* Start green, finish red — over the lines so they aren't buried by a
          route that doubles back, under the editing handles so they never
          take a grab away from a vertex. */}
      {endpoints && (
        <>
          <CircleMarker
            center={endpoints.start}
            radius={ENDPOINT_RADIUS}
            pathOptions={START_STYLE}
            interactive={false}
          />
          {endpoints.end && (
            <CircleMarker
              center={endpoints.end}
              radius={ENDPOINT_RADIUS}
              pathOptions={FINISH_STYLE}
              interactive={false}
            />
          )}
        </>
      )}
      {/* Editable handles for the line being placed. Midpoints render below
          the vertices so overlapping dots stay grabbable.

          react-hooks/refs is switched off across the two blocks that follow.
          Every function in them is a Leaflet drag/click callback and so can
          only run after render — but the rule can't see that: `eventHandlers`
          is a prop on a third-party component (react-leaflet's Marker), and a
          function handed to a component the compiler can't inspect might, as
          far as it knows, be called while that component renders. Every ref
          read reachable from a handler (the draft, the debounce timer) is
          therefore reported. Re-enabled immediately after the handles. */}
      {/* eslint-disable react-hooks/refs */}
      {linesActive &&
        midpoints.map((mid) => (
          <Marker
            key={`mid-${mid.index}`}
            position={mid.pos}
            icon={midpointIcon}
            draggable
            bubblingMouseEvents={false}
            keyboard={false}
            title={t(
              'Dra for å legge til et punkt her',
              'Drag to add a point here',
            )}
            eventHandlers={{
              dragstart: (e) =>
                setHandleDrag({
                  index: mid.index,
                  pos: markerLatLng(e),
                  insert: true,
                }),
              drag: (e) =>
                setHandleDrag({
                  index: mid.index,
                  pos: markerLatLng(e),
                  insert: true,
                }),
              dragend: (e) => {
                const pos = markerLatLng(e);
                setHandleDrag(null);
                insertVertex(mid.index, pos);
              },
              click: () => insertVertex(mid.index, mid.pos),
            }}
          />
        ))}
      {linesActive &&
        draft.map((point, i) => {
          const isLast = i === draft.length - 1;
          return (
            <Marker
              key={`vertex-${i}`}
              position={point}
              icon={isLast ? lastVertexIcon : vertexIcon}
              draggable
              bubblingMouseEvents={false}
              keyboard={false}
              zIndexOffset={100}
              title={
                isLast
                  ? t(
                      'Dra for å flytte · klikk for å fullføre linja',
                      'Drag to move · click to finish the line',
                    )
                  : t(
                      'Dra for å flytte · klikk for å fjerne punktet',
                      'Drag to move · click to remove the point',
                    )
              }
              eventHandlers={{
                dragstart: (e) =>
                  setHandleDrag({
                    index: i,
                    pos: markerLatLng(e),
                    insert: false,
                  }),
                drag: (e) =>
                  setHandleDrag({
                    index: i,
                    pos: markerLatLng(e),
                    insert: false,
                  }),
                dragend: (e) => {
                  setHandleDrag(null);
                  moveVertex(i, markerLatLng(e));
                },
                click: () => {
                  // Clicking the leading vertex closes the line off, the
                  // convention on ut.no/norgeskart and in Leaflet.draw. Any
                  // other vertex is simply removed.
                  if (isLast) finishLine();
                  else removeVertex(i);
                },
              }}
            />
          );
        })}
      {/* eslint-enable react-hooks/refs */}
    </>
  );
}
