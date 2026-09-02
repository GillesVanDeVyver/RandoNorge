// The planner: a full-bleed Kartverket topo map, the NVE steepness overlay, the
// drawing tools, the live position marker, and everything the map cannot say in
// a bottom sheet over it.
//
// ONE COMPONENT, TWO ROUTES, and that is the whole reason this file exists
// rather than being the body of `app/route/[id].tsx`. `/planner` opens it with
// nothing loaded and `/route/[id]` opens it on a saved route, exactly as
// apps/web has one App.tsx serving both — the web's planner IS its route screen,
// keyed on whether `savedMeta` is set. The alternative was a second screen with
// its own copy of the map, the two raster sources, the drawing surface, the
// projection, the profile hook and the three data cards, and a second copy of
// all of that is a second place for the phone to disagree with the laptop about
// what a route is.
//
// THE MODE IS NOT A PROP. It is `savedMeta === null`. That is not a shortcut: it
// is what makes "save a new route and keep planning" fall out for free rather
// than needing a state machine. A successful `createRoute` states the load, the
// route now has an id and a name, and every later save is an update — the same
// flip the web performs when its own `savedMeta` goes from null to a row.
//
// WHERE THE MAP OPENS, in the three cases, because the answer differs and the
// difference is the point:
//
//   - A saved route with geometry frames its own bounding box. Nothing else is
//     as informative, and it is what the previous route screen always did.
//   - A blank planner opens on all of Norway (core's INITIAL_CENTER/INITIAL_ZOOM,
//     the same view the web's map opens on) and then EASES to the user's
//     position if one arrives. Not a spinner in front of the map while location
//     is negotiated: the permission dialog can sit there for as long as the user
//     likes, and a planner that is a grey rectangle until they answer it is a
//     planner that looks broken. Norway is a real answer that is immediately
//     pannable; the ease is an improvement on it, and it is abandoned the moment
//     the user touches the map.
//   - A saved route whose geometry failed to parse has no bounds, so it takes
//     the blank planner's path. That is the right fallback rather than a
//     coincidence: there is nothing to frame either way.
//
// WHY A HAND-BUILT STYLE INSTEAD OF A STYLE URL. MapLibre normally loads a style
// document from a URL, and that document names the sources. Here the sources are
// already described — in @fjellrute/core/offline/layers, where the same
// descriptors drive the offline downloader and the web app's live layers.
// Pointing at a style URL would mean a second, independent statement of the same
// tile URLs, and the two would drift the first time Kartverket changes a path.
// So the map starts from an EMPTY style and the layers are added as children,
// built from those descriptors via core's `tileUrlTemplate`.
//
// LAYER ORDER IS CHILD ORDER. Topo, then steepness on top of it, then the route
// line on top of both, then the position marker. Reordering the JSX reorders the
// map, which is why the route line is last rather than grouped with the rasters.
//
// THE THREE PIECES DRAWING NEEDS, and why each is somewhere else. The gestures
// are in src/ui/DrawingSurface — a transparent overlay, because MapLibre's own
// press events fire on tap and drawing needs the whole drag. The maths is in
// @fjellrute/core/draw/tools, shared with both of the web's maps, because
// otherwise "the same drag produces different routes on the two clients". And
// the projection is core's too (@fjellrute/core/geometry/viewport), because
// MapLibre React Native's own project/unproject return Promises and a stroke
// cannot wait for the bridge.
//
// WHAT IS STILL DELIBERATELY ABSENT: straight-line drawing with draggable
// vertices, recording, offline caching, import/export, the printed briefing. The
// first is its own gesture problem; the rest each need a decision this screen
// does not have to make (a background task, a tile store, a native file picker,
// a native PDF).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRouter } from 'expo-router';
// The installed library is @maplibre/maplibre-react-native v11, whose component
// surface differs from the v10 API most examples online still show. The four
// differences that matter here, because each one is a silent rename rather than
// an error you can guess at:
//
//   v10                             v11
//   <MapView>                       <Map>
//   <RasterLayer>, <LineLayer>      <Layer type="raster">, <Layer type="line">
//   <ShapeSource shape={…}>         <GeoJSONSource data={…}>
//   style={{ lineColor: … }}        paint={{ 'line-color': … }} / layout={{…}}
//
// The last is the substantive one: v11 takes the MapLibre style spec's own
// hyphenated property names, split into `paint` and `layout` exactly as the spec
// splits them, instead of a camelCased dialect of its own. `style` still exists
// on Layer but warns and is removed in v12, so it is not used here.
//
// `Map` is aliased because an unaliased import would shadow the global Map
// constructor for the whole module — harmless today, a genuinely baffling bug
// the first time someone adds a lookup table to this file.
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  RasterSource,
  UserLocation,
  type CameraRef,
  type InitialViewState,
  type MapRef,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useT } from '@fjellrute/core/i18n';
import {
  createRoute,
  getRoute,
  routeToFeature,
  updateRoute,
  type SavedRoute,
} from '@fjellrute/core/routes/api';
import { formatAscent, formatDistance } from '@fjellrute/core/routes/format';
import { useProfile } from '@fjellrute/core/elevation/useProfile';
import { OFFLINE_LAYERS, tileUrlTemplate } from '@fjellrute/core/offline/layers';
// Where a map opens when it has nothing of its own to open on. In core rather
// than here because apps/web already stated it twice — see the module's header.
import {
  INITIAL_CENTER,
  INITIAL_ZOOM,
  LOCATED_ZOOM,
} from '@fjellrute/core/map/view';
// The route's colour and the two line widths, from core rather than from four
// literals in this file. The file they come from is the one apps/web draws its
// own route with, so a route is the same line on both clients by construction
// rather than by everyone remembering.
import {
  HALO_COLOR,
  HALO_OPACITY,
  HALO_WEIGHT,
  ROUTE_COLOR,
  ROUTE_WEIGHT,
} from '@fjellrute/core/routes/style';
// The shared drawing halves. `eraseDisk` and ERASER_RADIUS_PX are the same
// eraser apps/web runs — see the module header for why one copy rather than
// three — and `createViewport` is the synchronous projection it needs, which on
// this platform has to be computed rather than asked for.
import { ERASER_RADIUS_PX, eraseDisk } from '@fjellrute/core/draw/tools';
import {
  createViewport,
  type Viewport,
} from '@fjellrute/core/geometry/viewport';
import type { LatLng, Mode, Route, Segment } from '@fjellrute/core/types';
import { DrawingSurface } from './DrawingSurface';
import { EditToolbar } from './EditToolbar';
import { ElevationProfile } from './ElevationProfile';
import { SaveRouteDialog } from './SaveRouteDialog';
import { SheetCard, SHEET_PEEK, SummarySheet } from './SummarySheet';
// The three data cards. Each is a core hook plus a React Native view — see their
// own headers — and each takes the computed profile, which is why none of them
// can appear before the elevation pass has finished: the forecast is anchored to
// the route's lowest and highest points, the snow depths are fetched per profile
// point, and the avalanche regions are sampled along it.
import { WeatherCard } from './WeatherCard';
import { SnowCard } from './SnowCard';
import { AvalancheCard } from './AvalancheCard';
import { colors, fontSize, radius, shadow, space, TOUCH_TARGET } from './theme';

/**
 * An empty but valid MapLibre style. Every source and layer is contributed by
 * the children below, so this only has to satisfy the spec: version 8, and the
 * two collections present even though they are empty. Frozen at module scope
 * because a new object identity on each render makes MapLibre reload the style,
 * which flashes the map white.
 */
const EMPTY_STYLE = JSON.stringify({
  version: 8,
  sources: {},
  layers: [],
});

// The two layers this screen shows, and their tile URLs as MapLibre templates.
//
// `tileUrlTemplate` is core's, not this file's: the descriptors expose tileUrl
// as a function (the offline downloader enumerates concrete tiles), MapLibre
// wants a `{z}/{x}/{y}` template, and the conversion between them belongs next
// to the descriptors so there is one statement of each URL rather than one here
// and one in the web app. It throws for a layer that has no template — snow
// depth, whose URL encodes a computed bounding box — which is why these are two
// named layers and not a loop over OFFLINE_LAYERS.
//
// Computed once at module scope. A template recomputed per render is a new
// string identity, and MapLibre treats a changed tile URL as a new source.
const TOPO = OFFLINE_LAYERS.topo;
const STEEPNESS = OFFLINE_LAYERS.steepness;
const TOPO_TEMPLATE = tileUrlTemplate(TOPO);
const STEEPNESS_TEMPLATE = tileUrlTemplate(STEEPNESS);

/**
 * Required credit, not decoration: Kartverket's topo cache and NVE's steepness
 * cache are both used under terms that require attribution.
 *
 * Declared once and used twice — on the source, and in the floating line above
 * the sheet. Two uses because they answer different questions. The floating line
 * is what a user actually sees, since MapLibre's own attribution control is
 * disabled (it reads a style document, and this map has none). The `attribution`
 * prop on the source is metadata that travels with the source, so anything that
 * later enumerates the map's credits — the built-in control if it is ever turned
 * on, a static-map export — finds them already attached rather than needing this
 * list restated. Not localized: an organisation's name is its name.
 */
const TOPO_ATTRIBUTION = '© Kartverket';
const STEEPNESS_ATTRIBUTION = '© NVE';

/**
 * Camera padding, so a route that reaches the edge of its own bounding box is
 * not framed underneath the chrome that floats over it.
 *
 * The bottom number is `SHEET_PEEK` plus a gap rather than a literal 88. They
 * are identical today, and they stop being identical the moment the sheet's
 * height changes — which is precisely the kind of second copy the web avoids by
 * having App.module.css read the same `--sheet-peek` the panel sets.
 */
const CAMERA_PADDING = {
  top: 64,
  right: 32,
  bottom: SHEET_PEEK + space.s6,
  left: 32,
};

/**
 * Height of the steepness pill, so the edit toolbar can be parked underneath it
 * rather than on top of it. Named because it is used twice — in the pill's own
 * style and in the toolbar's offset — and two 36s would come apart the first
 * time one of them was tuned.
 */
const PILL_HEIGHT = TOUCH_TARGET - 8;

/**
 * The in-progress stroke, drawn at 70% while the finger is still down.
 *
 * The same 0.7 apps/web uses for its live line (LIVE_LINE_STYLE in
 * DrawingHandler.tsx). It is not decoration: the translucency is what says this
 * line is not yet part of the route, which matters most at the moment it crosses
 * a line that is.
 */
const LIVE_OPACITY = 0.7;

/**
 * How long the map takes to travel from the whole of Norway to the user's
 * position, and how long the "route saved" confirmation stays up.
 *
 * The ease is deliberately slow for an animation. It crosses most of a country,
 * and a fast one reads as a teleport — the user loses track of where they were
 * looking and, more importantly, of the fact that this is the same map. Slow
 * enough to follow is also slow enough to interrupt, which is the point: a touch
 * during it takes the camera back.
 *
 * The toast is the web's 4000, so the same sentence is readable for the same
 * length of time on both clients.
 */
const LOCATE_EASE_MS = 1400;
const SAVED_TOAST_MS = 4000;

/**
 * The geometry a brand new route starts from, as one shared array.
 *
 * It has to be a module-scope constant rather than a fresh `[]`, because the
 * whole editing model below is built on reference identity: `loaded` is what the
 * server holds, a session belongs to the load whose array it points at, and
 * `dirty` is `active.route !== loaded`. A new empty array per render would make
 * every session stale on the render after it was created, so the first stroke
 * would be dropped and the route would never become dirty.
 */
const NEW_ROUTE: Route = [];

/**
 * Loading a route by id. `saved` is null for a blank planner — which is also
 * what makes the two modes one component: see the module header.
 */
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; saved: SavedRoute | null }
  | { status: 'error'; message: string };

/**
 * An editing session: a working copy of one route, and the loaded array it was
 * derived from.
 *
 * `source` is what makes the session self-invalidating. It is the array the
 * loader produced, so `source === loaded` is the question "does this session
 * still belong to what is on screen", answered by identity rather than by an
 * effect that clears things.
 */
interface EditSession {
  /** The array the loader produced, and therefore what the server holds. */
  source: Route;
  /** The working copy: the geometry the map, the profile and the save all read. */
  route: Route;
  /** The route before each finished gesture, oldest first. One entry per drag,
   *  not per touch sample, which is what makes undo a step a user recognises. */
  history: Route[];
}

/** Which tool is in hand, and whether the toolbar row is showing — tagged with
 *  the route they were chosen for. See the state's declaration. */
interface ToolState {
  key: string;
  mode: Mode;
  open: boolean;
}

/**
 * The empty undo stack, as one shared array.
 *
 * A fresh `[]` per render would be a new identity every time, and `history` is
 * read by `EditToolbar` — a memo-friendly component being handed a new array
 * sixty times during a pan is the kind of thing that only shows up as a dropped
 * frame much later.
 */
const NO_HISTORY: Route[] = [];

/**
 * The route's bounding box as MapLibre's LngLatBounds.
 *
 * That type is a FLAT four-tuple in GeoJSON's order — `[west, south, east,
 * north]` — not a pair of corners and not lat-first. Core stores its points as
 * `[lat, lng]` (Leaflet's order, which the web app was written against), so
 * every coordinate here is transposed exactly once, on the way out.
 */
function boundsOf(route: Route): [number, number, number, number] | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const segment of route) {
    for (const [lat, lng] of segment) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

interface Props {
  /** The saved route to open, or null for a blank planner. */
  routeId: string | null;
}

export function Planner({ routeId }: Props) {
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();

  // A blank planner has nothing to wait for, so it starts READY rather than
  // loading. Written as a lazy initialiser so the branch is taken once, at
  // mount, instead of being re-evaluated and discarded on every render.
  const [state, setState] = useState<LoadState>(() =>
    routeId === null
      ? { status: 'ready', saved: null }
      : { status: 'loading' },
  );
  const [showSteepness, setShowSteepness] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);

  // ---- Editing state -------------------------------------------------------
  //
  // ONE OBJECT, CARRYING THE ARRAY IT WAS DERIVED FROM. The obvious shape is a
  // working copy in its own useState, seeded from the loader by an effect — and
  // that effect has to call setState synchronously in its body, which is a
  // cascading render (react-hooks/set-state-in-effect flags it, and it is right
  // to; src/ui/WeatherIcons.tsx has the same note). Pairing the working copy
  // with the loaded array it started from means a session belonging to an
  // earlier load is simply not selected below: nothing has to be reset, and the
  // seeding is a reference comparison instead of a render pass.
  //
  // It is also what makes "are there unsaved changes" exact rather than
  // approximate. `history` holds the previous arrays themselves, so undoing
  // every edit restores the very object `source` points at and `dirty` then
  // correctly says no.
  const [session, setSession] = useState<EditSession | null>(null);
  // The eraser mid-drag, separate from the session for one reason: `useProfile`
  // re-runs on a new route identity, and one run is several hundred Kartverket
  // requests. An eraser that wrote straight into the session would start — and
  // abort — one of those per touch sample. The preview is what the map draws;
  // the session only moves when the finger lifts.
  const [preview, setPreview] = useState<Route | null>(null);
  const [live, setLive] = useState<Segment | null>(null);
  // The tool in hand, keyed on which route it was chosen for, for the same
  // reason and by the same means as the session above: a pencil still in hand
  // after the screen is pointed at a different route is a map that does not pan
  // and no longer says why, and keying the state resets it without an effect.
  // Mode and openness share one object because they are set together as often
  // as separately.
  //
  // The key is the id, or the literal 'new' for a blank planner. It must stay
  // 'new' even after the route has been saved: the screen is still the same
  // screen and the pencil is still in the same hand, and re-keying on the fresh
  // id would drop the tool at the exact moment the user was told the save
  // succeeded.
  const key = routeId ?? 'new';
  const [tool, setTool] = useState<ToolState>({
    key,
    mode: 'idle',
    open: false,
  });
  // The name-and-notes dialog. It owns its own busy and error state — see
  // SaveRouteDialog — which is why there is no `saving` flag here.
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The map's camera, kept current from its own region events, and the view's
  // pixel size, which the map does not report and onLayout does. Refs rather
  // than state: these change on every frame of a pan and nothing renders from
  // them — the only reader is the drawing surface, at the instant a finger
  // lands. Putting them in state would re-render the whole screen sixty times
  // a second for a value nothing is showing.
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<{
    center: LatLng;
    zoom: number;
    bearing: number;
  } | null>(null);
  const sizeRef = useRef<{ width: number; height: number } | null>(null);
  // The eraser accumulates here across a drag, for the same reason the web's
  // handler keeps an eraseRouteRef: each sample cuts the result of the last
  // one, and reading it back out of React state would cut a copy one render
  // behind the finger.
  const previewRef = useRef<Route | null>(null);

  // ---- The opening camera --------------------------------------------------
  //
  // `cameraCtl` is the imperative handle, and it is a SEPARATE ref from
  // `cameraRef` above on purpose: that one holds where the camera IS, read by
  // the projection; this one is how the camera is TOLD to move. One ref doing
  // both would be two unrelated jobs sharing a name, and the projection's ref is
  // written sixty times a second.
  const cameraCtl = useRef<CameraRef>(null);
  // Whether the map has finished loading, whether the user has moved it
  // themselves, and whether the one-off ease to their position has already run.
  // Only the first is state: the other two are read at the moment the ease is
  // decided and nothing renders from either.
  const [mapReady, setMapReady] = useState(false);
  const touchedRef = useRef(false);
  const easedRef = useRef(false);
  const [fix, setFix] = useState<LatLng | null>(null);

  // RETURNS the next state rather than setting it — same shape as the list
  // screen, and for the same two reasons: the effect and the retry button want
  // different things on screen while the request is in flight, and a fetch that
  // sets state itself cannot be called from an effect without being able to
  // land on a screen the user has already navigated away from. Here the effect
  // owns that decision and can drop a late reply.
  const fetchRoute = useCallback(async (): Promise<LoadState | null> => {
    if (routeId === null) return null;
    try {
      return { status: 'ready', saved: await getRoute(routeId) };
    } catch (cause) {
      return {
        status: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }, [routeId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchRoute();
      // Going back while the route is still loading is the ordinary case on a
      // slow connection, not an edge case.
      if (next && !cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchRoute]);

  /** The error view's button: back to the spinner, then load again. */
  const retry = () => {
    // Leaving the message up while the request is in flight makes the button
    // look inert.
    setState({ status: 'loading' });
    void fetchRoute().then((next) => {
      if (next) setState(next);
    });
  };

  // ---- What the rest of the screen reads -----------------------------------
  //
  // The loaded geometry, and then the session applied over it if the session
  // still belongs to it. A session from an earlier load is dropped rather than
  // migrated: its history steps back through arrays the server no longer holds,
  // and an undo stack that reaches into a route that has since been replaced is
  // worse than no undo stack.
  //
  // A SAVE PASSES THROUGH HERE AND COSTS NOTHING. It re-states the load with
  // the very array the user is holding, so `loaded` becomes that array,
  // `session.source` no longer matches, the session is dropped — and `route`
  // lands back on the identical object. Nothing downstream sees a change, so
  // the profile does not recompute for a route that did not move.
  const savedMeta = state.status === 'ready' ? state.saved : null;
  const loaded =
    state.status === 'ready' ? (state.saved?.route ?? NEW_ROUTE) : null;
  const active = session && session.source === loaded ? session : null;
  const route = active?.route ?? loaded;
  const history = active?.history ?? NO_HISTORY;
  const mode = tool.key === key ? tool.mode : 'idle';
  const toolbarOpen = tool.key === key ? tool.open : false;

  // UPDATER FORM, and it has to be. `EditToolbar` picks a tool and folds the
  // row down in the same handler — two calls, one render — and a setter that
  // reassembled the object out of this render's `mode` and `toolbarOpen` would
  // have the second call write back the tool the first one just replaced. The
  // `current.key === key` guard inside each is the same reset the derivation
  // above performs, applied to the value being carried through rather than to
  // the one being set.
  const setMode = (next: Mode) =>
    setTool((current) => ({
      key,
      mode: next,
      open: current.key === key && current.open,
    }));
  const setToolbarOpen = (open: boolean) =>
    setTool((current) => ({
      key,
      mode: current.key === key ? current.mode : 'idle',
      open,
    }));

  // ---- The camera, as a synchronous projection -----------------------------
  //
  // Fed from three places, because no one of them is enough. The region events
  // report every pan, zoom and rotate but say nothing until the map first
  // moves; `getViewState()` answers at any time but only when asked, and only
  // eventually; and neither knows how large the view is on screen.
  const rememberCamera = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const { center, zoom, bearing, userInteraction } = event.nativeEvent;
      // A move the USER made, as opposed to one this screen animated. It is the
      // only reliable way to tell the two apart, and it is what cancels the ease
      // to the user's position: once someone has chosen where to look, arriving
      // at a GPS fix is no longer a reason to move the map out from under them.
      if (userInteraction) touchedRef.current = true;
      // MapLibre speaks [lng, lat]; core stores [lat, lng] everywhere.
      // Transposed once, here, on the way in.
      cameraRef.current = { center: [center[1], center[0]], zoom, bearing };
    },
    [],
  );

  // The view's size, measured on the SCREEN ROOT rather than on the map. The
  // map, the drawing surface and this container are three views stacked at
  // exactly the same rectangle — the map is the root's only flex child and
  // everything else over it is absolutely positioned — so one measurement
  // describes all three. Measuring the map itself would be the same number by
  // a longer route: v11's `Map` renders a wrapper View that already owns its
  // own `onLayout`, and a second one would have to be handed to the native
  // child through the props spread.
  const onMapLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    sizeRef.current = { width, height };
  }, []);

  // Ask the map where it is, once it has one. Covers the case the region events
  // cannot: a route opened, framed by the initial camera, and drawn on before
  // the user has panned anything.
  const seedCamera = useCallback(() => {
    void mapRef.current?.getViewState().then((view) => {
      cameraRef.current = {
        center: [view.center[1], view.center[0]],
        zoom: view.zoom,
        bearing: view.bearing,
      };
    });
  }, []);

  /** The map has a style and a camera. Both halves matter: `seedCamera` needs a
   *  map to ask, and the ease below needs one to command. */
  const handleMapLoaded = useCallback(() => {
    seedCamera();
    setMapReady(true);
  }, [seedCamera]);

  /** The projection to draw against, as of right now, or null if the map has
   *  not said where it is yet. Rebuilt per gesture rather than cached: it is a
   *  handful of trigonometry, and a cached one would be a second place for the
   *  camera to be stale. */
  const getViewport = useCallback((): Viewport | null => {
    const camera = cameraRef.current;
    const size = sizeRef.current;
    if (!camera || !size) return null;
    return createViewport({ ...camera, ...size });
  }, []);

  // ---- Edits ---------------------------------------------------------------
  //
  // PLAIN FUNCTIONS, NOT useCallback. Every one of them reads `route`,
  // `history` and `loaded` straight out of this render — the values the control
  // the user just touched was drawn from — so there is nothing stale to guard
  // against and no ref to mirror. The gesture surface can afford it: it holds
  // its props behind a ref of its own (see DrawingSurface's header) precisely so
  // that new callback identities on every render do not rebuild the responder
  // mid-stroke.

  /** Replace the working copy, remembering what it replaced.
   *
   *  One `history` entry per call, and a call is one finished gesture rather
   *  than one touch sample — which is what makes undo a step a user
   *  recognises. */
  const applyEdit = (next: Route) => {
    if (!loaded) return;
    setSession({
      source: loaded,
      route: next,
      // `[loaded]` when there was no session: the first edit's undo target is
      // the route as it arrived, which is the one step the user most wants back.
      // On a blank planner that is the empty NEW_ROUTE, so undoing the first
      // stroke correctly leaves a clean canvas rather than nothing to step to.
      history: active ? [...active.history, active.route] : [loaded],
    });
  };

  /** A finished stroke becomes one more segment, appended in travel order.
   *
   *  Appended rather than merged into the last segment, even when it starts
   *  where that one ended: core's `routeConnectors` reads consecutive segments
   *  as legs of one tour and bridges any gap between them, so keeping strokes
   *  separate loses nothing and keeps each drag undoable on its own. */
  const handleDrawCommit = (stroke: Segment) => {
    applyEdit([...(route ?? []), stroke]);
  };

  /** One eraser sample. Cuts the accumulated result, not the committed route,
   *  so a single drag through a switchback removes both crossings. */
  const handleErase = (cursor: LatLng, viewport: Viewport) => {
    const source = previewRef.current ?? route;
    if (!source) return;
    const next = eraseDisk(
      source,
      cursor,
      viewport.project,
      viewport.unproject,
      ERASER_RADIUS_PX,
    );
    // null means the disk touched nothing. Skipping the state update here is
    // what keeps a drag across empty ground free.
    if (next) {
      previewRef.current = next;
      setPreview(next);
    }
  };

  /** The eraser has been lifted. Whatever it accumulated becomes the edit —
   *  one undo step for the whole drag, and one profile recompute. */
  const handleEraseCommit = () => {
    const pending = previewRef.current;
    previewRef.current = null;
    setPreview(null);
    if (pending) applyEdit(pending);
  };

  const undo = () => {
    if (!active || active.history.length === 0) return;
    setSession({
      source: active.source,
      route: active.history[active.history.length - 1],
      history: active.history.slice(0, -1),
    });
  };

  const clearAll = () => {
    // Not confirmed, because it is undoable — and a confirmation dialog in
    // front of a reversible action trains people to dismiss dialogs. Erase and
    // clear both step back through the same history.
    applyEdit([]);
    setMode('idle');
  };

  // The header title is the saved route's name, so it is only set once there is
  // one. Set here rather than via Stack.Screen options so there is no flash of
  // the id — and left alone entirely while the route is unsaved, which is what
  // lets `/planner` keep the "Plan" title the router registered for it until the
  // moment the route acquires a name of its own.
  useEffect(() => {
    const name = state.status === 'ready' ? state.saved?.name : undefined;
    if (name) navigation.setOptions({ title: name });
  }, [navigation, state]);

  // ---- Location ------------------------------------------------------------
  //
  // Foreground permission, asked for at the moment the map appears rather than
  // at launch: a prompt the user can connect to something they can see is far
  // more likely to be granted. Denial is not an error — the map is fully usable
  // without a position marker — so it is recorded and never retried.
  //
  // The fix is then read TWICE, and the pair is the whole trick. The last known
  // position returns from the OS cache more or less instantly and is usually
  // right to within a few hundred metres, which at this zoom is the same view;
  // the live one can take several seconds outdoors and much longer indoors. Only
  // one ease runs, so whichever arrives first is the one that moves the map and
  // the later, better fix quietly updates the marker instead of yanking the
  // camera a second time.
  //
  // Nothing here has a timeout, because nothing is waiting on it: the map is
  // already up and already pannable on the Norway view. A fix that never arrives
  // is not a failure state, it is simply the fallback standing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Declared without an initial value on purpose: both paths below assign
      // it, so a `= false` here would be a value nothing can ever read.
      let granted: boolean;
      try {
        granted = (await Location.requestForegroundPermissionsAsync()).granted;
      } catch {
        // The permission call itself failing (no location provider on the
        // device, a stubbed module in a test build) is indistinguishable from a
        // refusal as far as this screen is concerned.
        granted = false;
      }
      if (cancelled) return;
      setLocationGranted(granted);
      if (!granted) return;
      try {
        const last = await Location.getLastKnownPositionAsync();
        if (cancelled) return;
        if (last) setFix([last.coords.latitude, last.coords.longitude]);
        const now = await Location.getCurrentPositionAsync({
          // Balanced, not BestForNavigation: this is one fix used to choose an
          // opening view, and the difference between the two accuracies is far
          // below a pixel at this zoom while the difference in how long they
          // take, and in what they cost the battery, is not.
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        setFix([now.coords.latitude, now.coords.longitude]);
      } catch {
        // No fix. The Norway view stands, which is a usable map.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Framing only, and only once — so this deliberately reads the LOADED route
  // rather than the working copy. Recomputing it from `route` would hand the
  // camera a new bounding box after every stroke; `initialViewState` ignores
  // later values, but the memo would still churn for nothing.
  const bounds = useMemo(() => (loaded ? boundsOf(loaded) : null), [loaded]);

  /**
   * Where the map opens. A saved route frames itself; everything else opens on
   * the country, from core's constants rather than from a pair of numbers typed
   * here — see the import.
   *
   * `initialViewState` and not the controlled `bounds`/`center` props: this
   * places the camera once, when the map first loads, and then leaves it alone.
   * The controlled form would snap the view back on every re-render — including
   * a locale change, the steepness toggle, or the profile arriving — undoing
   * whatever the user had panned to.
   */
  const initialViewState = useMemo((): InitialViewState => {
    if (bounds) {
      // ViewPadding is the CSS-ish {top,right,bottom,left}, not React Native's
      // paddingTop names.
      return { bounds, padding: CAMERA_PADDING };
    }
    return {
      center: [INITIAL_CENTER[1], INITIAL_CENTER[0]],
      zoom: INITIAL_ZOOM,
    };
  }, [bounds]);

  // The one-off ease from the country to the user. Four conditions, and each one
  // is a way this would otherwise be wrong: no map to command yet; no fix yet;
  // the route framed itself and moving off it would be destroying the one thing
  // the screen was opened to show; and the user has already chosen a view, or
  // this has already run.
  useEffect(() => {
    if (!mapReady || !fix || bounds || touchedRef.current || easedRef.current) {
      return;
    }
    easedRef.current = true;
    cameraCtl.current?.easeTo({
      center: [fix[1], fix[0]],
      zoom: LOCATED_ZOOM,
      duration: LOCATE_EASE_MS,
    });
  }, [mapReady, fix, bounds]);

  // WHAT THE MAP DRAWS: the eraser's preview if a finger is cutting, otherwise
  // the working copy. `preview ?? route`, in that order, is the whole of the
  // mid-drag illusion — the line disappears under the eraser in real time while
  // `route`, and therefore the profile and the cards, stay on the last
  // committed geometry until the finger lifts.
  const shown = preview ?? route;

  const geojson = useMemo(() => {
    if (!shown || shown.length === 0) return null;
    // Exactly the shape the API stores and the web app draws: one
    // MultiLineString whose members are the drawn segments, so eraser gaps stay
    // gaps instead of being joined by a straight line across the mountain.
    return routeToFeature(shown, null);
  }, [shown]);

  /** The stroke under the finger, as its own one-segment feature.
   *
   *  A separate source rather than an extra member of the one above, because
   *  the two are redrawn at completely different rates: this one changes on
   *  every animation frame of a drag, and appending it to the route's feature
   *  would hand MapLibre the entire route to re-parse sixty times a second. */
  const liveGeojson = useMemo(
    () => (live && live.length >= 2 ? routeToFeature([live], null) : null),
    [live],
  );

  // The drawn geometry, as a reference that only changes when the route does.
  // `useProfile` re-runs on identity, and identity here means several hundred
  // Kartverket requests, so this is the committed `route` and never `shown`:
  // the eraser's preview changes per touch sample, and feeding it here would
  // start and abort a profile pass per sample.
  const routeGeometry = route;

  // Core's hook, running the same `computeProfile` the web runs — see
  // useProfile's header for why the phone runs it in place while the web pushes
  // it into a worker. Called unconditionally, above the early returns, because
  // the number of hooks a component calls may not change between renders.
  const elevation = useProfile(routeGeometry);

  // ---- Saving --------------------------------------------------------------
  //
  // Unsaved work is the reference comparison described above: `history` may be
  // deep and the route still be exactly what the server has, if the user undid
  // everything they did.
  const dirty = active !== null && active.route !== loaded;

  const showSavedToast = () => {
    setSavedToast(true);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setSavedToast(false);
      toastTimer.current = null;
    }, SAVED_TOAST_MS);
  };

  const dismissToast = () => {
    if (toastTimer.current !== null) {
      clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    setSavedToast(false);
  };

  useEffect(
    () => () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    },
    [],
  );

  /**
   * The dialog's `onSave`. THROWS ON FAILURE, deliberately: the dialog catches,
   * shows the message inline and keeps everything the user typed, which is the
   * behaviour the web has and the reason this screen no longer carries a
   * `saveError` of its own.
   *
   * Create or update is decided by `savedMeta`, and after a create the very next
   * `setState` makes it non-null — so the second save of a brand new route is an
   * update rather than a duplicate, with no extra state to keep in step.
   */
  const handleSave = async (name: string, description: string) => {
    const current = route;
    if (!current) return;
    const stats = elevation.profile?.stats ?? null;
    // The freshly measured figures. Null only when the profile failed outright —
    // the save control is held back while it is still computing, precisely so
    // this is not the ordinary path. Writing nulls is still the right answer for
    // a failure: the alternative is keeping the numbers the route arrived with,
    // and those describe the line the user just changed.
    const measured = stats
      ? {
          distanceM: stats.distance,
          ascentM: stats.ascent,
          descentM: stats.descent,
        }
      : null;
    const saved = savedMeta
      ? await updateRoute(savedMeta.id, {
          name,
          description,
          route: current,
          stats: measured,
          // THE FROZEN FORECAST IS CLEARED, not rewritten. A snapshot is
          // anchored to the geometry it was taken over — its weather is read at
          // the route's lowest and highest points, its avalanche regions are the
          // ones the line crossed — and after an edit some of that ground is no
          // longer on the route. Keeping it would show numbers for a tour that
          // no longer exists, which is worse than showing none: the cards fall
          // back to live data, which is what an unsaved route shows anyway.
          // Capturing a fresh snapshot is the right end state and needs the
          // web's ForecastContext plumbing, which has not come over yet.
          forecast: null,
        })
      : await createRoute({
          name,
          description,
          route: current,
          stats: measured,
          forecast: null,
        });
    // Re-state the load with the array the user is holding, not the one the
    // server just echoed back. Same geometry either way, but a new array
    // identity would send `useProfile` off to recompute several hundred
    // elevation samples for a route that did not change.
    setState({ status: 'ready', saved: { ...saved, route: current } });
    setSaveOpen(false);
    showSavedToast();
  };

  // Leaving with unsaved edits. `beforeRemove` fires for the header's back
  // button, the Android hardware back and an iOS swipe alike, which is why the
  // guard is here rather than on the button: a drawn route is minutes of work
  // and every one of those three loses it silently otherwise.
  useEffect(() => {
    if (!dirty) return;
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      event.preventDefault();
      Alert.alert(
        t('Ulagrede endringer', 'Unsaved changes'),
        t(
          'Endringene i ruta er ikke lagret. Vil du forkaste dem?',
          'Your changes to this route have not been saved. Discard them?',
        ),
        [
          { text: t('Bli her', 'Stay'), style: 'cancel' },
          {
            text: t('Forkast', 'Discard'),
            style: 'destructive',
            // Re-dispatching the action the guard just blocked is how React
            // Navigation's documented escape hatch works — the listener is
            // still attached, but `dirty` is what it keys on and the screen is
            // going away regardless.
            onPress: () => navigation.dispatch(event.data.action),
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation, dirty, t]);

  // After every hook, never before.
  if (state.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{state.message}</Text>
        <Pressable
          onPress={retry}
          style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>{t('Prøv igjen', 'Try again')}</Text>
        </Pressable>
      </View>
    );
  }

  const stats = elevation.profile?.stats ?? null;

  // Both tools need something to act on, and undo needs somewhere to step back
  // to. Computed from the working copy rather than the loaded one, so clearing
  // a route dims erase and clear immediately instead of after a save.
  const hasRoute = (route?.length ?? 0) > 0;
  const editing = mode !== 'idle';

  // The one line a shut sheet shows, in the web's own order — distance, then
  // ascent, then descent (App.tsx's `sheetPeek`).
  //
  // With two additions the web does not need. The first is the saved figures as
  // a fallback while the profile computes: a route that came from the API has
  // `distanceM` and `ascentM` already on it, so a strip that said "calculating"
  // would be withholding numbers it is holding. They are replaced, not
  // corrected, when the profile lands — same quantities, measured at 20 m
  // resampling instead of at save time.
  //
  // The second is the last line, which only a blank planner ever reaches: an
  // empty map with an empty strip under it says nothing about what to do next,
  // and this is the one screen in the app where the first move is not obvious.
  const savedFigures = [
    formatDistance(savedMeta?.distanceM ?? null),
    formatAscent(savedMeta?.ascentM ?? null),
  ]
    .filter((part) => part !== '—')
    .join('  ·  ');

  const peek = stats
    ? `${formatDistance(stats.distance)}  ·  ${formatAscent(stats.ascent)} ${t('stigning', 'ascent')}  ·  ${formatAscent(stats.descent)} ${t('fall', 'descent')}`
    : savedFigures ||
      (elevation.loading
        ? t('Beregner rutestatistikk …', 'Calculating route stats…')
        : hasRoute
          ? t('Rutedetaljer', 'Route details')
          : t('Tegn en rute for å komme i gang', 'Draw a route to get started'));

  // WHEN THE SAVE CONTROL EXISTS. `dirty` is the substance of it — there has to
  // be something the server does not have. The second half only bites on a blank
  // planner: an unsaved route with no line drawn on it has nothing to name, so
  // offering Save would open a dialog that would create an empty route. An
  // existing route erased down to nothing keeps its Save, because the user has
  // to be able to commit that, and because a `dirty` screen with no way to
  // resolve it is a screen that can only be left through the discard warning.
  const canSave = dirty && (savedMeta !== null || hasRoute);

  return (
    <View style={styles.flex} onLayout={onMapLayout}>
      <MapLibreMap
        ref={mapRef}
        style={styles.flex}
        mapStyle={EMPTY_STYLE}
        // Our own attribution is rendered below, because the layers come from
        // children rather than from a style document — MapLibre's built-in
        // attribution control has nothing to read.
        attribution={false}
        logo={false}
        compass
        // THE MAP'S OWN ONE-FINGER PAN GOES OFF WHILE A TOOL IS IN HAND. The
        // drawing surface claims single-finger touches before the map sees
        // them, so this is belt and braces — but it is the braces that make
        // DrawingSurface's frozen-camera assumption true: with pan disabled,
        // one finger cannot move the view mid-stroke, so the projection a
        // stroke started against is still the projection it ends against.
        // Two-finger zoom and rotate stay on deliberately; the eraser's radius
        // is measured in screen pixels, so zooming is how its size is chosen.
        dragPan={!editing}
        // Pitch is off always, not just while editing. core's viewport is a
        // plain Web Mercator projection with no camera model behind it — see
        // its header — so a tilted map would place every drawn point somewhere
        // the user did not touch. Better to not offer the tilt than to draw
        // wrong lines on it.
        touchPitch={false}
        // Three feeds into one camera ref, because none of them is sufficient
        // alone: `isChanging` tracks a gesture in flight, `didChange` catches
        // the settled value after an animation, and the load callbacks are the
        // only way to learn where `initialViewState` actually put the camera on
        // a route that is drawn on before it is ever panned.
        onRegionIsChanging={rememberCamera}
        onRegionDidChange={rememberCamera}
        onDidFinishLoadingMap={handleMapLoaded}
        onDidFinishRenderingMapFully={seedCamera}
      >
        <Camera ref={cameraCtl} initialViewState={initialViewState} />

        <RasterSource
          id="topo"
          tiles={[TOPO_TEMPLATE]}
          // 256, explicitly: v11 defaults tileSize to 512, and Kartverket's
          // WMTS serves 256px tiles. Leaving the default makes every label and
          // contour render at half its intended size — the map looks like it
          // is zoomed one level out and the text is unreadable.
          tileSize={256}
          // Requests past this 404 at Kartverket. Naming it lets MapLibre
          // upsample the z18 tile for deeper zooms instead, which is the same
          // behaviour the web map's maxNativeZoom produces.
          maxzoom={TOPO.maxNativeZoom}
          attribution={TOPO_ATTRIBUTION}
        >
          <Layer
            id="topo-layer"
            type="raster"
            source="topo"
            paint={{ 'raster-opacity': 1 }}
          />
        </RasterSource>

        {showSteepness && (
          <RasterSource
            id="steepness"
            tiles={[STEEPNESS_TEMPLATE]}
            tileSize={256}
            maxzoom={STEEPNESS.maxNativeZoom}
            attribution={STEEPNESS_ATTRIBUTION}
          >
            <Layer
              id="steepness-layer"
              type="raster"
              source="steepness"
              // Matches the web overlay: enough to read the slope shading,
              // little enough to keep contour lines and place names legible
              // underneath. The whole value of this layer is being able to see
              // both at once.
              paint={{ 'raster-opacity': 0.55 }}
            />
          </RasterSource>
        )}

        {geojson && (
          <GeoJSONSource id="route" data={geojson}>
            {/* Two layers, drawn in order: a wide light casing under a narrow
                coloured line. Without the casing the route disappears wherever
                it crosses steepness shading of a similar tone, which is
                precisely where you most need to see it. Every number is core's
                — see the import. */}
            <Layer
              id="route-casing"
              type="line"
              source="route"
              paint={{
                'line-color': HALO_COLOR,
                'line-width': HALO_WEIGHT,
                'line-opacity': HALO_OPACITY,
              }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
            <Layer
              id="route-line"
              type="line"
              source="route"
              paint={{ 'line-color': ROUTE_COLOR, 'line-width': ROUTE_WEIGHT }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </GeoJSONSource>
        )}

        {liveGeojson && (
          // The stroke under the finger, above the saved line so it is visible
          // where it crosses one. No casing: the halo exists to lift the route
          // off the steepness shading, and this line is only on screen for the
          // second or two the finger is down — a translucent line with an
          // opaque halo around it would also read as more permanent than it is,
          // which is the opposite of what the translucency is saying.
          <GeoJSONSource id="live" data={liveGeojson}>
            <Layer
              id="live-line"
              type="line"
              source="live"
              paint={{
                'line-color': ROUTE_COLOR,
                'line-width': ROUTE_WEIGHT,
                'line-opacity': LIVE_OPACITY,
              }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </GeoJSONSource>
        )}

        {/* v11 has no `visible` prop — rendering the component IS the visible
            state, which is why this is behind the permission flag rather than
            always present. `accuracy` draws the uncertainty circle and
            `heading` the direction arrow; both are worth having on a mountain,
            where a 30 m circle is the difference between "on the ridge" and
            "on the cornice". */}
        {locationGranted && <UserLocation animated accuracy heading />}
      </MapLibreMap>

      {/* THE GESTURE OVERLAY, and the condition in front of it is the whole
          safety argument. An invisible view that swallows every touch is
          exactly how a map stops panning for no visible reason, so it exists
          only while a tool is in hand — and while one is, the toolbar's
          collapsed button wears that tool's icon, so there is always something
          on screen saying why the map behaves differently.

          It sits above the map and below the chrome, so a tap on the toolbar
          or the sheet still reaches them. */}
      {editing && (
        <DrawingSurface
          mode={mode === 'erase' ? 'erase' : 'draw'}
          getViewport={getViewport}
          onDrawLive={setLive}
          onDrawCommit={handleDrawCommit}
          onErase={handleErase}
          onEraseCommit={handleEraseCommit}
        />
      )}

      <EditToolbar
        mode={mode}
        onModeChange={setMode}
        hasRoute={hasRoute}
        canUndo={history.length > 0}
        onUndo={undo}
        onClear={clearAll}
        open={toolbarOpen}
        onOpenChange={setToolbarOpen}
        // Under the steepness pill, not beside it: the web stacks its toolbar
        // vertically at the top-left and this is the same column, one row down
        // so the two do not overlap.
        style={{ top: space.s4 + PILL_HEIGHT + space.s2 }}
      />

      <View style={styles.topControls} pointerEvents="box-none">
        <Pressable
          onPress={() => setShowSteepness((on) => !on)}
          style={({ pressed }) => [
            styles.toggle,
            showSteepness && styles.toggleOn,
            pressed && styles.togglePressed,
          ]}
          accessibilityRole="switch"
          accessibilityState={{ checked: showSteepness }}
          // The label comes from the descriptor, so it is the same wording as
          // the web app's layer list and follows the active language.
          accessibilityLabel={STEEPNESS.label()}
        >
          <Text style={[styles.toggleText, showSteepness && styles.toggleTextOn]}>
            {t('Bratthet', 'Steepness')}
          </Text>
        </Pressable>
      </View>

      {/* Attribution, parked just above the sheet's peek strip — the position
          App.module.css gives the web's map chrome by reading the same
          `--sheet-peek` the sheet sets. It does not rise with the sheet: the
          credit belongs to the map, and a credit that slides up over its own
          map to sit on a panel is crediting the panel. */}
      <View
        style={[
          styles.attributionBar,
          { bottom: SHEET_PEEK + insets.bottom + space.s1 },
        ]}
        pointerEvents="none"
      >
        <Text style={styles.attribution}>
          {/* The NVE half only appears while its layer is on — crediting a
              source whose tiles are not on screen is noise, and the point of
              the credit is to say what you are looking at. */}
          {showSteepness
            ? `${TOPO_ATTRIBUTION} · ${STEEPNESS_ATTRIBUTION}`
            : TOPO_ATTRIBUTION}
        </Text>
      </View>

      {/* THE SAVE CONTROL EXISTS ONLY WHILE THERE IS SOMETHING TO SAVE. A
          permanently visible Save that is disabled nine times out of ten is a
          worse answer here than on the web: this button floats over the map it
          is asking about, so an inert one costs ground for nothing.

          Bottom-LEFT, opposite the attribution and clear of the compass the
          map draws top-right, and lifted over the sheet's peek strip by the
          same sum the attribution uses. */}
      {canSave && (
        <View
          style={[styles.saveBar, { bottom: SHEET_PEEK + insets.bottom + space.s4 }]}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={() => setSaveOpen(true)}
            // Held back while the profile computes, because the save writes
            // the profile's own figures — see `handleSave`. A moment's wait
            // puts measured statistics on the route; not waiting would write
            // nulls and quietly blank the distance on the list screen.
            disabled={elevation.loading}
            style={({ pressed }) => [
              styles.save,
              pressed && styles.savePressed,
              elevation.loading && styles.saveDisabled,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: elevation.loading }}
          >
            <Text style={styles.saveText}>
              {elevation.loading
                ? t('Beregner …', 'Calculating…')
                : savedMeta
                  ? t('Lagre endringer', 'Save changes')
                  : t('Lagre rute', 'Save route')}
            </Text>
          </Pressable>
        </View>
      )}

      {/* The web's saved-route toast, in the web's words and for the web's four
          seconds. It earns its place on a phone more than on a laptop: there is
          no library list visible beside the map to show the new row appearing,
          so without this the only evidence a save worked is a button
          disappearing.

          Tapping it anywhere dismisses it, which is why there is no × — the
          whole bar is a 44-point-tall target, and a 28-point glyph beside it
          would be a smaller way to do the same thing. */}
      {savedToast && (
        <View
          style={[styles.toastBar, { bottom: SHEET_PEEK + insets.bottom + space.s8 }]}
          pointerEvents="box-none"
        >
          <Pressable
            style={styles.toast}
            onPress={dismissToast}
            accessibilityRole="button"
            accessibilityLabel={t('Lukk', 'Dismiss')}
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.toastText} numberOfLines={2}>
              {t(
                'Ruta er lagret i biblioteket ditt',
                'Route saved to your library',
              )}
            </Text>
            <Pressable
              onPress={() => {
                dismissToast();
                router.push('/saved');
              }}
              style={styles.toastAction}
              accessibilityRole="button"
            >
              <Text style={styles.toastActionText}>
                {t('Gå til bibliotek', 'Go to library')}
              </Text>
            </Pressable>
          </Pressable>
        </View>
      )}

      <SummarySheet peek={peek}>
        <SheetCard
          title={t('Høydeprofil', 'Elevation profile')}
          // The chart draws its own axis labels flush to its own edges, so a
          // card padding under it would be a second, uneven margin.
          padded={false}
        >
          <View style={styles.profileBox}>
            {elevation.profile ? (
              <ElevationProfile
                profile={elevation.profile}
                // The map's toggle, not a second one. See ElevationProfile's
                // `steepness` prop for why the phone has one switch where the
                // web has two.
                steepness={showSteepness}
              />
            ) : elevation.loading ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.cardNote}>
                {elevation.error ??
                  (hasRoute
                    ? t(
                        'Høydeprofil utilgjengelig for denne ruta.',
                        'Elevation profile unavailable for this route.',
                      )
                    : t(
                        'Tegn en rute på kartet for å se høydeprofilen.',
                        'Draw a route on the map to see its elevation profile.',
                      ))}
              </Text>
            )}
          </View>
        </SheetCard>

        <SheetCard title={t('Rutedetaljer', 'Route details')}>
          <Stat
            label={t('Lengde', 'Distance')}
            value={formatDistance(
              stats ? stats.distance : (savedMeta?.distanceM ?? null),
            )}
          />
          <Stat
            label={t('Stigning', 'Ascent')}
            value={formatAscent(
              stats ? stats.ascent : (savedMeta?.ascentM ?? null),
            )}
          />
          <Stat
            label={t('Fall', 'Descent')}
            value={formatAscent(
              stats ? stats.descent : (savedMeta?.descentM ?? null),
            )}
          />
          <Stat
            label={t('Høyeste punkt', 'Highest point')}
            value={stats ? `${stats.maxElevation} m` : '—'}
          />
          <Stat
            label={t('Laveste punkt', 'Lowest point')}
            value={stats ? `${stats.minElevation} m` : '—'}
          />
        </SheetCard>

        {/* THE THREE DATA CARDS, and the condition in front of them is load
            bearing rather than defensive. All three need `elevation.profile`:
            the forecast is taken at the route's lowest and highest points, the
            snow depths are one seNorge lookup per profile point, and the
            avalanche regions are sampled along it. Rendering them against a
            null profile would not merely show empty cards — it would start no
            requests and then start all three at once the moment the profile
            landed, which is the flash of three spinners the web avoids by
            gating its own panels the same way.

            THE ORDER IS THE WEB'S, top to bottom: weather, then snow, then
            avalanche. It is also the order in which a tour is decided — is it
            worth going, is there anything to ski, is it safe — and it puts the
            card with the highest stakes at the end, where it is what the user
            was last reading. */}
        {elevation.profile && (
          <>
            <SheetCard title={t('Værvarsel', 'Weather forecast')}>
              <WeatherCard profile={elevation.profile} />
            </SheetCard>

            <SheetCard title={t('Snødybde', 'Snow depth')}>
              <SnowCard profile={elevation.profile} />
            </SheetCard>

            <SheetCard title={t('Skredfare', 'Avalanche danger')}>
              <AvalancheCard profile={elevation.profile} />
            </SheetCard>
          </>
        )}
      </SummarySheet>

      {/* The web's dialog, with the web's props. It opens for an update as well
          as for a create — which is a change from the phone's old one-tap save,
          and the right one: it is the only way to rename a route from the
          phone, and it puts the figures being written in front of the user at
          the moment they are written. */}
      {saveOpen && (
        <SaveRouteDialog
          initialName={savedMeta?.name}
          initialDescription={savedMeta?.description ?? ''}
          isUpdate={savedMeta !== null}
          statsLabel={
            stats
              ? `${formatDistance(stats.distance)} · ${formatAscent(stats.ascent)} ${t('stigning', 'ascent')}`
              : null
          }
          onSave={handleSave}
          onClose={() => setSaveOpen(false)}
        />
      )}
    </View>
  );
}

/** One label-and-figure row. The figure is tabular so a column of them lines
 *  up on the decimal point rather than wandering with the digit widths. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.s6,
    gap: space.s4,
    backgroundColor: colors.background,
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  retry: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: space.s6,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
  },
  retryPressed: { backgroundColor: colors.accentPressed },
  retryText: {
    color: colors.accentContrast,
    fontSize: fontSize.base,
    fontWeight: '600',
  },

  topControls: {
    position: 'absolute',
    top: space.s4,
    left: space.s4,
    flexDirection: 'row',
    gap: space.s2,
  },
  toggle: {
    minHeight: TOUCH_TARGET - 8,
    justifyContent: 'center',
    paddingHorizontal: space.s4,
    backgroundColor: colors.glass,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    // Without a shadow the pill vanishes against pale snow on the topo map.
    // `shadow.level2` is the web's --shadow-2, and this pill is the same kind
    // of floating chrome that token was tuned for.
    ...shadow.level2,
  },
  togglePressed: { opacity: 0.8 },
  toggleOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  toggleText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  toggleTextOn: { color: colors.accentContrast },

  attributionBar: {
    position: 'absolute',
    right: space.s2,
    // `bottom` is supplied at the call site, because it depends on the safe
    // area inset and StyleSheet.create cannot see a hook.
  },
  attribution: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    backgroundColor: colors.glass,
    borderRadius: radius.sm,
    paddingHorizontal: space.s1,
    // Text over a map is unreadable without something behind it. The pill is
    // the smallest thing that fixes it and the smallest thing that hides map.
    overflow: 'hidden',
  },

  saveBar: {
    position: 'absolute',
    left: space.s4,
    maxWidth: '70%',
    alignItems: 'flex-start',
    // `bottom` is supplied at the call site — it depends on the safe area
    // inset, and StyleSheet.create cannot see a hook.
  },
  save: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: space.s6,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    // Filled and shadowed, unlike the glass pills around it. This is the one
    // control on the screen that changes what the server holds, and it should
    // not look like the steepness toggle.
    ...shadow.level2,
  },
  savePressed: { backgroundColor: colors.accentPressed },
  saveDisabled: { opacity: 0.6 },
  saveText: {
    color: colors.accentContrast,
    fontSize: fontSize.base,
    fontWeight: '600',
  },

  toastBar: {
    position: 'absolute',
    left: space.s4,
    right: space.s4,
    alignItems: 'center',
    // `bottom` at the call site, for the safe area inset.
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    minHeight: TOUCH_TARGET,
    paddingLeft: space.s4,
    paddingRight: space.s2,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radius.pill,
    // `float`, not `level2`: this is the topmost thing on the screen for four
    // seconds, and the web gives its toast --shadow-float for the same reason.
    ...shadow.float,
  },
  toastText: {
    flexShrink: 1,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  toastAction: {
    justifyContent: 'center',
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
  },
  toastActionText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.accentPressed,
  },

  profileBox: {
    padding: space.s3,
    minHeight: 120,
    justifyContent: 'center',
  },
  cardNote: { fontSize: fontSize.sm, color: colors.textMuted },

  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 3,
  },
  statLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  statValue: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
});
