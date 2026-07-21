import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng, Mode, Overlay, Route } from '../types';
import type { RouteProgress } from '../tracking/useRouteProgress';
import { CursorReadout } from './CursorReadout';
import { DrawingHandler } from './DrawingHandler';
import { HoverMarker } from './HoverMarker';
import { MapControls } from './MapControls';
import { NavigationLayer } from './NavigationLayer';
import { OfflineManager } from './OfflineManager';
import { OfflineTileLayerComponent } from '../offline/OfflineTileLayerComponent';
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
  /** Monotonic progress along the plan; null when off-route or idle. */
  progress?: RouteProgress | null;
  /** Geometry the initial fit frames instead of the plan (e.g. reviewing a
   *  completed tour fits the plan and the recorded track together). */
  fitTo?: Route;
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
  progress = null,
  fitTo,
}: Props) {
  // Offline-maps panel: lets the user select a rectangle and download its
  // tiles into IndexedDB so the map keeps working with no connectivity.
  const [offlineOpen, setOfflineOpen] = useState(false);

  return (
    <MapContainer
      center={INITIAL_CENTER}
      zoom={INITIAL_ZOOM}
      minZoom={3}
      maxZoom={18}
      zoomControl={false}
      // Credits are rendered by <MapAttribution/> (App.tsx) instead of
      // Leaflet's control: the built-in line wraps into a tall block on
      // phone widths and collides with the bottom map chrome.
      attributionControl={false}
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
      <OfflineTileLayerComponent
        layerId="topo"
        maxNativeZoom={18}
        // Credits (Kartverket, MET, NVE/Varsom, and the active overlay's
        // source) live in <MapAttribution/> — keep it in sync when layers
        // change.
        className={overlay === 'snowdepth' ? styles.grayscaleBase : undefined}
      />
      {overlay === 'steepness' && (
        <OfflineTileLayerComponent
          layerId="steepness"
          opacity={0.6}
          // NVE's steepness cache only reaches z16 (tiles above 404); the
          // client upsamples for deeper zooms.
          maxNativeZoom={16}
        />
      )}
      {overlay === 'snowdepth' && (
        <OfflineTileLayerComponent
          layerId="snowdepth"
          // Snow depth is date-specific; the offline layer rebuilds each tile's
          // TIME query and cache key from this date and redraws on change.
          snowDate={snowDate}
          opacity={0.75}
          // seNorge is a 1 km grid — beyond zoom 9 the raster is oversampled,
          // so we cap native requests there and let the client upsample.
          maxNativeZoom={9}
          // Don't fire the un-cached WMS requests mid-pan, and hold a wider
          // off-screen buffer so panning back is instant.
          updateWhenIdle
          keepBuffer={4}
        />
      )}
      <DrawingHandler mode={mode} route={route} onRouteChange={onRouteChange} />
      {(track.length > 0 || navigating) && (
        <NavigationLayer
          active={navigating}
          track={track}
          position={position}
          accuracy={positionAccuracy}
          plannedRoute={route}
          progress={progress}
        />
      )}
      <HoverMarker />
      {/* Terrain values under the cursor for the active overlay. Map.tsx is
          shared by the planning and review screens, so both get it. Hidden
          while drawing/erasing so it doesn't chase the pen. */}
      <CursorReadout
        overlay={overlay}
        snowDate={snowDate}
        disabled={mode !== 'idle'}
      />
      <MapControls
        overlay={overlay}
        onOverlayChange={onOverlayChange}
        route={route}
        offlineOpen={offlineOpen}
        onToggleOffline={() => setOfflineOpen((v) => !v)}
      />
      {offlineOpen && (
        <OfflineManager
          onClose={() => setOfflineOpen(false)}
          snowDate={snowDate}
        />
      )}
      <InvalidateOnResize />
      <FitToRoute route={fitTo ?? route} />
    </MapContainer>
  );
}
