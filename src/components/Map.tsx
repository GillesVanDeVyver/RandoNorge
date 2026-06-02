import { MapContainer, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Mode, Route } from '../types';
import { DrawingHandler } from './DrawingHandler';
import { HoverMarker } from './HoverMarker';
import styles from './Map.module.css';

const INITIAL_CENTER: [number, number] = [65, 13];
const INITIAL_ZOOM = 5;

interface Props {
  mode: Mode;
  route: Route;
  onRouteChange: (route: Route) => void;
}

export function Map({ mode, route, onRouteChange }: Props) {
  return (
    <MapContainer
      center={INITIAL_CENTER}
      zoom={INITIAL_ZOOM}
      minZoom={3}
      maxZoom={18}
      className={styles.map}
    >
      <TileLayer
        url="https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png"
        attribution='&copy; <a href="https://www.kartverket.no/">Kartverket</a>'
      />
      <TileLayer
        url="https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/tile/{z}/{y}/{x}"
        opacity={0.6}
        maxNativeZoom={16}
        attribution='Bratthet med utløp &copy; <a href="https://www.nve.no/">NVE</a>'
      />
      <DrawingHandler mode={mode} route={route} onRouteChange={onRouteChange} />
      <HoverMarker />
    </MapContainer>
  );
}
