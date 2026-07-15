import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, WMSTileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng, Mode, Overlay, Route } from '../types';
import { DrawingHandler } from './DrawingHandler';
import { HoverMarker } from './HoverMarker';
import { MapControls } from './MapControls';
import { NavigationLayer } from './NavigationLayer';
import styles from './Map.module.css';

// Leaflet caches the container size and only re-measures on its own resize
// events. When the surrounding flex layout reshapes (e.g. entering summary
// mode shrinks the map pane from 100% to 38.2%), Leaflet keeps drawing
// tiles for the old size — leaving a grey gutter — until we explicitly
// invalidate. Watching the container with a ResizeObserver covers every
// layout change without needing an explicit "the layout just changed" prop.
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

// Re-frames the map around the route every time it changes (typically once
// per committed stroke, since DrawingHandler only emits onRouteChange on
// mouseup). Padding is 25% of the current map pane on each side, so the
// route lands inside the central half — visually centred with breathing
// room for the surrounding terrain. invalidateSize() is called first so
// the fit uses the post-layout dimensions when the pane has just shrunk
// to make room for the summary panel.
function FitToRoute({ route }: { route: Route }) {
  const map = useMap();
  // Skip the very first render when the route is already empty — we don't
  // want to clobber the initial Norway-wide view.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      if (route.length === 0) return;
    }
    const pts: L.LatLngTuple[] = [];
    for (const seg of route) for (const p of seg) pts.push([p[0], p[1]]);
    if (pts.length < 2) return;
    const bounds = L.latLngBounds(pts);
    map.invalidateSize();
    const size = map.getSize();
    const padX = Math.max(0, Math.round(size.x * 0.25));
    const padY = Math.max(0, Math.round(size.y * 0.25));
    map.fitBounds(bounds, { padding: [padX, padY], animate: true });
  }, [route, map]);
  return null;
}

const INITIAL_CENTER: [number, number] = [65, 13];
const INITIAL_ZOOM = 5;

interface Props {
  mode: Mode;
  route: Route;
  onRouteChange: (route: Route) => void;
  overlay: Overlay;
  onOverlayChange: (overlay: Overlay) => void;
  snowDate: string;
  /** Navigation mode: the travelled track drawn on top of the plan. */
  track?: Route;
  /** Live GPS position while navigating (drives the marker + follow). */
  position?: LatLng | null;
  /** Accuracy of the latest fix in meters. */
  positionAccuracy?: number | null;
  /** True while a recording session is live (recording or paused). */
  navigating?: boolean;
}

export function Map({
  mode,
  route,
  onRouteChange,
  overlay,
  onOverlayChange,
  snowDate,
  track = [],
  position = null,
  positionAccuracy = null,
  navigating = false,
}: Props) {
  return (
    <MapContainer
      center={INITIAL_CENTER}
      zoom={INITIAL_ZOOM}
      minZoom={3}
      maxZoom={18}
      zoomControl={false}
      // Render vector overlays (the route polylines) through L.Canvas
      // instead of the default SVG renderer. SVG rebuilds the entire
      // <path> element on every positions update, which becomes the
      // bottleneck on long strokes (Polyline re-renders once per rAF
      // while drawing, growing linearly with stroke length and freezing
      // the page on multi-thousand-point routes). Canvas updates are
      // O(N) blit-only with no DOM reflow and scale orders of magnitude
      // better.
      preferCanvas
      className={styles.map}
    >
      <TileLayer
        url="https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png"
        // The basemap is always mounted, so this line doubles as the app-wide
        // data attribution: weather (MET, CC BY 4.0) and avalanche forecasts
        // (NVE/Varsom, NLOD) are rendered in panels rather than map layers,
        // yet their licenses still require visible credit.
        attribution='&copy; <a href="https://www.kartverket.no/">Kartverket</a> (CC BY 4.0) | Vær: <a href="https://www.met.no/">MET Norway</a> (CC BY 4.0) | Snøskredvarsel: <a href="https://varsom.no/">NVE / Varsom</a> (NLOD)'
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
          // The seNorge ImageServer has no tile cache and renders each WMS
          // request on the fly, so we tune Leaflet to make as few requests
          // as possible:
          //  - tileSize 512 + zoomOffset -1 → 4× fewer tiles per viewport
          //    while keeping the same effective resolution.
          //  - maxNativeZoom 9: seNorge is a 1 km grid; beyond zoom 9 the
          //    raster is already oversampled, so we let Leaflet upscale
          //    on the client instead of asking the server for more detail.
          //  - updateWhenIdle: don't fire requests during panning.
          //  - keepBuffer: hold on to a wider buffer of off-screen tiles
          //    so they're already there when the user pans back.
          tileSize={512}
          zoomOffset={-1}
          maxNativeZoom={9}
          updateWhenIdle
          keepBuffer={4}
          crossOrigin
          // `time` is a non-standard WMS dimension param accepted by the
          // ArcGIS endpoint; cast because Leaflet's WMSParams type only
          // models the standard set.
          params={{ layers: 'sd', time: snowDate } as L.WMSParams}
          attribution='Snødybde &copy; <a href="https://www.nve.no/">NVE</a> / <a href="https://www.met.no/">MET</a> (seNorge, NLOD)'
        />
      )}
      <DrawingHandler mode={mode} route={route} onRouteChange={onRouteChange} />
      {(track.length > 0 || navigating) && (
        <NavigationLayer
          active={navigating}
          track={track}
          position={position}
          accuracy={positionAccuracy}
        />
      )}
      <HoverMarker />
      <MapControls
        overlay={overlay}
        onOverlayChange={onOverlayChange}
        route={route}
      />
      <InvalidateOnResize />
      <FitToRoute route={route} />
    </MapContainer>
  );
}
