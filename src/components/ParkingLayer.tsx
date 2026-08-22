import { Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { useParkingAreas } from '../parking/store';
import { PARKING_PIN_COLOR, PARKING_PIN_RING } from '../parking/pin';

// Numbered pins for the parking areas listed in the Parking tab, subscribed
// straight from the parking store so the map is untouched when there is no
// route and nothing to show.
//
// A divIcon rather than a CircleMarker because these pins carry their list
// number, and the number is the entire mechanism tying a pin to its row. The
// endpoint markers next to them are CircleMarkers, which is why the ring and
// shadow here are drawn to match: same white ring, same weight, so a parking
// pin reads as a sibling of the start dot rather than a different vocabulary.
const ICON_SIZE = 22;

function pinIcon(n: number): L.DivIcon {
  return L.divIcon({
    className: '',
    html:
      `<div style="` +
      `width:${ICON_SIZE}px;height:${ICON_SIZE}px;` +
      `display:flex;align-items:center;justify-content:center;` +
      `border-radius:50%;` +
      `background:${PARKING_PIN_COLOR};` +
      `border:2px solid ${PARKING_PIN_RING};` +
      `box-shadow:0 1px 3px rgba(0,0,0,.4);` +
      `color:#fff;font:700 11px/1 system-ui,sans-serif;` +
      `font-variant-numeric:tabular-nums;` +
      `">${n}</div>`,
    iconSize: [ICON_SIZE, ICON_SIZE],
    iconAnchor: [ICON_SIZE / 2, ICON_SIZE / 2],
  });
}

export function ParkingLayer() {
  const areas = useParkingAreas();
  if (areas.length === 0) return null;
  return (
    <>
      {areas.map((a, i) => (
        <Marker
          key={a.id}
          position={a.point}
          icon={pinIcon(i + 1)}
          // Not interactive for dragging/clicking the map through it, but the
          // tooltip needs pointer events, so this stays interactive and simply
          // sits above the route line.
          zIndexOffset={500}
        >
          <Tooltip direction="top" offset={[0, -ICON_SIZE / 2]}>
            {a.name ?? `#${i + 1}`}
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}
