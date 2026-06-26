import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Overlay, Route } from '../types';
import { CloseIcon, MountainIcon, SnowflakeIcon } from './icons';
import styles from './Map3DView.module.css';

// Same Kartverket topo tiles as the 2D map — draped over the terrain mesh.
const KARTVERKET_TILES =
  'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png';
// AWS Open Data terrain tiles (Terrarium encoding). Above 60°N these are
// sourced from ArcticDEM 5 m mosaics, so they resolve Norwegian alpine
// terrain well. Tiles top out at z15; MapLibre overzooms beyond that.
const TERRARIUM_TILES =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

// NVE seNorge snow-depth grid (the same `sd` layer the 2D map drapes for the
// "snow depth" overlay), requested as a WebMercator WMS image so MapLibre can
// drape it over the terrain mesh. The grid is colored by depth, so the result
// is snow rendered directly from snow depth data: bare ground where the grid
// is empty, deepening blue where the snowpack is thickest. `{bbox-epsg-3857}`
// is substituted by MapLibre per tile; `time` selects the date.
const snowTilesUrl = (date: string) =>
  'https://kart.nve.no/enterprise/services/seNorgeGrid_png/ImageServer/WMSServer' +
  '?service=WMS&request=GetMap&version=1.1.1&layers=sd&styles=' +
  '&format=image/png&transparent=true&width=256&height=256' +
  `&srs=EPSG:3857&bbox={bbox-epsg-3857}&time=${date}`;

// NVE Bratthet_med_utlop_2024 — the same avalanche-terrain steepness layer the
// 2D map uses: slope angle banded by color with modeled runout zones. Served
// as WebMercator WMTS tiles, draped over the terrain mesh.
const STEEPNESS_TILES =
  'https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/tile/{z}/{y}/{x}';

// Vertical exaggeration of the terrain mesh. 1.0 is true-to-life; a small
// bump makes ridgelines and couloirs read more clearly without looking fake.
const TERRAIN_EXAGGERATION = 1.4;

// Build a GeoJSON FeatureCollection of LineStrings from the route. Route
// coordinates are [lat, lng]; GeoJSON wants [lng, lat].
function routeToGeoJSON(route: Route): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: route
      .filter((seg) => seg.length >= 2)
      .map((seg) => ({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: seg.map(([lat, lng]) => [lng, lat]),
        },
      })),
  };
}

interface Props {
  route: Route;
  snowDate: string;
  overlay: Overlay;
  onOverlayChange: (overlay: Overlay) => void;
  onClose: () => void;
}

// Full-screen MapLibre GL view that drapes the Kartverket topo map over a
// 3D terrain mesh (AWS Terrarium DEM) and draws the route on top. The line
// is clamped to the terrain, so it follows the surface like CalTopo's 3D
// view. Route elevation accuracy is independent of the mesh resolution.
export function Map3DView({
  route,
  snowDate,
  overlay,
  onOverlayChange,
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: [KARTVERKET_TILES],
            tileSize: 256,
            maxzoom: 18,
            attribution:
              '&copy; <a href="https://www.kartverket.no/">Kartverket</a>',
          },
          terrain: {
            type: 'raster-dem',
            tiles: [TERRARIUM_TILES],
            tileSize: 256,
            encoding: 'terrarium',
            maxzoom: 15,
            attribution:
              'Terrain &copy; <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen / AWS Open Data</a>',
          },
          snow: {
            type: 'raster',
            tiles: [snowTilesUrl(snowDate)],
            tileSize: 256,
            maxzoom: 9,
            attribution:
              'Snødybde &copy; <a href="https://www.nve.no/">NVE</a> / seNorge',
          },
          steepness: {
            type: 'raster',
            tiles: [STEEPNESS_TILES],
            tileSize: 256,
            maxzoom: 16,
            attribution:
              'Bratthet med utløp &copy; <a href="https://www.nve.no/">NVE</a>',
          },
          route: { type: 'geojson', data: routeToGeoJSON(route) },
        },
        layers: [
          { id: 'basemap', type: 'raster', source: 'basemap' },
          {
            id: 'steepness',
            type: 'raster',
            source: 'steepness',
            layout: { visibility: overlay === 'steepness' ? 'visible' : 'none' },
            paint: { 'raster-opacity': 0.6 },
          },
          {
            id: 'snow',
            type: 'raster',
            source: 'snow',
            layout: { visibility: overlay === 'snowdepth' ? 'visible' : 'none' },
            paint: { 'raster-opacity': 0.8 },
          },
          {
            id: 'route',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#ff3d81',
              'line-width': 4,
            },
          },
        ],
        terrain: { source: 'terrain', exaggeration: TERRAIN_EXAGGERATION },
        sky: {
          'sky-color': '#9ec8f0',
          'sky-horizon-blend': 0.6,
          'horizon-color': '#e6eef5',
          'horizon-fog-blend': 0.5,
          'fog-color': '#ffffff',
          'fog-ground-blend': 0.4,
        },
      },
      center: [13, 65],
      zoom: 5,
      pitch: 62,
      maxPitch: 85,
      attributionControl: { compact: true },
    });

    mapRef.current = map;

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      'top-left',
    );

    map.on('load', () => {
      // Frame the camera on the route with a tilted, slightly rotated view.
      const pts: [number, number][] = [];
      for (const seg of route) for (const [lat, lng] of seg) pts.push([lng, lat]);
      if (pts.length >= 2) {
        const bounds = pts.reduce(
          (b, p) => b.extend(p),
          new maplibregl.LngLatBounds(pts[0], pts[0]),
        );
        map.fitBounds(bounds, {
          padding: 80,
          pitch: 62,
          bearing: -20,
          duration: 0,
        });
      }
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
    // overlay is intentionally omitted: switching it must not rebuild the map
    // (which would reset the camera). A separate effect syncs layer visibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, snowDate]);

  // Switch the draped overlay (snow ⇄ steepness) without rebuilding the map.
  // Guarded against the brief window before the style (and its layers) load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (map.getLayer('snow')) {
        map.setLayoutProperty(
          'snow',
          'visibility',
          overlay === 'snowdepth' ? 'visible' : 'none',
        );
      }
      if (map.getLayer('steepness')) {
        map.setLayoutProperty(
          'steepness',
          'visibility',
          overlay === 'steepness' ? 'visible' : 'none',
        );
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [overlay]);

  // Esc closes the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="3D route view"
    >
      <div ref={containerRef} className={styles.map} />
      <button
        type="button"
        className={`${styles.close} ${styles.overlayToggle}`}
        onClick={() =>
          onOverlayChange(overlay === 'steepness' ? 'snowdepth' : 'steepness')
        }
        aria-label={
          overlay === 'steepness' ? 'Show snow depth' : 'Show steepness'
        }
      >
        {overlay === 'steepness' ? <SnowflakeIcon /> : <MountainIcon />}
        <span>{overlay === 'steepness' ? 'Show snow' : 'Show steepness'}</span>
      </button>
      <button
        type="button"
        className={styles.close}
        onClick={onClose}
        aria-label="Close 3D view"
      >
        <CloseIcon />
        <span>Close 3D</span>
      </button>
    </div>
  );
}
