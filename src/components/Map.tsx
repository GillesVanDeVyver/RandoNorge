import type L from 'leaflet';
import { MapContainer, TileLayer, WMSTileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Mode, Overlay, Route } from '../types';
import { DrawingHandler } from './DrawingHandler';
import { HoverMarker } from './HoverMarker';
import { MapControls } from './MapControls';
import styles from './Map.module.css';

const INITIAL_CENTER: [number, number] = [65, 13];
const INITIAL_ZOOM = 5;

interface Props {
  mode: Mode;
  route: Route;
  onRouteChange: (route: Route) => void;
  overlay: Overlay;
  onOverlayChange: (overlay: Overlay) => void;
  snowDate: string;
}

export function Map({
  mode,
  route,
  onRouteChange,
  overlay,
  onOverlayChange,
  snowDate,
}: Props) {
  return (
    <MapContainer
      center={INITIAL_CENTER}
      zoom={INITIAL_ZOOM}
      minZoom={3}
      maxZoom={18}
      zoomControl={false}
      className={styles.map}
    >
      <TileLayer
        url="https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png"
        attribution='&copy; <a href="https://www.kartverket.no/">Kartverket</a>'
        className={overlay === 'snowdepth' ? styles.grayscaleBase : undefined}
      />
      {overlay === 'steepness' && (
        <TileLayer
          url="https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/tile/{z}/{y}/{x}"
          opacity={0.6}
          maxNativeZoom={16}
          attribution='Bratthet med utløp &copy; <a href="https://www.nve.no/">NVE</a>'
        />
      )}
      {overlay === 'snowdepth' && (
        <WMSTileLayer
          // Re-mount the layer when the date changes so the TIME query param
          // is refreshed and stale tiles don't linger.
          key={snowDate}
          url="https://kart.nve.no/enterprise/services/seNorgeGrid_png/ImageServer/WMSServer"
          layers="sd"
          format="image/png"
          transparent
          version="1.1.1"
          opacity={0.75}
          // `time` is a non-standard WMS dimension param accepted by the
          // ArcGIS endpoint; cast because Leaflet's WMSParams type only
          // models the standard set.
          params={{ layers: 'sd', time: snowDate } as L.WMSParams}
          attribution='Snødybde &copy; <a href="https://www.nve.no/">NVE</a> / seNorge'
        />
      )}
      <DrawingHandler mode={mode} route={route} onRouteChange={onRouteChange} />
      <HoverMarker />
      <MapControls overlay={overlay} onOverlayChange={onOverlayChange} />
    </MapContainer>
  );
}
