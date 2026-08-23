// The 3D half of the printed map: the planner's terrain view, live in the
// sheet's map frame, and a still copy of it kept in step for the printer.
//
// The flat map next door (staticMap.ts) stitches tiles by hand, because a
// north-up drawing of a route is a few dozen lines of canvas work. A draped,
// shaded, exaggerated mesh is not — the only thing that renders it is MapLibre,
// with WebGL, on screen. So this builds exactly the map Map3DView builds, in
// the frame the flat map would have filled, and lets the guide turn it until
// the tour reads: a face seen end-on says nothing about how steep it is.
//
// WHY THERE ARE TWO PICTURES AND NOT ONE
//
// A WebGL canvas is not reliably reproduced by a browser's print renderer: the
// drawing buffer belongs to the compositor and is routinely cleared after each
// frame, so what prints is often black or blank. `preserveDrawingBuffer` keeps
// the last frame long enough to copy it, and copy it we do — into the same
// plain 2D <canvas> the flat map draws into, which is what actually goes on
// paper. The live map is a screen-only luxury; the canvas underneath it is the
// export. Every time the camera comes to rest the copy is retaken, and it is
// retaken once more when the print dialog opens, so "what you see is what
// prints" holds however the page is reached.
//
// It also gives the sheet the one guarantee it needs before enabling Print: by
// then a finished frame exists on the canvas, rather than a map that has merely
// started arriving.
//
// Note the difference from staticMap.ts, whose canvas is deliberately tainted:
// MapLibre fetches its tiles with CORS (it has to, to upload them as WebGL
// textures), so drawing its canvas into ours does not taint ours either. That
// is a property of MapLibre's loader, not a choice made here — if a tile source
// ever stops sending the header, the tile fails to load rather than quietly
// poisoning the export, and the copy below still produces a page.
//
// WHY THE MAP IS BIGGER THAN THE FRAME IT APPEARS IN
//
// Tiles are chosen for the size of the map's container, so a map built at the
// ~360 screen pixels the frame occupies would be photographed at ~360 pixels
// and printed at 128 mm: about 70 dpi, and a legible screen map becomes a mushy
// paper one. The map is therefore built at the print size (width × height ×
// scale) and shown scaled down by the caller — see TerrainPicture.tsx. What
// prints is the resolution it was rendered at, not the resolution it was
// watched at.

import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { LatLng, Overlay, Route } from '../types';
import {
  PARKING_SIGN_LAYER,
  PARKING_SIGN_LAYOUT,
  PARKING_SIGN_PAINT,
  parkingSignsGeoJSON,
  serveParkingSignIcons,
} from '../parking/signImage';
import { plainParkingSigns } from '../parking/signs';
import {
  TERRAIN_BEARING,
  TERRAIN_ENDPOINT_PAINT,
  TERRAIN_EXAGGERATION,
  TERRAIN_FIT_PADDING,
  TERRAIN_PITCH,
  TERRAIN_ROUTE_PAINT,
  TERRAIN_SKY,
  TERRAIN_SNOW_OPACITY,
  TERRAIN_STEEPNESS_OPACITY,
  TERRAIN_CONNECTOR_PAINT,
  routeConnectorsGeoJSON,
  routeEndpointsGeoJSON,
} from '../terrainView';
import { recallTerrainCamera } from '../terrainCamera';
import { PAN_REACH } from './mapFraming';
import {
  latToTileY,
  lngToTileX,
  tileXToLng,
  tileYToLat,
} from '../offline/tileMath';

/** How long the first copy waits for tiles, the DEM and the first paint before
 *  taking whatever has arrived. Long enough for a cold cache on a slow
 *  connection; short enough that a source which is simply down cannot hold the
 *  Print button hostage. A partly-loaded terrain still prints the route over
 *  the right valley, which is the same bargain the flat renderer strikes when
 *  a tile 404s. */
const CAPTURE_TIMEOUT_MS = 20000;

/** A drag across the full width of the frame turns the map a half-circle, and
 *  one up its full height tilts it from flat-on to overhead. Stated per frame
 *  rather than per pixel so the map turns by the same amount under the same
 *  gesture whatever size the frame is drawn at — which matters here, where the
 *  map is rendered several times larger than it is shown. */
const TURN_PER_FRAME = 180;
const TILT_PER_FRAME = 90;

/** MapLibre's own ceiling for this style, matching the planner's. Below it the
 *  camera is looking at sky. */
const MAX_PITCH = 85;
const MIN_PITCH = 0;

/** MapLibre states zoom against a 512-pixel world: at zoom z the whole globe is
 *  512 · 2^z CSS pixels across. Needed to turn the frame's size in pixels into
 *  the amount of ground it covers, which is the only unit the pan reach can
 *  honestly be checked in. */
const MAPLIBRE_WORLD_PX = 512;

export interface TerrainMapOptions {
  /** Route geometry to frame, drape and mark. */
  route: Route;
  /** Logical size of the drawing — the same frame the flat map fills, so the
   *  two are interchangeable on the page. */
  width: number;
  height: number;
  /** Backing-store multiplier, passed to MapLibre as its device pixel ratio so
   *  the mesh is *rendered* at print resolution rather than rendered small and
   *  enlarged afterwards. */
  scale: number;
  /** What to drape over the topo tiles — steepness, snow depth or nothing —
   *  following the sheet's map-overlay choice exactly as the flat map does. */
  overlay?: Overlay;
  /** Which day's snow to drape, as YYYY-MM-DD. Only read when `overlay` is
   *  'snowdepth'. */
  snowDate?: string;
  /**
   * Parking lots to plant numbered signs on, in the sheet's own list order.
   *
   * Passed at build time and replaceable afterwards through `setParking`, which
   * is the path the caller actually uses: the lots arrive from Overpass seconds
   * after the map is asked for, and rebuilding a terrain map to add five points
   * would throw away the tiles, the DEM and the camera the guide had aimed.
   */
  parking?: readonly LatLng[];
  /** The still copy that actually prints. Redrawn whenever the camera rests. */
  canvas: HTMLCanvasElement;
  /** Told the compass bearing whenever it changes, so the sheet's north mark
   *  can keep pointing north while the map turns under it. */
  onBearing?: (deg: number) => void;
  /** Abort check, polled at each step that follows an await. */
  cancelled?: () => boolean;
}

export interface TerrainMapHandle {
  /**
   * Turn and tilt the camera by a drag, given as fractions of the frame's
   * width and height. Fractions rather than pixels because the frame on screen
   * and the map behind it are different sizes; the caller measures the gesture
   * against what the user can see.
   */
  turn(dxFraction: number, dyFraction: number): void;
  /**
   * Move the camera over the ground by a drag, in the same frame fractions
   * `turn` takes. The ground follows the pointer: drag right and the hillside
   * comes right with it.
   *
   * Bounded, by the reach the flat map is bounded by — see PAN_REACH. A frame
   * that can be walked anywhere can be walked off the route, and unlike a
   * screen a sheet gives no hint that the tour is somewhere north of the paper.
   */
  move(dxFraction: number, dyFraction: number): void;
  /**
   * Draw the map `offset` zoom levels closer than the framing it settled on —
   * negative for wider. Stated as an offset rather than as a zoom level so
   * that a press means the same amount of closer here as it does on the flat
   * map, on a 2 km tour and a 20 km one alike; see mapFraming.ts.
   *
   * Absolute rather than incremental, so the caller's number is the truth
   * about where the camera is. Asking twice for the same offset is a no-op
   * rather than a second step.
   */
  setZoom(offset: number): void;
  /**
   * Frame the whole route again, from the standard angle.
   *
   * The one way back. Everything else here is relative — the zoom counts from
   * the framing the map opened on, and so does the reach — which makes this the
   * only thing that can say where the route actually is. It matters most for a
   * camera inherited from the planner, which can be zoomed into one bowl of a
   * long tour: the reach is measured from that bowl, so moving cannot walk out
   * of it, and turning and tilting were never going to. Re-reads the base
   * framing for exactly that reason.
   */
  reset(): void;
  /**
   * Replace the parking signs with the ones for `points`, numbered in the order
   * given.
   *
   * Touches one GeoJSON source and nothing else: the camera, the tiles and the
   * loaded DEM all survive, which is what makes it safe to call when the lots
   * land late or the search radius changes. The still copy catches up on its
   * own, because changing a source makes the map draw and then go idle.
   */
  setParking(points: readonly LatLng[]): void;
  /** Redraw the still copy from the frame currently on screen. */
  capture(): void;
  /** Tear down the GL context, the tile pipeline and the render loop. */
  destroy(): void;
}

/** The GeoJSON MapLibre draws the route from. Route points are [lat, lng];
 *  GeoJSON wants [lng, lat]. Segments shorter than two points are dropped —
 *  a LineString of one coordinate is not a line. */
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

/** Resolve when the map says it has nothing left to load or draw — or when the
 *  clock runs out, in which case whatever is on screen is what gets printed. */
function whenSettled(map: MapLibreMap): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, CAPTURE_TIMEOUT_MS);
    map.once('idle', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Build the planner's 3D terrain view of `route` inside `holder`, and keep
 * `opts.canvas` showing a still copy of it.
 *
 * Resolves once that first copy exists, so the caller can enable Print knowing
 * the page has a finished picture on it. Rejects if the browser cannot give us
 * a terrain view at all — no WebGL, a lost context, a frame that cannot be
 * copied. The caller is expected to fall back to the flat map rather than print
 * an empty frame: a north-up map of the right tour beats a beautiful one of
 * nothing.
 */
export async function createTerrainMap(
  holder: HTMLElement,
  opts: TerrainMapOptions,
): Promise<TerrainMapHandle> {
  const {
    route,
    width,
    height,
    scale,
    overlay = 'steepness',
    snowDate,
    parking = [],
    canvas,
    onBearing,
    cancelled = () => false,
  } = opts;

  const points: [number, number][] = [];
  for (const seg of route) for (const [lat, lng] of seg) points.push([lng, lat]);
  if (points.length < 2) throw new Error('no route to frame');

  // Both modules are loaded on demand: MapLibre is around a megabyte, and a
  // guide exporting the flat map — which is the default and the common case —
  // should never pay for it. maplibreOffline pulls MapLibre in too, hence the
  // same treatment.
  const [{ default: maplibregl }, offline] = await Promise.all([
    import('maplibre-gl'),
    import('../offline/maplibreOffline'),
  ]);
  if (cancelled()) throw new Error('export closed while the map was loading');

  // The same protocol the planner's 3D view registers, so a downloaded region
  // exports without a network the way it draws without one. Idempotent.
  offline.registerOfflineMapProtocol();

  // The map is built at print size and shown small, so the container carries
  // the print size and the caller does the shrinking. See the header.
  holder.style.width = `${width}px`;
  holder.style.height = `${height}px`;

  let map: MapLibreMap | null = null;
  try {
    // The angle the guide left the planner's 3D view at, when there is one for
    // this tour. Otherwise the route's own framing, from the standard angle —
    // which is what someone who has never opened the 3D view has been shown of
    // this route, and so is what they expect to see here.
    const camera = recallTerrainCamera(route);
    const bounds = points.reduce(
      (b, p) => b.extend(p),
      new maplibregl.LngLatBounds(points[0], points[0]),
    );

    map = new maplibregl.Map({
      container: holder,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: [offline.offlineTileTemplate('topo')],
            tileSize: 256,
            maxzoom: 18,
          },
          terrain: {
            type: 'raster-dem',
            tiles: [offline.offlineTileTemplate('terrain')],
            tileSize: 256,
            encoding: 'terrarium',
            maxzoom: 15,
          },
          steepness: {
            type: 'raster',
            tiles: [offline.offlineTileTemplate('steepness')],
            tileSize: 256,
            maxzoom: 16,
          },
          // seNorge's 1 km grid, capped at its native z9 and overzoomed by
          // MapLibre above that — the same declaration the planner's 3D view
          // makes, down to the maxzoom, which is what keeps a snow-draped
          // export looking like the snow-draped map it was asked for.
          snow: {
            type: 'raster',
            tiles: [offline.offlineTileTemplate('snowdepth', snowDate)],
            tileSize: 256,
            maxzoom: 9,
          },
          route: { type: 'geojson', data: routeToGeoJSON(route) },
          connectors: { type: 'geojson', data: routeConnectorsGeoJSON(route) },
          ends: { type: 'geojson', data: routeEndpointsGeoJSON(route) },
          parking: {
            type: 'geojson',
            data: parkingSignsGeoJSON(plainParkingSigns(parking)),
          },
        },
        layers: [
          { id: 'basemap', type: 'raster', source: 'basemap' },
          // Both overlays are declared whatever was asked for and switched with
          // `visibility`, exactly as the planner declares them: MapLibre fetches
          // no tiles for a source whose only layer is hidden, so a sheet without
          // slope angles waits for nothing it is not going to print — and the
          // two sit in the planner's order, snow over steepness, so that if the
          // three-state choice ever became two checkboxes the stacking would
          // already be the one on screen.
          {
            id: 'steepness',
            type: 'raster',
            source: 'steepness',
            layout: {
              visibility: overlay === 'steepness' ? 'visible' : 'none',
            },
            paint: { 'raster-opacity': TERRAIN_STEEPNESS_OPACITY },
          },
          {
            id: 'snow',
            type: 'raster',
            source: 'snow',
            layout: {
              visibility: overlay === 'snowdepth' ? 'visible' : 'none',
            },
            paint: { 'raster-opacity': TERRAIN_SNOW_OPACITY },
          },
          // Under the route, as in the planner's 3D view: the printed sheet is
          // meant to be that view, gaps and all.
          {
            id: 'connectors',
            type: 'line',
            source: 'connectors',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: TERRAIN_CONNECTOR_PAINT,
          },
          {
            id: 'route',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: TERRAIN_ROUTE_PAINT,
          },
          {
            id: 'ends',
            type: 'circle',
            source: 'ends',
            paint: TERRAIN_ENDPOINT_PAINT,
          },
          // Above everything, including the endpoints: a lot is usually within
          // a few metres of the start, so these two marks land on top of each
          // other, and the sign is the one carrying a number the printed list
          // refers to. The layer is declared even when there are no lots yet —
          // an empty GeoJSON source draws nothing, and declaring it up front is
          // what lets `setParking` fill it later without touching the style.
          {
            id: PARKING_SIGN_LAYER,
            type: 'symbol',
            source: 'parking',
            layout: PARKING_SIGN_LAYOUT,
            paint: PARKING_SIGN_PAINT,
          },
        ],
        terrain: { source: 'terrain', exaggeration: TERRAIN_EXAGGERATION },
        sky: TERRAIN_SKY,
      },
      ...(camera
        ? camera
        : {
            bounds,
            fitBoundsOptions: {
              padding: TERRAIN_FIT_PADDING,
              pitch: TERRAIN_PITCH,
              bearing: TERRAIN_BEARING,
            },
          }),
      // MapLibre's own handlers stay off; the moving and turning below are done
      // by hand. The reason is not that its handlers are wrong but that they
      // measure in the wrong place: the frame is drawn inside a `zoom`-ed sheet
      // and shown at a fraction of the size it is rendered at, which is exactly
      // the situation in which a library's pointer arithmetic quietly disagrees
      // with the pointer. So the caller measures the gesture against the frame
      // the user can actually see and passes it here as fractions.
      //
      // The camera moves it asks for are MapLibre's own, though — panBy knows
      // what a screen drag means to a pitched, turned camera, and that is not a
      // sum worth reimplementing. Zoom is the exception: it goes through setZoom
      // below rather than through MapLibre so that a press means the same amount
      // of closer here as on the flat map.
      interactive: false,
      // Attribution is printed by the sheet, in a line that also credits the
      // elevation data this view is the only one to use.
      attributionControl: false,
      // Render at the sheet's oversample rather than the screen's, so the mesh
      // is drawn at print resolution instead of being enlarged into it.
      pixelRatio: scale,
      // Raster layers cross-fade in by default, which on a map copied the
      // instant it settles means printing a half-faded tile.
      fadeDuration: 0,
      canvasContextAttributes: {
        // The whole reason the still copy is possible: without it the frame we
        // want to copy has already been discarded by the time we ask for it.
        preserveDrawingBuffer: true,
        // Off by default, and worth the cost here: this map ends up on paper,
        // where a stair-stepped ridge line has nowhere to hide.
        antialias: true,
      },
      maxPitch: MAX_PITCH,
    });

    const gl = map;

    // Registered before the first frame, because the first frame is when the
    // symbol layer asks for its icons. See parking/signImage.ts for why they
    // are baked on demand rather than added here.
    const stopServingIcons = serveParkingSignIcons(gl);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context to copy the frame into');

    const capture = () => {
      const source = gl.getCanvas();
      // A zero-sized drawing buffer means the context is gone (or was never
      // there). Copying it would wipe the last good frame off the page.
      if (source.width === 0 || source.height === 0) return;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    };

    // Every time the camera comes to rest — after a turn, and after the last
    // tile of a newly revealed hillside lands — the printable copy catches up.
    gl.on('idle', capture);
    if (onBearing) {
      onBearing(gl.getBearing());
      gl.on('rotate', () => onBearing(gl.getBearing()));
    }

    await whenSettled(gl);
    if (cancelled()) throw new Error('export closed while the map was loading');
    capture();

    // The framing everything the guide asks for is measured from: whatever the
    // map settled on, which is the route's own fit unless a camera was
    // inherited from the planner. Re-read on reset, because that is precisely
    // the moment it changes — and if it were not, a reset from three steps in
    // would land three steps in.
    //
    // The centre is kept for the same reason the zoom is, one level up: it is
    // where the reach is measured from. Deliberately the opening picture rather
    // than the route's own middle, which is what the flat map anchors to. The
    // two agree whenever nothing was inherited, and where they differ — a
    // planner camera carried in from halfway along a traverse — anchoring to
    // the route would mean the first nudge of the map dragged the guide's own
    // considered framing back towards a centre they had already left.
    let base = { center: gl.getCenter(), zoom: gl.getZoom() };

    /**
     * Pull the camera back inside its reach, if the last move took it out.
     *
     * Checked after the fact rather than folded into the gesture, because only
     * the camera knows what a drag across a pitched, turned view is worth over
     * the ground — and a limit stated in ground terms is honestly enforced
     * where the ground position is known. In normalised Mercator, through the
     * same projection the flat map stitches its tiles in, so that three
     * quarters of a frame is the same distance on both renderers rather than
     * nearly the same.
     *
     * Measured against the *base* zoom, never the current one. That is what
     * makes the reach a fixed distance over the ground instead of a leash that
     * shortens every time the guide zooms in — which would strand them at the
     * crux, at exactly the zoom where walking along the route is the point.
     */
    const leash = () => {
      const worldPx = MAPLIBRE_WORLD_PX * 2 ** base.zoom;
      const limitX = (PAN_REACH * width) / worldPx;
      const limitY = (PAN_REACH * height) / worldPx;
      const anchorX = lngToTileX(base.center.lng, 0);
      const anchorY = latToTileY(base.center.lat, 0);
      const here = gl.getCenter();
      const hereX = lngToTileX(here.lng, 0);
      const hereY = latToTileY(here.lat, 0);
      const x = Math.min(anchorX + limitX, Math.max(anchorX - limitX, hereX));
      const y = Math.min(anchorY + limitY, Math.max(anchorY - limitY, hereY));
      if (x === hereX && y === hereY) return;
      gl.jumpTo({ center: [tileXToLng(x, 0), tileYToLat(y, 0)] });
    };

    return {
      turn(dxFraction, dyFraction) {
        gl.jumpTo({
          bearing: gl.getBearing() + dxFraction * TURN_PER_FRAME,
          // Up is further from the ground, matching every other map with a
          // tilt: drag towards the horizon and the horizon comes into view.
          pitch: Math.min(
            MAX_PITCH,
            Math.max(MIN_PITCH, gl.getPitch() - dyFraction * TILT_PER_FRAME),
          ),
        });
      },
      move(dxFraction, dyFraction) {
        // MapLibre's panBy moves the *frame*, so the ground goes the opposite
        // way; negated here so the hillside follows the pointer, which is what
        // every map the guide has ever dragged does. Fractions become pixels of
        // the map's own coordinate space, which is the print-size frame — the
        // caller measured the gesture against the shrunken copy of exactly that.
        gl.panBy([-dxFraction * width, -dyFraction * height], { duration: 0 });
        leash();
      },
      setZoom(offset) {
        // MapLibre's own ceiling and floor still apply: a short tour fits at a
        // zoom that has only a step or two of headroom left above it, and
        // asking for more than the style can give would silently land
        // somewhere other than where the buttons say.
        gl.jumpTo({
          zoom: Math.min(
            gl.getMaxZoom(),
            Math.max(gl.getMinZoom(), base.zoom + offset),
          ),
        });
      },
      reset() {
        // The same framing the map would have opened on had the planner's 3D
        // view never been used: the whole route, from the standard angle. Done
        // instantly rather than flown, because the frame is a picture being
        // composed, not a place being travelled to — and because the still copy
        // is retaken when the camera rests, a flight would print whichever
        // frame the animation happened to be on if Print were hit mid-flight.
        gl.fitBounds(bounds, {
          padding: TERRAIN_FIT_PADDING,
          pitch: TERRAIN_PITCH,
          bearing: TERRAIN_BEARING,
          duration: 0,
        });
        // Both halves of the base, together: the camera is back on the route's
        // own fit, so that is now the zoom offsets count from *and* the point
        // the reach is measured around. Updating one without the other is how a
        // map ends up leashed to a place it is no longer anywhere near.
        base = { center: gl.getCenter(), zoom: gl.getZoom() };
      },
      setParking(next) {
        const source = gl.getSource<GeoJSONSource>('parking');
        // A style that has been torn down, or a map still building one, has no
        // such source. Nothing to update and nothing to log: the build hands
        // its own points in through the style above, so the only way here early
        // is a caller racing its own map, and its next call will land.
        if (!source) return;
        source.setData(parkingSignsGeoJSON(plainParkingSigns(next)));
      },
      capture,
      destroy() {
        stopServingIcons();
        gl.remove();
      },
    };
  } catch (err) {
    // Even on the failure path: a GL context left behind by an export nobody
    // completed is a context the browser will eventually take from a map the
    // user is still using.
    map?.remove();
    throw err;
  }
}
