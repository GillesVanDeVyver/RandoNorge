import { Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { useParkingAreas } from '../parking/store';
import {
  releaseParkingHighlight,
  takeParkingHighlight,
  useHoveredParkingId,
} from '../parking/hover';
import {
  ANCHOR,
  H,
  OVERHANG,
  parkingSignHtml,
  W,
  type SignState,
} from '../parking/sign';

// Parking signs for the areas listed in the Parking tab, subscribed straight
// from the parking store so the map is untouched when there is no route and
// nothing to show. The signs are permanent: they are how the reader finds the
// lots at all, so they cannot be a thing that only exists while something is
// being hovered.
//
// This file is the wiring — which sign is lit, what sits above what. The sign
// itself, its geometry and its markup, is ../parking/sign.ts.
//
// A divIcon rather than a CircleMarker because none of the parts is a circle:
// a plate, a post and a corner badge are three lines of CSS against a custom
// canvas renderer.

function signIcon(n: number, state: SignState): L.DivIcon {
  return L.divIcon({
    className: '',
    html: parkingSignHtml(n, state),
    iconSize: [W, H],
    iconAnchor: [ANCHOR[0], ANCHOR[1]],
  });
}

export function ParkingLayer() {
  const areas = useParkingAreas();
  const hoveredId = useHoveredParkingId();
  if (areas.length === 0) return null;

  // A hovered id that isn't in the current list is ignored rather than
  // honoured. It happens for a frame whenever a re-fetch lands under the
  // pointer — the radius slider moved, or the route start did — and taking it
  // at face value would fade all five signs to highlight a lot that is no
  // longer on the map, which is worse than highlighting nothing.
  const active =
    hoveredId !== null && areas.some((a) => a.id === hoveredId)
      ? hoveredId
      : null;

  return (
    <>
      {areas.map((a, i) => {
        const hovered = a.id === active;
        const state: SignState = hovered
          ? 'hovered'
          : active !== null
            ? 'dimmed'
            : 'plain';
        return (
          <Marker
            key={a.id}
            position={a.point}
            icon={signIcon(i + 1, state)}
            // Not interactive for dragging/clicking the map through it, but the
            // tooltip needs pointer events, so this stays interactive and
            // simply sits above the route line. The lit one is lifted again, so
            // a grown sign is never clipped by the neighbour it grew behind.
            zIndexOffset={hovered ? 1000 : 500}
            eventHandlers={{
              // Pointing at a sign lights it exactly as pointing at its row
              // does — same pair of functions, so the map and the panel cannot
              // disagree about which lot is lit, and the reader can work from
              // either end.
              mouseover: () => takeParkingHighlight(a.id, a.point),
              mouseout: () => releaseParkingHighlight(a.id),
            }}
          >
            {/* Lifted clear of the plate rather than of the anchor: the anchor
                is down at the foot of the post, and a tooltip placed off that
                would open across the sign it names. */}
            <Tooltip direction="top" offset={[0, -(H - OVERHANG)]}>
              {a.name ?? `#${i + 1}`}
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}
