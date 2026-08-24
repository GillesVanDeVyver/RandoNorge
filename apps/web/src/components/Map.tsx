import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { DrawStyle, LatLng, Mode, Overlay, Route } from '@fjellrute/core/types';
import type { RouteProgress } from '../tracking/useRouteProgress';
import {
  FLAT_MAX_ZOOM,
  FLAT_MIN_ZOOM,
  offeredViewCamera,
  reportViewCamera,
  toLeafletZoom,
  toMapLibreZoom,
} from '../viewCamera';
import type { ViewCamera } from '../viewCamera';
import { CursorReadout } from './CursorReadout';
import { DrawingHandler } from './DrawingHandler';
import { HoverMarker } from './HoverMarker';
import { MapControls } from './MapControls';
import { NavigationLayer } from './NavigationLayer';
import { ParkingLayer } from './ParkingLayer';
import { OfflineManager } from './OfflineManager';
import { OfflineTileLayerComponent } from '../offline/OfflineTileLayerComponent';
import { OfflineMaskLayer } from '../offline/OfflineMaskLayer';
import { RegionBoundaryLayer } from '../offline/RegionBoundaryLayer';
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

// Puts the map exactly where the terrain view came to rest, at the moment the
// switch hands over.
//
// This map is built at the *press*, not at the hand-over, so that it spends the
// tilt loading its tiles instead of making the user wait for them afterwards.
// The price of starting early is that it opens on where the tilt was expected
// to land rather than where it did, and a pan during the tilt breaks that
// prediction. So the terrain view confirms its final standpoint here.
//
// Without animation, and before this map is uncovered: it is a correction, not
// a movement, and in the ordinary case there is nothing to correct at all.
function SyncTo({ camera }: { camera: ViewCamera | null }) {
  const map = useMap();
  useEffect(() => {
    if (!camera) return;
    const zoom = toLeafletZoom(camera.zoom);
    const here = map.getCenter();
    const there = L.latLng(camera.center[1], camera.center[0]);
    // A metre of float drift is not a correction worth a redraw.
    if (map.getZoom() === zoom && here.distanceTo(there) < 1) return;
    map.setView(there, zoom, { animate: false });
  }, [camera, map]);
  return null;
}

// Reports where the map is standing so the terrain view can open there when
// the 2D/3D switch is flipped, instead of starting again from its own default
// framing. Reported once the map is up and then whenever it comes to rest, so
// the answer is always the view the user is actually looking at.
function ReportCamera() {
  const map = useMap();
  useEffect(() => {
    const report = () => {
      const c = map.getCenter();
      reportViewCamera({
        center: [c.lng, c.lat],
        zoom: toMapLibreZoom(map.getZoom()),
      });
    };
    report();
    map.on('moveend', report);
    return () => {
      map.off('moveend', report);
    };
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
function FitToRoute({
  route,
  hold,
  skipInitial,
}: {
  route: Route;
  hold: boolean;
  skipInitial: boolean;
}) {
  const map = useMap();
  // Skip the very first render when the route is already empty — we don't
  // want to clobber the initial Norway-wide view.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      // `skipInitial` means this map opened on a camera handed over by the
      // terrain view. Fitting the route now would undo exactly the thing the
      // hand-over exists for: the user tilted back down to look at where they
      // were, not to be taken back to the whole route.
      if (route.length === 0 || skipInitial) return;
    }
    // `hold` is set while the user is mid-edit in a mode that publishes the
    // route continuously (placing straight-line vertices). Re-framing between
    // clicks would move the map out from under the cursor; the next change
    // once they're done re-frames as usual.
    if (hold) return;
    const pts: L.LatLngTuple[] = [];
    for (const seg of route) for (const p of seg) pts.push([p[0], p[1]]);
    if (pts.length < 2) return;
    const bounds = L.latLngBounds(pts);
    map.invalidateSize();
    const size = map.getSize();
    const padX = Math.max(0, Math.round(size.x * 0.25));
    const padY = Math.max(0, Math.round(size.y * 0.25));
    map.fitBounds(bounds, { padding: [padX, padY], animate: true });
    // `skipInitial` is frozen for the life of the map, so listing it changes
    // nothing at runtime — it is here to keep the dependency list honest.
  }, [route, hold, map, skipInitial]);
  return null;
}

const INITIAL_CENTER: [number, number] = [65, 13];
const INITIAL_ZOOM = 5;

interface Props {
  mode: Mode;
  /** Freehand stroke or straight legs between clicked vertices. */
  drawStyle?: DrawStyle;
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
  /** Suspend the automatic re-frame on route changes, for edits that publish
   *  the route continuously (placing straight-line vertices). */
  holdView?: boolean;
  /** Open the downloaded offline maps page. Handed to the offline panel,
   *  which links there instead of listing the saved areas itself. Absent in
   *  guest mode, which has no such page — the link then isn't rendered. */
  onOpenOfflineMaps?: () => void;
  /** The base layer has all its visible tiles. Used by the 2D/3D switch to
   *  know when the terrain view it is holding on top can safely cross to this
   *  one; fires again after each pan, which the switch ignores. */
  onPainted?: () => void;
  /** Where the terrain view came to rest, handed down at the moment of the
   *  swap. This map is built at the *start* of the tilt so it can load while
   *  the camera is still moving, which means it opens on where the tilt was
   *  predicted to land; this is the confirmation. Normally identical and so a
   *  no-op — it only moves the map when the user panned mid-tilt and took the
   *  camera somewhere else. */
  syncTo?: ViewCamera | null;
}

export function Map({
  mode,
  drawStyle = 'freehand',
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
  holdView = false,
  onOpenOfflineMaps,
  onPainted,
  syncTo = null,
}: Props) {
  // Offline-maps panel: lets the user select a rectangle and download its
  // tiles into IndexedDB so the map keeps working with no connectivity.
  const [offlineOpen, setOfflineOpen] = useState(false);

  // Memoised so react-leaflet doesn't unbind and rebind the listener on every
  // render of this component, which happens once per committed stroke.
  const baseLayerEvents = useMemo(
    () => (onPainted ? { load: onPainted } : undefined),
    [onPainted],
  );

  // The standpoint the terrain view offered when the switch was flipped back
  // to 2D, if this map is being built by that switch: it opens there, looking
  // straight down at the same ground, instead of on the whole of Norway or a
  // fit to the route. Frozen at mount — Leaflet reads center/zoom once anyway,
  // but freezing it also keeps FitToRoute's decision stable for the life of
  // the map. Null when the planner is simply opening, which keeps the defaults.
  const [opening] = useState(offeredViewCamera);

  return (
    <MapContainer
      center={
        opening ? [opening.center[1], opening.center[0]] : INITIAL_CENTER
      }
      zoom={opening ? toLeafletZoom(opening.zoom) : INITIAL_ZOOM}
      // The range lives in viewCamera.ts because the terrain view has to know
      // it too: it aims the end of its tilt at a zoom this map can hold, since
      // anything else would be clamped at the moment of the hand-back.
      minZoom={FLAT_MIN_ZOOM}
      maxZoom={FLAT_MAX_ZOOM}
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
        // The base layer is what "this map has something to show" means, so
        // its load is the signal the 2D/3D switch waits on before crossing.
        eventHandlers={baseLayerEvents}
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
      {/* Offline only: lay a translucent gray tint over the map everywhere
          outside downloaded coverage so it's obvious which part is trustworthy
          without a connection. Sits below the boundaries/route (which stay
          untinted) and never intercepts the pointer. */}
      <OfflineMaskLayer />
      {/* Outlines of downloaded regions so it's clear where full-detail
          offline coverage ends. Drawn under the route/nav layers and kept
          non-interactive so it never blocks drawing. */}
      <RegionBoundaryLayer />
      <DrawingHandler
        mode={mode}
        drawStyle={drawStyle}
        route={route}
        onRouteChange={onRouteChange}
      />
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
      {/* Numbered pins for whatever the Parking tab is listing. Reads the
          parking store directly, so it renders nothing at all until that tab
          has found something — no prop, no re-render of this map. */}
      <ParkingLayer />
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
          onOpenOfflineMaps={onOpenOfflineMaps}
        />
      )}
      <InvalidateOnResize />
      <SyncTo camera={syncTo} />
      <ReportCamera />
      <FitToRoute
        route={fitTo ?? route}
        hold={holdView}
        skipInitial={!!opening}
      />
    </MapContainer>
  );
}
