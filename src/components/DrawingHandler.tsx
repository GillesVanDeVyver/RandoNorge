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

export function DrawingHandler({ mode, route, onRouteChange }: Props) {
  const map = useMap();
  const drawingRef = useRef<Segment | null>(null);
  const erasingRef = useRef(false);
  const [livePoints, setLivePoints] = useState<Segment>([]);

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
      container.style.cursor = mode === 'draw' ? 'crosshair' : 'cell';
    }
    return () => {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      container.style.cursor = '';
    };
  }, [mode, map]);

  // Erase all route vertices within ERASER_RADIUS_M of the cursor.
  // Splits a segment if an interior vertex is removed.
  const eraseAt = (cursor: LatLng) => {
    const next: Route = [];
    let changed = false;
    for (const seg of route) {
      let current: Segment = [];
      for (const p of seg) {
        const d = map.distance(cursor, p);
        if (d <= ERASER_RADIUS_M) {
          changed = true;
          if (current.length >= 2) next.push(current);
          current = [];
        } else {
          current.push(p);
        }
      }
      if (current.length >= 2) {
        next.push(current);
      } else if (current.length > 0) {
        changed = true; // dropped a 1-point fragment
      }
    }
    if (changed) onRouteChange(next);
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
      erasingRef.current = false;
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
      erasingRef.current = false;
    },
  });

  return (
    <>
      {route.map((seg, i) => (
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
