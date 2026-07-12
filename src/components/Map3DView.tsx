import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LatLng, Mode, Overlay, Route, Segment } from '../types';
import { haversine, simplify } from '../geometry';
import {
  CompassIcon,
  FullscreenIcon,
  LocateIcon,
  MinusIcon,
  MountainIcon,
  PlusIcon,
  RouteIcon,
  SearchIcon,
  SnowflakeIcon,
} from './icons';
import { searchPlace } from '../search/geocode';
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

// Drawing/erasing constants — mirror the 2D DrawingHandler so freehand edits
// behave identically in 3D.
const RDP_EPSILON_M = 8;
const ERASER_RADIUS_M = 120;
const ROUTE_COLOR = '#ff3d81';
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

interface Props {
  route: Route;
  snowDate: string;
  overlay: Overlay;
  onOverlayChange: (overlay: Overlay) => void;
  mode: Mode;
  onRouteChange: (route: Route) => void;
}

// Embedded MapLibre GL view that drapes the Kartverket topo map over a
// 3D terrain mesh (AWS Terrarium DEM) and draws the route on top. The line
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
  // Current map bearing, mirrored into state so the compass needle can
  // counter-rotate and keep pointing at true north as the view turns.
  const [bearing, setBearing] = useState(0);
  // Search UI state — mirrors the 2D MapControls search box.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  // Latest-value refs so the once-bound MapLibre event handlers always see
  // the current route/mode/callback without rebinding (and rebuilding) them.
  // Synced in an effect (never during render) so handlers, which only fire
  // after commit, always read fresh values.
  const routeRef = useRef(route);
  const modeRef = useRef(mode);
  const onRouteChangeRef = useRef(onRouteChange);
  useEffect(() => {
    routeRef.current = route;
    modeRef.current = mode;
    onRouteChangeRef.current = onRouteChange;
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
          route: { type: 'geojson', data: routeToGeoJSON(routeRef.current) },
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
      attributionControl: { compact: true },
      // Linear rotation model: horizontal drag always maps to the same bearing
      // direction. The default "orbital" model (aroundCenter: true) flips the
      // rotation direction depending on whether the cursor is above or below
      // the map center, which makes a single drag suddenly reverse mid-gesture.
      aroundCenter: false,
    });

    mapRef.current = map;

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
    // Erase every part of the route inside a disk of ERASER_RADIUS_M around
    // the cursor, working in screen-pixel space for fast planar geometry —
    // the same algorithm as the 2D handler, using MapLibre project/unproject
    // so the disk follows the terrain surface.
    const eraseAt = (cursor: LatLng) => {
      const source = eraseRouteRef.current ?? routeRef.current;
      const cursorPx = map.project([cursor[1], cursor[0]]);
      const refLL: LatLng = [cursor[0], cursor[1] + 0.001];
      const refPx = map.project([refLL[1], refLL[0]]);
      const refMeters = haversine(cursor, refLL);
      const refPxDist = Math.hypot(refPx.x - cursorPx.x, refPx.y - cursorPx.y);
      const pxPerMeter = refPxDist / refMeters;
      const R = ERASER_RADIUS_M * pxPerMeter;
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

    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);
    map.on('mouseout', onMouseOut);
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
      src?.setTiles([snowTilesUrl(snowDate)]);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
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
    } else {
      map.dragPan.disable();
      map.doubleClickZoom.disable();
      canvas.style.cursor = mode === 'draw' ? 'crosshair' : ERASER_CURSOR;
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

  return (
    <div ref={rootRef} className={styles.root}>
      <div ref={containerRef} className={styles.map} />
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
      <button
        type="button"
        className={styles.overlayToggle}
        onClick={() =>
          onOverlayChange(overlay === 'steepness' ? 'snowdepth' : 'steepness')
        }
        aria-label={
          overlay === 'steepness' ? 'Show snow depth' : 'Show steepness'
        }
      >
        {overlay === 'steepness' ? <SnowflakeIcon /> : <MountainIcon />}
        <span>
          {overlay === 'steepness' ? 'Show snow depth' : 'Show steepness'}
        </span>
      </button>
    </div>
  );
}
