// One saved route as a full-screen planner: the Kartverket topo map edge to
// edge, the NVE steepness overlay, the live position marker, and everything the
// map cannot say in a bottom sheet over it.
//
// PHASE 2 OF docs/mobile-web-parity-plan.md turned this from a map with a
// caption into the phone's half of the web planner. The plan's words were
// "MapLibre full-bleed, floating chrome over it in the web's positions
// (toolbar top-left, summary as a bottom sheet)", and that is the layout now:
// the steepness pill is top-left where the web's layer toolbar is, the
// attribution floats just clear of the sheet exactly as App.module.css keeps
// the web's map chrome clear of `--sheet-peek`, and the old fixed stats bar has
// become the sheet's peek line.
//
// WHAT STAYED THE SAME ON PURPOSE: the navigation header. A planner with no
// header would be more full-bleed and would also be a screen with no way back
// and no route name on it. The web has its own header above the map for the
// same two jobs.
//
// WHY A HAND-BUILT STYLE INSTEAD OF A STYLE URL. MapLibre normally loads a
// style document from a URL, and that document names the sources. Here the
// sources are already described — in @fjellrute/core/offline/layers, where the
// same descriptors drive the offline downloader and the web app's live layers.
// Pointing at a style URL would mean a second, independent statement of the
// same tile URLs, and the two would drift the first time Kartverket changes a
// path. So the map starts from an EMPTY style and the layers are added as
// children, built from those descriptors via core's `tileUrlTemplate`.
//
// LAYER ORDER IS CHILD ORDER. Topo, then steepness on top of it, then the route
// line on top of both, then the position marker. Reordering the JSX reorders
// the map, which is why the route line is last rather than grouped with the
// rasters.
//
// PHASE 4 THEN MADE IT WRITEABLE. The plan held drawing back until "Phase 2's
// sheet exists; it has nowhere to put its controls otherwise", and the sheet
// does, so the pencil and the eraser arrive here rather than in a new screen:
// this is already the phone's planner, and a second one would be a second copy
// of the map, the layers and the profile.
//
// THE THREE PIECES PHASE 4 ADDED, and why each is where it is. The gestures are
// in src/ui/DrawingSurface — a transparent overlay, because MapLibre's own press
// events fire on tap and drawing needs the whole drag. The maths is in
// @fjellrute/core/draw/tools, shared with both of the web's maps, because the
// plan's warning is that "the same drag produces different routes on the two
// clients" otherwise. And the projection is core's too
// (@fjellrute/core/geometry/viewport), because MapLibre React Native's own
// project/unproject return Promises and a stroke cannot wait for the bridge.
//
// WHAT IS STILL DELIBERATELY ABSENT: straight-line drawing with draggable
// vertices, recording, offline caching, import/export, the printed briefing.
// The first is its own gesture problem; the rest are Phase 5 and beyond, each
// needing a decision this screen does not have to make (a background task, a
// tile store, a native file picker, a native PDF).

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
import { useLocalSearchParams, useNavigation } from 'expo-router';
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
// hyphenated property names, split into `paint` and `layout` exactly as the
// spec splits them, instead of a camelCased dialect of its own. `style` still
// exists on Layer but warns and is removed in v12, so it is not used here.
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
  type MapRef,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useT } from '@fjellrute/core/i18n';
import {
  getRoute,
  routeToFeature,
  updateRoute,
  type SavedRoute,
} from '@fjellrute/core/routes/api';
import { formatAscent, formatDistance } from '@fjellrute/core/routes/format';
import { useProfile } from '@fjellrute/core/elevation/useProfile';
import { OFFLINE_LAYERS, tileUrlTemplate } from '@fjellrute/core/offline/layers';
// The route's colour and the two line widths, from core rather than from four
// literals in this file. They were literals until Phase 2, under a comment
// asking for exactly this move; the file they now come from is the one apps/web
// draws its own route with, so a route is the same line on both clients by
// construction rather than by everyone remembering.
import {
  HALO_COLOR,
  HALO_OPACITY,
  HALO_WEIGHT,
  ROUTE_COLOR,
  ROUTE_WEIGHT,
} from '@fjellrute/core/routes/style';
// Phase 4's shared halves. `eraseDisk` and ERASER_RADIUS_PX are the same
// eraser apps/web runs — see the module header for why one copy rather than
// three — and `createViewport` is the synchronous projection it needs, which on
// this platform has to be computed rather than asked for.
import { ERASER_RADIUS_PX, eraseDisk } from '@fjellrute/core/draw/tools';
import {
  createViewport,
  type Viewport,
} from '@fjellrute/core/geometry/viewport';
import type { LatLng, Mode, Route, Segment } from '@fjellrute/core/types';
import { DrawingSurface } from '../../src/ui/DrawingSurface';
import { EditToolbar } from '../../src/ui/EditToolbar';
import { ElevationProfile } from '../../src/ui/ElevationProfile';
import { SheetCard, SHEET_PEEK, SummarySheet } from '../../src/ui/SummarySheet';
// Phase 3's three data cards. Each is a core hook plus a React Native view —
// see their own headers — and each takes the computed profile, which is why
// none of them can appear before the elevation pass has finished: the forecast
// is anchored to the route's lowest and highest points, the snow depths are
// fetched per profile point, and the avalanche regions are sampled along it.
import { WeatherCard } from '../../src/ui/WeatherCard';
import { SnowCard } from '../../src/ui/SnowCard';
import { AvalancheCard } from '../../src/ui/AvalancheCard';
import {
  colors,
  fontSize,
  radius,
  shadow,
  space,
  TOUCH_TARGET,
} from '../../src/ui/theme';

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
 * the sheet. Two uses because they answer different questions. The floating
 * line is what a user actually sees, since MapLibre's own attribution control
 * is disabled (it reads a style document, and this map has none). The
 * `attribution` prop on the source is metadata that travels with the source, so
 * anything that later enumerates the map's credits — the built-in control if it
 * is ever turned on, a static-map export — finds them already attached rather
 * than needing this list restated. Not localized: an organisation's name is its
 * name.
 */
const TOPO_ATTRIBUTION = '© Kartverket';
const STEEPNESS_ATTRIBUTION = '© NVE';

/**
 * Camera padding, so a route that reaches the edge of its own bounding box is
 * not framed underneath the chrome that floats over it.
 *
 * The bottom number is `SHEET_PEEK` plus a gap rather than the 88 that used to
 * be typed here. Identical today, and it stops being identical the moment the
 * sheet's height changes — which is precisely the kind of second copy the web
 * avoids by having App.module.css read the same `--sheet-peek` the panel sets.
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
 * line is not yet part of the route, which matters most at the moment it
 * crosses a line that is.
 */
const LIVE_OPACITY = 0.7;

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; route: SavedRoute }
  | { status: 'error'; message: string };

/**
 * An editing session: a working copy of one route, and the loaded array it was
 * derived from.
 *
 * `source` is what makes the session self-invalidating. It is the array the
 * loader produced, so `source === state.route.route` is the question "does this
 * session still belong to what is on screen", answered by identity rather than
 * by an effect that clears things.
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
 *  the route id they were chosen for. See the state's declaration. */
interface ToolState {
  id: string;
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

export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const t = useT();

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [showSteepness, setShowSteepness] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);

  // ---- Editing state (Phase 4) ---------------------------------------------
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
  // The tool in hand, keyed on the route id for the same reason and by the same
  // means as the session above: a pencil still in hand after the screen is
  // pointed at a different route is a map that does not pan and no longer says
  // why, and keying the state resets it without an effect. Mode and openness
  // share one object because they are set together as often as separately.
  const [tool, setTool] = useState<ToolState>({
    id,
    mode: 'idle',
    open: false,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // RETURNS the next state rather than setting it — same shape as the list
  // screen, and for the same two reasons: the effect and the retry button want
  // different things on screen while the request is in flight, and a fetch that
  // sets state itself cannot be called from an effect without being able to
  // land on a screen the user has already navigated away from. Here the effect
  // owns that decision and can drop a late reply.
  //
  // A missing id is NOT handled here. It is not a load failure and it cannot be
  // retried — it is a property of the route params, so it is rendered directly
  // below rather than laundered through state that could only ever hold one
  // value.
  const fetchRoute = useCallback(async (): Promise<LoadState | null> => {
    if (!id) return null;
    try {
      return { status: 'ready', route: await getRoute(id) };
    } catch (cause) {
      return {
        status: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }, [id]);

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
  const loaded = state.status === 'ready' ? state.route.route : null;
  const active = session && session.source === loaded ? session : null;
  const route = active?.route ?? loaded;
  const history = active?.history ?? NO_HISTORY;
  const mode = tool.id === id ? tool.mode : 'idle';
  const toolbarOpen = tool.id === id ? tool.open : false;

  // UPDATER FORM, and it has to be. `EditToolbar` picks a tool and folds the
  // row down in the same handler — two calls, one render — and a setter that
  // reassembled the object out of this render's `mode` and `toolbarOpen` would
  // have the second call write back the tool the first one just replaced. The
  // `current.id === id` guard inside each is the same reset the derivation
  // above performs, applied to the value being carried through rather than to
  // the one being set.
  const setMode = (next: Mode) =>
    setTool((current) => ({
      id,
      mode: next,
      open: current.id === id && current.open,
    }));
  const setToolbarOpen = (open: boolean) =>
    setTool((current) => ({
      id,
      mode: current.id === id ? current.mode : 'idle',
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
      const { center, zoom, bearing } = event.nativeEvent;
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

  // The header title is the route's name, so it can only be set once the route
  // has loaded. Set here rather than via Stack.Screen options so there is no
  // flash of the id.
  useEffect(() => {
    if (state.status === 'ready') {
      navigation.setOptions({ title: state.route.name });
    }
  }, [navigation, state]);

  // Foreground location, asked for at the moment the map appears rather than at
  // launch: a permission prompt the user can connect to something they can see
  // is far more likely to be granted. Denial is not an error — the map is fully
  // usable without a position marker — so it is recorded and never retried.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { granted } = await Location.requestForegroundPermissionsAsync();
        if (!cancelled) setLocationGranted(granted);
      } catch {
        if (!cancelled) setLocationGranted(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // WHAT THE MAP DRAWS: the eraser's preview if a finger is cutting, otherwise
  // the working copy. `preview ?? route`, in that order, is the whole of the
  // mid-drag illusion — the line disappears under the eraser in real time while
  // `route`, and therefore the profile and the cards, stay on the last
  // committed geometry until the finger lifts.
  const shown = preview ?? route;

  const geojson = useMemo(() => {
    if (!shown) return null;
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

  // Framing only, and only once — so this deliberately reads the LOADED route
  // rather than the working copy. Recomputing it from `route` would hand the
  // camera a new bounding box after every stroke; `initialViewState` ignores
  // later values, but the memo would still churn for nothing.
  const bounds = useMemo(
    () => (state.status === 'ready' ? boundsOf(state.route.route) : null),
    [state],
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

  const save = async () => {
    const current = route;
    if (!id || !current || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const stats = elevation.profile?.stats ?? null;
      const saved = await updateRoute(id, {
        route: current,
        // The freshly measured figures. Null only when the profile failed
        // outright — the save control is held back while it is still computing,
        // precisely so this is not the ordinary path. Writing nulls is still
        // the right answer for a failure: the alternative is keeping the
        // numbers the route arrived with, and those describe the line the user
        // just changed.
        stats: stats
          ? {
              distanceM: stats.distance,
              ascentM: stats.ascent,
              descentM: stats.descent,
            }
          : null,
        // THE FROZEN FORECAST IS CLEARED, not rewritten. A snapshot is anchored
        // to the geometry it was taken over — its weather is read at the
        // route's lowest and highest points, its avalanche regions are the ones
        // the line crossed — and after an edit some of that ground is no longer
        // on the route. Keeping it would show numbers for a tour that no longer
        // exists, which is worse than showing none: the cards fall back to live
        // data, which is what an unsaved route shows anyway. Capturing a fresh
        // snapshot is the right end state and needs the web's ForecastContext
        // plumbing, which this phase did not bring over.
        forecast: null,
      });
      // Re-state the load with the array the user is holding, not the one the
      // server just echoed back. Same geometry either way, but a new array
      // identity would send `useProfile` off to recompute several hundred
      // elevation samples for a route that did not change.
      setState({ status: 'ready', route: { ...saved, route: current } });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
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
  if (!id) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>
          {t('Mangler tur-id.', 'Missing route id.')}
        </Text>
      </View>
    );
  }

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

  // The one line a shut sheet shows, in the web's own order — distance, then
  // ascent, then descent (App.tsx's `sheetPeek`).
  //
  // With one addition the web does not need: the saved figures as a fallback
  // while the profile computes. The web is a planner, where a route being drawn
  // has no saved statistics to fall back on and the honest line really is
  // "calculating"; here the route came from the API with `distanceM` and
  // `ascentM` already on it, so a strip that said "calculating" would be
  // withholding numbers it is holding. They are replaced, not corrected, when
  // the profile lands — same quantities, measured at 20 m resampling instead of
  // at save time.
  const peek = stats
    ? `${formatDistance(stats.distance)}  ·  ${formatAscent(stats.ascent)} ${t('stigning', 'ascent')}  ·  ${formatAscent(stats.descent)} ${t('fall', 'descent')}`
    : [
        formatDistance(state.route.distanceM),
        formatAscent(state.route.ascentM),
      ]
        .filter((part) => part !== '—')
        .join('  ·  ') ||
      (elevation.loading
        ? t('Beregner rutestatistikk …', 'Calculating route stats…')
        : t('Rutedetaljer', 'Route details'));

  // Both tools need something to act on, and undo needs somewhere to step back
  // to. Computed from the working copy rather than the loaded one, so clearing
  // a route dims erase and clear immediately instead of after a save.
  const hasRoute = (route?.length ?? 0) > 0;
  const editing = mode !== 'idle';

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
        onDidFinishLoadingMap={seedCamera}
        onDidFinishRenderingMapFully={seedCamera}
      >
        {bounds && (
          // initialViewState, not the controlled `bounds` prop: this frames the
          // route once, when the map first loads, and then leaves the camera
          // alone. The controlled form would snap the view back to the whole
          // route on every re-render — including a locale change, the steepness
          // toggle, or the profile arriving — undoing whatever the user had
          // panned to.
          <Camera
            initialViewState={{
              bounds,
              // ViewPadding is the CSS-ish {top,right,bottom,left}, not React
              // Native's paddingTop names.
              padding: CAMERA_PADDING,
            }}
          />
        )}

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
          is asking about, so an inert one costs ground for nothing. `dirty` is
          a reference comparison, so undoing every edit makes it disappear
          again rather than leaving a button that would write back what the
          server already has.

          Bottom-LEFT, opposite the attribution and clear of the compass the
          map draws top-right, and lifted over the sheet's peek strip by the
          same sum the attribution uses. */}
      {dirty && (
        <View
          style={[
            styles.saveBar,
            { bottom: SHEET_PEEK + insets.bottom + space.s4 },
          ]}
          pointerEvents="box-none"
        >
          {saveError && (
            // The failure sits above the button rather than in an Alert: a
            // dialog would have to be dismissed before the user could press
            // Save again, and pressing Save again is the entire remedy for the
            // usual cause, which is a mountain with no signal.
            <Text style={styles.saveError} numberOfLines={2}>
              {saveError}
            </Text>
          )}
          <Pressable
            onPress={() => void save()}
            // Held back while the profile computes, because the save writes
            // the profile's own figures — see `save`. A moment's wait puts
            // measured statistics on the route; not waiting would write nulls
            // and quietly blank the distance on the list screen.
            disabled={saving || elevation.loading}
            style={({ pressed }) => [
              styles.save,
              pressed && styles.savePressed,
              (saving || elevation.loading) && styles.saveDisabled,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving || elevation.loading }}
            accessibilityLabel={t('Lagre endringer', 'Save changes')}
          >
            {saving ? (
              <ActivityIndicator color={colors.accentContrast} size="small" />
            ) : (
              <Text style={styles.saveText}>
                {elevation.loading
                  ? t('Beregner …', 'Calculating…')
                  : t('Lagre', 'Save')}
              </Text>
            )}
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
                  t(
                    'Høydeprofil utilgjengelig for denne ruta.',
                    'Elevation profile unavailable for this route.',
                  )}
              </Text>
            )}
          </View>
        </SheetCard>

        <SheetCard title={t('Rutedetaljer', 'Route details')}>
          <Stat
            label={t('Lengde', 'Distance')}
            value={formatDistance(stats ? stats.distance : state.route.distanceM)}
          />
          <Stat
            label={t('Stigning', 'Ascent')}
            value={formatAscent(stats ? stats.ascent : state.route.ascentM)}
          />
          <Stat
            label={t('Fall', 'Descent')}
            value={formatAscent(stats ? stats.descent : null)}
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
    // `shadow.level2` rather than the hand-rolled quartet that was here: it is
    // the web's --shadow-2, and this pill is the same kind of floating chrome
    // that token was tuned for. The Platform.select moved into theme.ts with it.
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
    // A cap rather than a width: the error line under the button can be a
    // sentence from a fetch failure, and without this it would stretch the
    // whole way across the map.
    maxWidth: '70%',
    alignItems: 'flex-start',
    gap: space.s1,
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
  saveError: {
    fontSize: fontSize.xs,
    color: colors.danger,
    backgroundColor: colors.glass,
    borderRadius: radius.sm,
    paddingHorizontal: space.s2,
    paddingVertical: 2,
    overflow: 'hidden',
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
