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
const ERASER_RADIUS_M = 20;
const ROUTE_COLOR = '#E91E63';
const ROUTE_WEIGHT = 4;

// Pink tilted eraser block matching the toolbar icon, used as the
// cursor while in erase mode. Hotspot is set to the bottom-left
// working corner of the rotated rect (~(7, 22) in the 28×28 viewport),
// so the disk is centred on the visible eraser tip.
const ERASER_CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'>
  <g transform='rotate(-30 14 14)'>
    <rect x='4' y='10' width='20' height='8' rx='1' fill='#F8BBD0' stroke='#222' stroke-width='1.5'/>
    <line x1='17' y1='10' x2='17' y2='18' stroke='#222' stroke-width='1.5' stroke-linecap='round'/>
  </g>
</svg>`;
const ERASER_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(ERASER_CURSOR_SVG)}") 7 22, cell`;

export function DrawingHandler({ mode, route, onRouteChange }: Props) {
  const map = useMap();
  const drawingRef = useRef<Segment | null>(null);
  const erasingRef = useRef(false);
  const [livePoints, setLivePoints] = useState<Segment>([]);
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
  // ERASER_RADIUS_M around the cursor. Works edge-by-edge so the user
  // can cut through the middle of a long edge between vertices (RDP
  // simplification can leave vertices tens of metres apart, well beyond
  // the eraser radius). Where an edge crosses the disk boundary we
  // insert the intersection point so the visible line ends cleanly at
  // the disk edge. Mutates the in-progress eraseRouteRef rather than
  // the committed route so the elevation/snow recompute is deferred to
  // mouseup.
  const eraseAt = (cursor: LatLng) => {
    const source = eraseRouteRef.current ?? route;
    // Work in container-pixel space for fast planar geometry. Convert
    // the eraser radius (metres) to pixels using a small reference
    // displacement at the cursor's latitude, so the disk stays a true
    // ground-distance circle regardless of zoom or Mercator scaling.
    const cursorPx = map.latLngToContainerPoint([cursor[0], cursor[1]]);
    const refLL: LatLng = [cursor[0], cursor[1] + 0.001];
    const refPx = map.latLngToContainerPoint([refLL[0], refLL[1]]);
    const refMeters = map.distance(cursor, refLL);
    const refPxDist = Math.hypot(refPx.x - cursorPx.x, refPx.y - cursorPx.y);
    const pxPerMeter = refPxDist / refMeters;
    const R = ERASER_RADIUS_M * pxPerMeter;
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

  // Commit any pending eraser changes to the parent state. Called on
  // mouseup or mouseout — the single point where the heavy recompute is
  // allowed to run.
  const commitErase = () => {
    erasingRef.current = false;
    const pending = eraseRouteRef.current;
    eraseRouteRef.current = null;
    setEraseRoute(null);
    if (pending) onRouteChange(pending);
  };

  useMapEvents({
    mousedown(e) {
      if (mode === 'draw') {
        drawingRef.current = [[e.latlng.lat, e.latlng.lng]];
        setLivePoints(drawingRef.current.slice());
      } else if (mode === 'erase') {
        erasingRef.current = true;
        eraseAt([e.latlng.lat, e.latlng.lng]);
      }
    },
    mousemove(e) {
      if (mode === 'draw' && drawingRef.current) {
        drawingRef.current.push([e.latlng.lat, e.latlng.lng]);
        setLivePoints(drawingRef.current.slice());
      } else if (mode === 'erase' && erasingRef.current) {
        eraseAt([e.latlng.lat, e.latlng.lng]);
      }
    },
    mouseup() {
      if (mode === 'draw' && drawingRef.current) {
        const simplified = simplify(drawingRef.current, RDP_EPSILON_M);
        if (simplified.length >= 2) {
          onRouteChange([...route, simplified]);
        }
        drawingRef.current = null;
        setLivePoints([]);
      }
      commitErase();
    },
    mouseout() {
      // If the user drags off the map, commit or discard cleanly.
      if (mode === 'draw' && drawingRef.current) {
        const simplified = simplify(drawingRef.current, RDP_EPSILON_M);
        if (simplified.length >= 2) {
          onRouteChange([...route, simplified]);
        }
        drawingRef.current = null;
        setLivePoints([]);
      }
      commitErase();
    },
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
