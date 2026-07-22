import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LatLng, Mode, Overlay, Route, Segment } from '../types';
import { simplify } from '../geometry';
import {
  AreaIcon,
  CompassIcon,
  FullscreenIcon,
  LocateIcon,
  MapIcon,
  MinusIcon,
  MountainIcon,
  PlusIcon,
  RouteIcon,
  SearchIcon,
  SnowflakeIcon,
} from './icons';
import { searchPlace } from '../search/geocode';
import type { RegionMeta } from '../offline/db';
import {
  isRegionsVisible,
  toggleRegionsVisible,
  useRegionsVisible,
} from '../offline/regionOverlayMode';
import { useOfflineRegions } from '../offline/useOfflineRegions';
import { useEffectiveOffline } from '../offline/networkMode';
import {
  offlineTileTemplate,
  registerOfflineMapProtocol,
} from '../offline/maplibreOffline';
import { subscribeNetworkMode } from '../offline/networkMode';
import { clamp, subtractRects, MASK_TINT, type Rect } from '../offline/maskGeometry';
import { Map3DCursorReadout } from './Map3DCursorReadout';
import styles from './Map3DView.module.css';

// Register the offline tile protocol so the raster sources below can read
// downloaded tiles from IndexedDB first (and fall back to the network when
// online), the same way the 2D map's OfflineTileLayer does. Idempotent.
registerOfflineMapProtocol();

// Every tile source below — the Kartverket topo base map, the NVE seNorge snow
// depth and Bratthet_med_utlop_2024 steepness overlays, and the Terrarium
// terrain-DEM mesh — is served through the shared offline tile protocol
// (offlineTileTemplate) rather than a straight source URL, so each renders from
// the IndexedDB cache when its area has been downloaded and keeps working with
// no connectivity, exactly like the 2D map. The real source URLs (including the
// same-origin /terrain-dem Worker route) live in the shared layer descriptors
// (offline/layers.ts) that also drive the downloader, keeping requests and
// cache keys in lockstep. Terrain is optional to download: if its tiles aren't
// cached, the mesh flattens offline and the draped map still works.

// Vertical exaggeration of the terrain mesh. 1.0 is true-to-life; a small
// bump makes ridgelines and couloirs read more clearly without looking fake.
const TERRAIN_EXAGGERATION = 1.4;

// Drawing/erasing constants — mirror the 2D DrawingHandler so freehand edits
// behave identically in 3D.
const RDP_EPSILON_M = 8;
// Eraser "effect radius" in screen pixels — constant on-screen size, so
// the ground-distance reach scales proportionally as the user zooms out.
// Keep in sync with DrawingHandler.tsx.
const ERASER_RADIUS_PX = 32;
const ROUTE_COLOR = '#2dd4bf'; // matches --accent (alpine/glacier teal)
// Amber for the downloaded-region boundaries — the same colour the 2D
// RegionBoundaryLayer uses so offline coverage reads identically in both views.
const REGION_COLOR = '#f5a623';
// Minimum pixel distance between accepted points while drawing — caps point
// count by stroke length rather than duration.
const MIN_DRAW_PX = 3;
const MIN_DRAW_PX2 = MIN_DRAW_PX * MIN_DRAW_PX;

// Pink tilted eraser block matching the toolbar icon, used as the cursor
// while in erase mode (identical to the 2D handler).
const ERASER_CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 44 44'>
  <g transform='rotate(-30 22 22)' fill='#FFFFFF' stroke='#111' stroke-width='1.6' stroke-linejoin='round' stroke-linecap='round'>
    <rect x='5' y='18' width='34' height='10' rx='2.5'/>
    <rect x='5' y='14' width='34' height='8' rx='2.5'/>
    <line x1='19' y1='14' x2='19' y2='22'/>
  </g>
</svg>`;
const ERASER_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(ERASER_CURSOR_SVG)}") 10 36, cell`;

// Build a GeoJSON FeatureCollection of LineStrings from the route, optionally
// appending an in-progress stroke. Route coordinates are [lat, lng]; GeoJSON
// wants [lng, lat].
function routeToGeoJSON(route: Route, extra?: Segment): GeoJSON.FeatureCollection {
  const segs = route.filter((seg) => seg.length >= 2);
  const all = extra && extra.length >= 2 ? [...segs, extra] : segs;
  return {
    type: 'FeatureCollection',
    features: all.map((seg) => ({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: seg.map(([lat, lng]) => [lng, lat]),
      },
    })),
  };
}

// Build a GeoJSON FeatureCollection of rectangle Polygons from the downloaded
// regions so the same amber boundaries the 2D map draws (RegionBoundaryLayer)
// also outline offline coverage in 3D. Bounds are [south, west, north, east];
// GeoJSON polygon rings are [lng, lat] and must close back on the first point.
function regionsToGeoJSON(regions: RegionMeta[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: regions.map((region) => {
      const [south, west, north, east] = region.bounds;
      return {
        type: 'Feature',
        properties: { id: region.id },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
      };
    }),
  };
}

// Poll cadence for picking up newly downloaded / deleted regions — matches
// RegionBoundaryLayer's 2D poll so both views refresh in lockstep.
const REGION_POLL_MS = 3000;

interface Props {
  route: Route;
  snowDate: string;
  overlay: Overlay;
  onOverlayChange: (overlay: Overlay) => void;
  mode: Mode;
  onRouteChange: (route: Route) => void;
}

// Embedded MapLibre GL view that drapes the Kartverket topo map over a
// 3D terrain mesh (/terrain-dem tiles: Kartverket NDH DTM via R2 with AWS
// Terrarium fallback) and draws the route on top. The line
// is clamped to the terrain, so it follows the surface like CalTopo's 3D
// view. Route elevation accuracy is independent of the mesh resolution.
// Drawing and erasing work exactly like the 2D map — the same freehand
// strokes, RDP simplification, and disk eraser, ported to MapLibre's
// project/unproject so edits land on the terrain surface.
export function Map3DView({
  route,
  snowDate,
  overlay,
  onOverlayChange,
  mode,
  onRouteChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Map instance mirrored into state (in addition to the ref) so the cursor
  // readout — which binds its own hover handlers — can re-bind once the map
  // exists and tear down when it is removed.
  const [glMap, setGlMap] = useState<maplibregl.Map | null>(null);
  // Current map bearing, mirrored into state so the compass needle can
  // counter-rotate and keep pointing at true north as the view turns.
  const [bearing, setBearing] = useState(0);
  // Search UI state — mirrors the 2D MapControls search box.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Downloaded-region boundaries: the same list and visibility flag the 2D
  // RegionBoundaryLayer draws, shared through the pub/sub store so a single
  // toggle drives both views.
  const { regions, refresh } = useOfflineRegions();
  const regionsVisible = useRegionsVisible();
  // Drives the offline veil: gray everything outside downloaded coverage when
  // connectivity drops (real dead zone or the dev simulator).
  const offline = useEffectiveOffline();

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  // Keep the region list fresh after a download or deletion, matching the 2D
  // layer's cheap poll rather than wiring an event through the offline stack.
  useEffect(() => {
    const id = window.setInterval(() => void refresh(), REGION_POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Latest-value refs so the once-bound MapLibre event handlers always see
  // the current route/mode/callback without rebinding (and rebuilding) them.
  // Synced in an effect (never during render) so handlers, which only fire
  // after commit, always read fresh values.
  const routeRef = useRef(route);
  const modeRef = useRef(mode);
  const onRouteChangeRef = useRef(onRouteChange);
  // Latest region list for the once-built map to seed its regions source with.
  const regionsRef = useRef(regions);
  useEffect(() => {
    routeRef.current = route;
    modeRef.current = mode;
    onRouteChangeRef.current = onRouteChange;
    regionsRef.current = regions;
  });

  // In-progress draw stroke, eraser accumulator, and live-preview plumbing —
  // direct analogues of the refs in the 2D DrawingHandler.
  const drawingRef = useRef<Segment | null>(null);
  const lastDrawPxRef = useRef<{ x: number; y: number } | null>(null);
  const liveRafRef = useRef<number | null>(null);
  const erasingRef = useRef(false);
  const eraseRouteRef = useRef<Route | null>(null);
  // Set inside the build effect; lets other effects repaint the route source.
  const renderRef = useRef<() => void>(() => {});
  // Skip the fit effect on the initial mount — the load handler frames the
  // route with the nicer tilted view.
  const didMountRef = useRef(false);

  // Build the map exactly once. Route/overlay/snow/mode changes are pushed in
  // through dedicated effects below so the camera never resets mid-edit.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          // Credits (Kartverket, MET, NVE/Varsom, terrain, and the active
          // overlay's source) are rendered by <MapAttribution/> in App.tsx —
          // keep it in sync when sources change here.
          basemap: {
            type: 'raster',
            tiles: [offlineTileTemplate('topo')],
            tileSize: 256,
            maxzoom: 18,
          },
          terrain: {
            type: 'raster-dem',
            tiles: [offlineTileTemplate('terrain')],
            tileSize: 256,
            encoding: 'terrarium',
            maxzoom: 15,
          },
          snow: {
            type: 'raster',
            tiles: [offlineTileTemplate('snowdepth', snowDate)],
            tileSize: 256,
            maxzoom: 9,
          },
          steepness: {
            type: 'raster',
            tiles: [offlineTileTemplate('steepness')],
            tileSize: 256,
            maxzoom: 16,
          },
          route: { type: 'geojson', data: routeToGeoJSON(routeRef.current) },
          regions: {
            type: 'geojson',
            data: regionsToGeoJSON(regionsRef.current),
          },
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
            id: 'regions-fill',
            type: 'fill',
            source: 'regions',
            layout: {
              visibility: isRegionsVisible() ? 'visible' : 'none',
            },
            paint: {
              'fill-color': REGION_COLOR,
              'fill-opacity': 0.1,
            },
          },
          // White casing under the amber outline — the same two-layer trick the
          // 2D map uses so the boundary reads against both the topo drape and
          // terrain shading, where a lone thin dashed line washes out.
          {
            id: 'regions-casing',
            type: 'line',
            source: 'regions',
            layout: {
              visibility: isRegionsVisible() ? 'visible' : 'none',
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': '#ffffff',
              'line-width': 8,
              'line-opacity': 0.7,
            },
          },
          {
            id: 'regions-outline',
            type: 'line',
            source: 'regions',
            layout: {
              visibility: isRegionsVisible() ? 'visible' : 'none',
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': REGION_COLOR,
              'line-width': 4,
              'line-dasharray': [2.5, 1.5],
            },
          },
          {
            id: 'route',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': ROUTE_COLOR,
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
      // Attribution is rendered by the shared <MapAttribution/> component
      // (App.tsx): always-visible pill on desktop, collapsible © chip on
      // small screens — so MapLibre's own control stays off.
      attributionControl: false,
      // Linear rotation model: horizontal drag always maps to the same bearing
      // direction. The default "orbital" model (aroundCenter: true) flips the
      // rotation direction depending on whether the cursor is above or below
      // the map center, which makes a single drag suddenly reverse mid-gesture.
      aroundCenter: false,
    });

    mapRef.current = map;
    setGlMap(map);

    // Map tools live in a custom glass panel (top-right, below the overlay
    // toggle) rendered in JSX so they match the 2D map's controls exactly,
    // rather than MapLibre's default NavigationControl widget.

    // --- Route rendering ---------------------------------------------------
    // Repaint the route source: the committed route (or the eraser's pending
    // result) plus any in-progress stroke as a translucent live segment.
    const renderRoute = () => {
      const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const base = eraseRouteRef.current ?? routeRef.current;
      const live =
        drawingRef.current && drawingRef.current.length >= 2
          ? drawingRef.current
          : undefined;
      src.setData(routeToGeoJSON(base, live));
    };
    renderRef.current = renderRoute;

    const scheduleLiveUpdate = () => {
      if (liveRafRef.current !== null) return;
      liveRafRef.current = requestAnimationFrame(() => {
        liveRafRef.current = null;
        renderRoute();
      });
    };
    const cancelLiveUpdate = () => {
      if (liveRafRef.current !== null) {
        cancelAnimationFrame(liveRafRef.current);
        liveRafRef.current = null;
      }
    };

    // --- Eraser ------------------------------------------------------------
    // Erase every part of the route inside a disk of ERASER_RADIUS_PX around
    // the cursor, working in screen-pixel space for fast planar geometry —
    // the same algorithm as the 2D handler, using MapLibre project/unproject
    // so the disk follows the terrain surface.
    const eraseAt = (cursor: LatLng) => {
      const source = eraseRouteRef.current ?? routeRef.current;
      const cursorPx = map.project([cursor[1], cursor[0]]);
      const R = ERASER_RADIUS_PX;
      const R2 = R * R;

      const toLL = (x: number, y: number): LatLng => {
        const ll = map.unproject([x, y]);
        return [ll.lat, ll.lng];
      };

      const next: Route = [];
      let changed = false;

      for (const seg of source) {
        if (seg.length === 0) continue;
        const pxs = seg.map((p) => map.project([p[1], p[0]]));
        const inside = pxs.map((pt) => {
          const dx = pt.x - cursorPx.x;
          const dy = pt.y - cursorPx.y;
          return dx * dx + dy * dy <= R2;
        });

        let current: Segment = [];
        if (!inside[0]) current.push(seg[0]);
        else changed = true;

        for (let i = 1; i < seg.length; i++) {
          const a = pxs[i - 1];
          const b = pxs[i];
          const aIn = inside[i - 1];
          const bIn = inside[i];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const fx = a.x - cursorPx.x;
          const fy = a.y - cursorPx.y;
          const qa = dx * dx + dy * dy;
          const qb = 2 * (fx * dx + fy * dy);
          const qc = fx * fx + fy * fy - R2;

          if (aIn && bIn) {
            changed = true;
          } else if (aIn && !bIn) {
            if (qa > 0) {
              const disc = qb * qb - 4 * qa * qc;
              if (disc >= 0) {
                const sq = Math.sqrt(disc);
                const t = (-qb + sq) / (2 * qa);
                if (t > 0 && t < 1) current.push(toLL(a.x + t * dx, a.y + t * dy));
              }
            }
            current.push(seg[i]);
            changed = true;
          } else if (!aIn && bIn) {
            if (qa > 0) {
              const disc = qb * qb - 4 * qa * qc;
              if (disc >= 0) {
                const sq = Math.sqrt(disc);
                const t = (-qb - sq) / (2 * qa);
                if (t > 0 && t < 1) current.push(toLL(a.x + t * dx, a.y + t * dy));
              }
            }
            if (current.length >= 2) next.push(current);
            current = [];
            changed = true;
          } else {
            let split = false;
            if (qa > 0) {
              const disc = qb * qb - 4 * qa * qc;
              if (disc > 0) {
                const sq = Math.sqrt(disc);
                const t1 = (-qb - sq) / (2 * qa);
                const t2 = (-qb + sq) / (2 * qa);
                if (t1 > 0 && t2 < 1 && t1 < t2) {
                  current.push(toLL(a.x + t1 * dx, a.y + t1 * dy));
                  if (current.length >= 2) next.push(current);
                  current = [toLL(a.x + t2 * dx, a.y + t2 * dy), seg[i]];
                  changed = true;
                  split = true;
                }
              }
            }
            if (!split) current.push(seg[i]);
          }
        }

        if (current.length >= 2) next.push(current);
        else if (current.length > 0) changed = true;
      }

      if (changed) {
        eraseRouteRef.current = next;
        renderRoute();
      }
    };

    const commitErase = () => {
      erasingRef.current = false;
      const pending = eraseRouteRef.current;
      eraseRouteRef.current = null;
      if (pending) onRouteChangeRef.current(pending);
    };

    const commitDraw = () => {
      if (!drawingRef.current) return;
      cancelLiveUpdate();
      const simplified = simplify(drawingRef.current, RDP_EPSILON_M);
      drawingRef.current = null;
      lastDrawPxRef.current = null;
      if (simplified.length >= 2) {
        onRouteChangeRef.current([...routeRef.current, simplified]);
      } else {
        renderRoute();
      }
    };

    // --- Pointer handlers --------------------------------------------------
    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (e.originalEvent.button !== 0) return;
      const m = modeRef.current;
      if (m === 'draw') {
        drawingRef.current = [[e.lngLat.lat, e.lngLat.lng]];
        lastDrawPxRef.current = { x: e.point.x, y: e.point.y };
        renderRoute();
      } else if (m === 'erase') {
        erasingRef.current = true;
        eraseAt([e.lngLat.lat, e.lngLat.lng]);
      }
    };
    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      const m = modeRef.current;
      if (m === 'draw' && drawingRef.current) {
        const last = lastDrawPxRef.current;
        if (last) {
          const dx = e.point.x - last.x;
          const dy = e.point.y - last.y;
          if (dx * dx + dy * dy < MIN_DRAW_PX2) return;
        }
        lastDrawPxRef.current = { x: e.point.x, y: e.point.y };
        drawingRef.current.push([e.lngLat.lat, e.lngLat.lng]);
        scheduleLiveUpdate();
      } else if (m === 'erase' && erasingRef.current) {
        eraseAt([e.lngLat.lat, e.lngLat.lng]);
      }
    };
    const onMouseUp = () => {
      commitDraw();
      commitErase();
    };
    const onMouseOut = () => {
      commitDraw();
      commitErase();
    };

    // Touch handlers mirroring the mouse ones: MapLibre never synthesises
    // mouse events from touch drags, so without these, drawing on mobile
    // silently does nothing. e.preventDefault() stops the map's own gesture
    // handling (pan/rotate) from competing with the stroke; a second finger
    // commits the stroke and yields to pinch-zoom.
    const onTouchStart = (e: maplibregl.MapTouchEvent) => {
      const m = modeRef.current;
      if (m === 'idle') return;
      if (e.originalEvent.touches.length > 1) {
        commitDraw();
        commitErase();
        return;
      }
      // Two distinct defaults must be cancelled: MapLibre's own gesture
      // handling (e.preventDefault) and the *browser's* native touch
      // gestures — edge-swipe history navigation, pull-to-refresh, page
      // scroll (e.originalEvent.preventDefault). Missing the latter lets
      // a draw stroke starting near the screen edge navigate away from
      // the app entirely.
      e.preventDefault();
      if (e.originalEvent.cancelable) e.originalEvent.preventDefault();
      if (m === 'draw') {
        drawingRef.current = [[e.lngLat.lat, e.lngLat.lng]];
        lastDrawPxRef.current = { x: e.point.x, y: e.point.y };
        renderRoute();
      } else if (m === 'erase') {
        erasingRef.current = true;
        eraseAt([e.lngLat.lat, e.lngLat.lng]);
      }
    };
    const onTouchMove = (e: maplibregl.MapTouchEvent) => {
      const m = modeRef.current;
      if (m === 'idle') return;
      if (e.originalEvent.touches.length > 1) return;
      e.preventDefault();
      if (e.originalEvent.cancelable) e.originalEvent.preventDefault();
      if (m === 'draw' && drawingRef.current) {
        const last = lastDrawPxRef.current;
        if (last) {
          const dx = e.point.x - last.x;
          const dy = e.point.y - last.y;
          if (dx * dx + dy * dy < MIN_DRAW_PX2) return;
        }
        lastDrawPxRef.current = { x: e.point.x, y: e.point.y };
        drawingRef.current.push([e.lngLat.lat, e.lngLat.lng]);
        scheduleLiveUpdate();
      } else if (m === 'erase' && erasingRef.current) {
        eraseAt([e.lngLat.lat, e.lngLat.lng]);
      }
    };
    const onTouchEnd = () => {
      commitDraw();
      commitErase();
    };

    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);
    map.on('mouseout', onMouseOut);
    map.on('touchstart', onTouchStart);
    map.on('touchmove', onTouchMove);
    map.on('touchend', onTouchEnd);
    map.on('touchcancel', onTouchEnd);
    map.on('rotate', () => setBearing(map.getBearing()));

    map.on('load', () => {
      // Frame the camera on the route with a tilted, slightly rotated view.
      const pts: [number, number][] = [];
      for (const seg of routeRef.current)
        for (const [lat, lng] of seg) pts.push([lng, lat]);
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
      setBearing(map.getBearing());
    });

    return () => {
      cancelLiveUpdate();
      mapRef.current = null;
      setGlMap(null);
      map.remove();
    };
    // Built once on mount: route/snow/overlay/mode are synced by the effects
    // below so the camera is never reset by a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push committed route changes into the route source without rebuilding the
  // map. Skipped implicitly while drawing (route prop only changes on commit).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(routeToGeoJSON(route));
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [route]);

  // Push the downloaded-region boundaries into the regions source whenever the
  // polled list changes (new download / deletion), without rebuilding the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('regions') as
        | maplibregl.GeoJSONSource
        | undefined;
      if (src) src.setData(regionsToGeoJSON(regions));
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [regions]);

  // Show/hide the region boundaries when the shared visibility flag flips.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const vis = regionsVisible ? 'visible' : 'none';
      for (const id of ['regions-fill', 'regions-casing', 'regions-outline']) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [regionsVisible]);

  // Offline gray tint: lay a translucent gray veil over everything outside
  // downloaded coverage, the 3D twin of the 2D OfflineMaskLayer (and the ut.no
  // read). We tile the area *outside* the downloaded regions with plain
  // semi-transparent gray divs and leave the regions as untinted gaps.
  //
  // As in 2D, we tile the outside with real rectangles (subtractRects) rather
  // than punching holes into one clipped div — nothing to clip, and it keeps
  // both maps on the same code path. Each region is projected to screen
  // (pitch/bearing turn its footprint into a trapezoid) and we use that quad's
  // axis-aligned bounding box as the untinted gap; the box fully contains the
  // region so downloaded coverage always stays untinted.
  const offlineRef = useRef(offline);
  const maskUpdateRef = useRef<() => void>(() => {});
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const container = map.getCanvasContainer();
    const wrap = document.createElement('div');
    wrap.style.position = 'absolute';
    wrap.style.inset = '0';
    wrap.style.pointerEvents = 'none';
    wrap.style.zIndex = '2'; // above the canvas, below MapLibre's controls
    container.appendChild(wrap);

    const pool: HTMLDivElement[] = [];
    const tile = (i: number): HTMLDivElement => {
      let el = pool[i];
      if (!el) {
        el = document.createElement('div');
        el.style.position = 'absolute';
        el.style.background = MASK_TINT;
        wrap.appendChild(el);
        pool[i] = el;
      }
      return el;
    };

    const update = () => {
      if (!offlineRef.current) {
        wrap.style.display = 'none';
        return;
      }
      wrap.style.display = '';
      const w = container.clientWidth;
      const h = container.clientHeight;

      // Each downloaded region's projected bounding box, clamped to the
      // viewport — these are the untinted gaps.
      const holes: Rect[] = [];
      for (const region of regionsRef.current) {
        // bounds are [south, west, north, east]; project each corner.
        const [south, west, north, east] = region.bounds;
        const corners: [number, number][] = [
          [west, north],
          [east, north],
          [east, south],
          [west, south],
        ];
        const pts = corners.map(([lng, lat]) => map.project([lng, lat]));
        const x1 = clamp(Math.round(Math.min(...pts.map((p) => p.x))), 0, w);
        const y1 = clamp(Math.round(Math.min(...pts.map((p) => p.y))), 0, h);
        const x2 = clamp(Math.round(Math.max(...pts.map((p) => p.x))), 0, w);
        const y2 = clamp(Math.round(Math.max(...pts.map((p) => p.y))), 0, h);
        if (x2 > x1 && y2 > y1) holes.push([x1, y1, x2, y2]);
      }

      // Tile the viewport minus the gaps with gray-tint rectangles.
      const rects = subtractRects(w, h, holes);
      for (let i = 0; i < rects.length; i++) {
        const [rx1, ry1, rx2, ry2] = rects[i];
        const t = tile(i);
        t.style.display = '';
        t.style.left = `${rx1}px`;
        t.style.top = `${ry1}px`;
        t.style.width = `${rx2 - rx1}px`;
        t.style.height = `${ry2 - ry1}px`;
      }
      for (let i = rects.length; i < pool.length; i++) {
        pool[i].style.display = 'none';
      }
    };
    maskUpdateRef.current = update;

    map.on('move', update);
    map.on('resize', update);
    if (map.isStyleLoaded()) update();
    else map.once('load', update);

    return () => {
      map.off('move', update);
      map.off('resize', update);
      wrap.remove();
    };
  }, []);

  // Redraw the tint tiles when offline state flips or the regions change.
  useEffect(() => {
    offlineRef.current = offline;
    maskUpdateRef.current();
  }, [offline, regions]);

  // Re-frame the camera on the route when it changes (after the initial
  // mount), preserving the current pitch/bearing so edits don't reset the
  // tilt. Mirrors the 2D FitToRoute behavior.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    const pts: [number, number][] = [];
    for (const seg of route) for (const [lat, lng] of seg) pts.push([lng, lat]);
    if (pts.length < 2) return;
    const fit = () => {
      const bounds = pts.reduce(
        (b, p) => b.extend(p),
        new maplibregl.LngLatBounds(pts[0], pts[0]),
      );
      map.fitBounds(bounds, {
        padding: 80,
        pitch: map.getPitch(),
        bearing: map.getBearing(),
        duration: 600,
      });
    };
    if (map.isStyleLoaded()) fit();
    else map.once('load', fit);
  }, [route]);

  // Refresh the snow grid tiles when the date changes (no rebuild).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('snow') as
        | maplibregl.RasterTileSource
        | undefined;
      src?.setTiles([offlineTileTemplate('snowdepth', snowDate)]);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [snowDate]);

  // React to the offline/online flag flipping (the dev offline simulator).
  // Unlike the 2D map — whose OfflineTileLayer subscribes to networkMode and
  // redraws — MapLibre caches whatever tiles it last fetched and has no idea
  // the source should be re-evaluated, so after toggling offline it keeps
  // showing the online tiles until a pan/zoom forces new requests. Re-setting
  // each source's tile template forces an immediate reload through the offline
  // protocol, so the 3D view honours the toggle right away and offline testing
  // reflects reality. (Same setTiles mechanism the snow-date effect above uses.)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const refresh = () => {
      if (!map.isStyleLoaded()) return;
      const reset = (id: string, template: string) => {
        const src = map.getSource(id) as
          | maplibregl.RasterTileSource
          | undefined;
        src?.setTiles([template]);
      };
      reset('basemap', offlineTileTemplate('topo'));
      reset('terrain', offlineTileTemplate('terrain'));
      reset('steepness', offlineTileTemplate('steepness'));
      reset('snow', offlineTileTemplate('snowdepth', snowDate));
    };
    return subscribeNetworkMode(refresh);
  }, [snowDate]);

  // Toggle map interactions and cursor based on draw/erase/idle mode, mirroring
  // the 2D handler so panning is locked out while editing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const canvas = map.getCanvas();
    if (mode === 'idle') {
      map.dragPan.enable();
      map.doubleClickZoom.enable();
      canvas.style.cursor = '';
      canvas.style.touchAction = '';
    } else {
      map.dragPan.disable();
      map.doubleClickZoom.disable();
      canvas.style.cursor = mode === 'draw' ? 'crosshair' : ERASER_CURSOR;
      // Stop the browser from claiming one-finger drags for native gestures
      // (scroll, pull-to-refresh, edge-swipe history navigation) so the
      // stroke's touchmove events keep flowing to the handlers above.
      canvas.style.touchAction = 'none';
    }
  }, [mode]);

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

  const hasRoute = route.length > 0;

  // Re-frame the camera around the drawn route with the same 25% padding as
  // the 2D map's "zoom to route" button, preserving the current pitch/bearing
  // so the tilted view is kept.
  const handleZoomToRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts: [number, number][] = [];
    for (const seg of route) for (const [lat, lng] of seg) pts.push([lng, lat]);
    if (pts.length < 2) return;
    const bounds = pts.reduce(
      (b, p) => b.extend(p),
      new maplibregl.LngLatBounds(pts[0], pts[0]),
    );
    const container = map.getContainer();
    const padX = Math.max(0, Math.round(container.clientWidth * 0.25));
    const padY = Math.max(0, Math.round(container.clientHeight * 0.25));
    map.fitBounds(bounds, {
      padding: { top: padY, bottom: padY, left: padX, right: padX },
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    });
  }, [route]);

  // Center the map on the user's location, matching the 2D locate button
  // (maxZoom 14, high accuracy).
  const handleLocate = useCallback(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const map = mapRef.current;
        if (!map) return;
        map.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 14,
        });
      },
      () => {
        // ignore geolocation errors, like the 2D map does
      },
      { enableHighAccuracy: true },
    );
  }, []);

  const handleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen?.();
    }
  }, []);

  // Same Kartverket stedsnavn place search as the 2D map controls.
  const handleSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const q = query.trim();
      if (!q) return;
      try {
        const place = await searchPlace(q);
        if (place) {
          mapRef.current?.flyTo({ center: [place.lon, place.lat], zoom: 12 });
          setSearchOpen(false);
          setQuery('');
        }
      } catch {
        // ignore network errors
      }
    },
    [query],
  );

  // Top button flips to the other thematic layer (and shows steepness when the
  // overlay is hidden). Bottom button hides the overlay while a layer is shown,
  // and becomes a "Show snow depth" shortcut when hidden — so in the hidden
  // state the two buttons offer both layers directly.
  const nextOverlay: Overlay = overlay === 'steepness' ? 'snowdepth' : 'steepness';
  const overlayLabel =
    overlay === 'steepness' ? 'Show snow depth' : 'Show steepness';
  const overlayIcon =
    overlay === 'steepness' ? <SnowflakeIcon /> : <MountainIcon />;
  const visibilityTarget: Overlay = overlay === 'none' ? 'snowdepth' : 'none';
  const visibilityLabel =
    overlay === 'none' ? 'Show snow depth' : 'Hide overlay';
  const visibilityIcon = overlay === 'none' ? <SnowflakeIcon /> : <MapIcon />;

  return (
    <div ref={rootRef} className={styles.root}>
      <div ref={containerRef} className={styles.map} />
      {/* Terrain values under the cursor for the active overlay, sampled the
          same way as the 2D map. Hidden while drawing/erasing so it doesn't
          chase the pen. */}
      <Map3DCursorReadout
        map={glMap}
        overlay={overlay}
        snowDate={snowDate}
        disabled={mode !== 'idle'}
      />
      <div className={styles.controls}>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => setSearchOpen((v) => !v)}
            title="Search"
            aria-label="Search"
          >
            <SearchIcon />
          </button>
          {searchOpen && (
            <form className={styles.searchBox} onSubmit={handleSearch}>
              <input
                ref={inputRef}
                type="text"
                className={styles.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchOpen(false);
                }}
                placeholder="Search place..."
              />
            </form>
          )}
        </div>
        <div className={styles.divider} />
        <button
          type="button"
          className={styles.btn}
          onClick={handleFullscreen}
          title="Fullscreen"
          aria-label="Fullscreen"
        >
          <FullscreenIcon />
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={handleLocate}
          title="My location"
          aria-label="My location"
        >
          <LocateIcon />
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={toggleRegionsVisible}
          title={
            regionsVisible ? 'Hide downloaded areas' : 'Show downloaded areas'
          }
          aria-label={
            regionsVisible ? 'Hide downloaded areas' : 'Show downloaded areas'
          }
          aria-pressed={regionsVisible}
          // The 3D controls' .btn has no .active state (unlike the 2D map's),
          // so tint the icon with the accent colour when boundaries are shown.
          style={regionsVisible ? { color: 'var(--accent)' } : undefined}
        >
          <AreaIcon />
        </button>
        <div className={styles.divider} />
        <button
          type="button"
          className={styles.btn}
          onClick={() => mapRef.current?.zoomIn()}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={() => mapRef.current?.zoomOut()}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <MinusIcon />
        </button>
        {hasRoute && (
          <>
            <div className={styles.divider} />
            <button
              type="button"
              className={styles.btn}
              onClick={handleZoomToRoute}
              title="Zoom to route"
              aria-label="Zoom to route"
            >
              <RouteIcon />
            </button>
          </>
        )}
        <div className={styles.divider} />
        <button
          type="button"
          className={styles.btn}
          onClick={() => mapRef.current?.resetNorth()}
          title="Reset bearing to north"
          aria-label="Reset bearing to north"
        >
          <span
            className={styles.compass}
            style={{ transform: `rotate(${-bearing - 45}deg)` }}
          >
            <CompassIcon />
          </span>
        </button>
      </div>
      <div className={styles.overlayPanel}>
        <button
          type="button"
          className={styles.overlayToggle}
          onClick={() => onOverlayChange(nextOverlay)}
          aria-label={overlayLabel}
        >
          {overlayIcon}
          <span>{overlayLabel}</span>
        </button>
        <button
          type="button"
          className={styles.overlayToggle}
          onClick={() => onOverlayChange(visibilityTarget)}
          aria-label={visibilityLabel}
        >
          {visibilityIcon}
          <span>{visibilityLabel}</span>
        </button>
      </div>
    </div>
  );
}
