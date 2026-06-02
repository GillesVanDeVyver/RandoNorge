import { MapContainer, TileLayer, WMSTileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { CRS_UTM33 } from '../map/crs';
import styles from './Map.module.css';

// Initial view: all of Norway.
const INITIAL_CENTER: [number, number] = [65, 13];
const INITIAL_ZOOM = 5;

export function Map() {
  return (
    <MapContainer
      crs={CRS_UTM33}
      center={INITIAL_CENTER}
      zoom={INITIAL_ZOOM}
      minZoom={3}
      maxZoom={17}
      className={styles.map}
    >
      <TileLayer
        url="https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/utm33n/{z}/{y}/{x}.png"
        attribution='&copy; <a href="https://www.kartverket.no/">Kartverket</a>'
      />
      <WMSTileLayer
        url="https://nve.geodataonline.no/arcgis/services/Bratthet/MapServer/WMSServer"
        layers="Bratthet_snoskred"
        format="image/png"
        transparent={true}
        opacity={0.6}
        attribution='Bratthet &copy; <a href="https://www.nve.no/">NVE</a>'
      />
    </MapContainer>
  );
}
