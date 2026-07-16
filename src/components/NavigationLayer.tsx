// Map-side half of navigation mode: draws the travelled track on top of
// the planned route, shows the live GPS position, and keeps the map
// centred on the user komoot-style — auto-follow that detaches as soon as
// the user pans, with a "re-center" chip to snap back.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import type { LatLng, Route } from '../types';
import { projectOntoRoute, splitRouteAt } from '../geometry';
import { LocateIcon } from './icons';
import styles from './NavigationLayer.module.css';

// The travelled line: warm orange so it reads clearly against the teal
// planned route, with the same white halo treatment for busy overlays.
const TRACK_COLOR = '#f97316';
const TRACK_WEIGHT = 4;
const HALO_COLOR = '#ffffff';
const HALO_WEIGHT = TRACK_WEIGHT + 3;
const HALO_OPACITY = 0.9;
const FOLLOW_ZOOM = 15;

// On-route indication: while navigating within SNAP_MAX_M of the planned
// route, a dotted connector is drawn from the live position to the nearest
// point on the plan, and the part of the plan already passed is repainted
// gray. Beyond SNAP_MAX_M the plan stays fully teal — a straight connector
// across kilometres of terrain would suggest a shortcut that likely doesn't
// exist. Same width as the planned route so the gray reads as a state of
// the same line, not a separate object.
const SNAP_MAX_M = 1000;
const DONE_COLOR = '#9ca3af';
const DONE_WEIGHT = 4; // matches ROUTE_WEIGHT in DrawingHandler
const CONNECTOR_COLOR = '#6b7280';
const CONNECTOR_WEIGHT = 3;
const CONNECTOR_DASH = '1 9';

interface Props {
  /** True while recording/paused: enables follow behaviour + the chip. */
  active: boolean;
  /** The travelled track so far (drawn whenever non-empty, incl. review). */
  track: Route;
  /** Latest GPS fix; the marker follows every fix, gated or not. */
  position: LatLng | null;
  /** Accuracy of the latest fix in meters (drawn as a soft ring). */
  accuracy: number | null;
  /** The planned route being followed (for the connector + progress gray). */
  plannedRoute?: Route;
}

export function NavigationLayer({
  active,
  track,
  position,
  accuracy,
  plannedRoute = [],
}: Props) {
  const map = useMap();
  const [follow, setFollow] = useState(true);
  // First fix of a session gets a real setView (zoom in to street level);
  // subsequent fixes just pan, preserving whatever zoom the user chose.
  const zoomedRef = useRef(false);

  // (Re)arm follow whenever a navigation session starts. Done as an
  // adjust-state-during-render transition (React's supported pattern)
  // rather than an effect, so there's no extra render cascade.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setFollow(true);
  }

  // The zoom-in-once flag is reset in an effect (refs must not be written
  // during render). Declared before the follow effect below so a fresh
  // session zooms before it starts panning.
  useEffect(() => {
    if (active) zoomedRef.current = false;
  }, [active]);

  // A manual pan detaches follow — komoot behaviour. Programmatic panTo
  // doesn't fire dragstart, so only real user gestures detach.
  useMapEvents({
    dragstart() {
      if (active) setFollow(false);
    },
  });

  useEffect(() => {
    if (!active || !follow || !position) return;
    if (!zoomedRef.current) {
      zoomedRef.current = true;
      map.setView(position, Math.max(map.getZoom(), FOLLOW_ZOOM), {
        animate: true,
      });
    } else {
      map.panTo(position, { animate: true });
    }
  }, [active, follow, position, map]);

  const hasFix = position !== null;

  // Where the live position sits relative to the planned route. Only while
  // actively navigating with a fix and within SNAP_MAX_M — otherwise the
  // plan is left untouched (fully teal, no connector).
  const snap = useMemo(() => {
    if (!active || !position || plannedRoute.length === 0) return null;
    const proj = projectOntoRoute(plannedRoute, position);
    if (!proj || proj.distanceM > SNAP_MAX_M) return null;
    return { proj, done: splitRouteAt(plannedRoute, proj).done };
  }, [active, position, plannedRoute]);

  return (
    <>
      {/* Progress on the plan: the passed part repainted gray. Rendered
          before the travelled track so the orange line stays on top. */}
      {snap &&
        snap.done.map((seg, i) =>
          seg.length >= 2 ? (
            <Polyline
              key={`done-${i}`}
              positions={seg}
              pathOptions={{ color: DONE_COLOR, weight: DONE_WEIGHT }}
            />
          ) : null,
        )}
      {/* Dotted connector from the live position to the nearest point on
          the plan — the "get (back) on track" hint. */}
      {snap && position && (
        <Polyline
          positions={[position, snap.proj.point]}
          pathOptions={{
            color: CONNECTOR_COLOR,
            weight: CONNECTOR_WEIGHT,
            dashArray: CONNECTOR_DASH,
            lineCap: 'round',
          }}
        />
      )}
      {/* Travelled track: white halo beneath, orange line on top. */}
      {track.map((seg, i) =>
        seg.length >= 2 ? (
          <Polyline
            key={`track-halo-${i}`}
            positions={seg}
            pathOptions={{
              color: HALO_COLOR,
              weight: HALO_WEIGHT,
              opacity: HALO_OPACITY,
            }}
          />
        ) : null,
      )}
      {track.map((seg, i) =>
        seg.length >= 2 ? (
          <Polyline
            key={`track-${i}`}
            positions={seg}
            pathOptions={{ color: TRACK_COLOR, weight: TRACK_WEIGHT }}
          />
        ) : null,
      )}
      {/* Live position: accuracy ring + a solid dot with white rim. */}
      {hasFix && accuracy !== null && accuracy > 15 && (
        <Circle
          center={position}
          radius={accuracy}
          pathOptions={{
            color: TRACK_COLOR,
            weight: 1,
            opacity: 0.35,
            fillColor: TRACK_COLOR,
            fillOpacity: 0.08,
          }}
        />
      )}
      {hasFix && (
        <CircleMarker
          center={position}
          radius={8}
          pathOptions={{
            color: '#ffffff',
            weight: 3,
            fillColor: TRACK_COLOR,
            fillOpacity: 1,
          }}
        />
      )}
      {active && !follow && (
        <button
          type="button"
          className={styles.recenter}
          onClick={() => setFollow(true)}
          title="Re-center on your position"
          aria-label="Re-center on your position"
        >
          <LocateIcon />
          <span>Re-center</span>
        </button>
      )}
    </>
  );
}
