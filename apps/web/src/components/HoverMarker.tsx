import { CircleMarker } from 'react-leaflet';
import { useHoverPoint } from '../hoverStore';

// Renders a single dot on the map at the position currently hovered in the
// elevation profile chart. Subscribes directly to the external hover store
// so the rest of the map (tiles, drawing handler, route polyline) stays
// untouched when the cursor moves over the chart. The dot's fill matches
// the dataset being hovered: teal (default) for the planned route, the
// recorded-track orange when scrubbing the actual route's profile.
export function HoverMarker() {
  const hover = useHoverPoint();
  if (!hover) return null;
  return (
    <CircleMarker
      center={hover.point}
      radius={6}
      pathOptions={{
        color: '#ffffff',
        weight: 2,
        // Default matches --accent / route line teal.
        fillColor: hover.color ?? '#2dd4bf',
        fillOpacity: 1,
      }}
      interactive={false}
    />
  );
}
