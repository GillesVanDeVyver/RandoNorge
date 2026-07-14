import { useEffect, useRef, useState } from 'react';
import { useMap, useMapEvents, Polyline } from 'react-leaflet';
import type { LatLng, Mode, Route, Segment } from '../types';
import { simplify } from '../geometry';

interface Props {
  mode: Mode;
  route: Route;
  onRouteChange: (route: Route) => void;
}

const RDP_EPSILON_M = 8;
// Eraser "effect radius" in screen pixels. Defining it in pixel space
// (rather than metres) keeps the eraser a constant, comfortable size on
// screen — so the ground-distance radius automatically scales up
// proportionally as the user zooms out.
const ERASER_RADIUS_PX = 32;
const ROUTE_COLOR = '#FF3D81';
const ROUTE_WEIGHT = 4;
// Minimum pixel distance between consecutive accepted points while drawing.
// Caps the number of accumulated points to be proportional to stroke length
// rather than stroke duration, which otherwise blows up O(N²) work on long
// strokes (slice + Polyline rebuild on every mousemove).
const MIN_DRAW_PX = 3;
const MIN_DRAW_PX2 = MIN_DRAW_PX * MIN_DRAW_PX;

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

export function DrawingHandler({ mode, route, onRouteChange }: Props) {
  const map = useMap();
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
    } else {
      map.dragging.disable();
      map.doubleClickZoom.disable();
      container.style.cursor = mode === 'draw' ? 'crosshair' : ERASER_CURSOR;
    }
    return () => {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      container.style.cursor = '';
    };
  }, [mode, map]);

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

  useMapEvents({
    mousedown(e) {
      if (mode === 'draw') {
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
      if (mode === 'draw' && drawingRef.current) {
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
      }
    },
    // Note: no mouseup/mouseout handlers here. Committing the stroke is
    // handled exclusively by the document-level mouseup listener armed in
    // mousedown, so leaving the map container mid-stroke does NOT
    // interrupt or save the route — only releasing the button does.
  });

  const displayRoute = eraseRoute ?? route;

  return (
    <>
      {displayRoute.map((seg, i) => (
        <Polyline
          key={i}
          positions={seg}
          pathOptions={{ color: ROUTE_COLOR, weight: ROUTE_WEIGHT }}
        />
      ))}
      {livePoints.length >= 2 && (
        <Polyline
          positions={livePoints}
          pathOptions={{
            color: ROUTE_COLOR,
            weight: ROUTE_WEIGHT,
            opacity: 0.7,
          }}
        />
      )}
    </>
  );
}
