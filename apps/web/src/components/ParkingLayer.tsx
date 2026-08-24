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
import { parkingSigns } from '../parking/signs';

// Parking signs for the areas listed in the Parking tab, subscribed straight
// from the parking store so the map is untouched when there is no route and
// nothing to show. The signs are permanent: they are how the reader finds the
// lots at all, so they cannot be a thing that only exists while something is
// being hovered.
//
// This file is the wiring, and only the wiring: what sits above what, and what
// a pointer on a sign does. The sign's geometry and markup are
// ../parking/sign.ts; which sign carries which number and which one is lit are
// ../parking/signs.ts, because three other renderers — the 3D view and the
// briefing's two maps — have to reach the same answer, and this file used to be
// where that answer lived.
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

  // Numbering and highlight state from the shared rule — including what to do
  // with a hovered id that is no longer in the list, which happens for a frame
  // whenever a re-fetch lands under the pointer.
  const signs = parkingSigns(areas, hoveredId);
  // The names for the tooltips, which are the one thing a sign does not carry.
  const named = new Map(areas.map((a) => [a.id, a.name]));

  return (
    <>
      {signs.map((sign) => {
        const hovered = sign.state === 'hovered';
        return (
          <Marker
            key={sign.id}
            position={sign.point}
            icon={signIcon(sign.n, sign.state)}
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
              mouseover: () => takeParkingHighlight(sign.id, sign.point),
              mouseout: () => releaseParkingHighlight(sign.id),
            }}
          >
            {/* Lifted clear of the plate rather than of the anchor: the anchor
                is down at the foot of the post, and a tooltip placed off that
                would open across the sign it names. */}
            <Tooltip direction="top" offset={[0, -(H - OVERHANG)]}>
              {named.get(sign.id) ?? `#${sign.n}`}
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}
