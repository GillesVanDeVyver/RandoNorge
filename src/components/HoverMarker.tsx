import { CircleMarker } from 'react-leaflet';
import { useHoverPoint } from '../hoverStore';

// Renders a single dot on the map at the position currently hovered in the
// elevation profile chart. Subscribes directly to the external hover store
// so the rest of the map (tiles, drawing handler, route polyline) stays
// untouched when the cursor moves over the chart.
export function HoverMarker() {
  const point = useHoverPoint();
  if (!point) return null;
  return (
    <CircleMarker
      center={point}
      radius={6}
      pathOptions={{
        color: '#ffffff',
        weight: 2,
        fillColor: '#FF3D81',
        fillOpacity: 1,
      }}
      interactive={false}
    />
  );
}
