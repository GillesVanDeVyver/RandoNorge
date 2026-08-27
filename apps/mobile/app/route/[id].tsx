// Phase 3: one saved route, drawn on the Kartverket topo map, with the NVE
// steepness overlay and the live position marker.
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
// WHAT IS DELIBERATELY ABSENT: drawing, editing, recording, offline caching.
// This screen reads. The plan puts all four in later phases, and each of them
// needs a decision this phase does not have to make (a gesture model, a
// background task, a tile store).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useT } from '@fjellrute/core/i18n';
import { getRoute, routeToFeature, type SavedRoute } from '@fjellrute/core/routes/api';
import { formatAscent, formatDistance } from '@fjellrute/core/routes/format';
import { OFFLINE_LAYERS, tileUrlTemplate } from '@fjellrute/core/offline/layers';
import type { Route } from '@fjellrute/core/types';
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
 * Declared once and used twice — on the source, and in the bar at the bottom of
 * the screen. Two uses because they answer different questions. The bar is what
 * a user actually sees, since MapLibre's own attribution control is disabled
 * (it reads a style document, and this map has none). The `attribution` prop on
 * the source is metadata that travels with the source, so anything that later
 * enumerates the map's credits — the built-in control if it is ever turned on,
 * a static-map export — finds them already attached rather than needing this
 * list restated. Not localized: an organisation's name is its name.
 */
const TOPO_ATTRIBUTION = '© Kartverket';
const STEEPNESS_ATTRIBUTION = '© NVE';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; route: SavedRoute }
  | { status: 'error'; message: string };

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
  const t = useT();

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [showSteepness, setShowSteepness] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);

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

  const geojson = useMemo(() => {
    if (state.status !== 'ready') return null;
    // Exactly the shape the API stores and the web app draws: one
    // MultiLineString whose members are the drawn segments, so eraser gaps stay
    // gaps instead of being joined by a straight line across the mountain.
    return routeToFeature(state.route.route, null);
  }, [state]);

  const bounds = useMemo(
    () => (state.status === 'ready' ? boundsOf(state.route.route) : null),
    [state],
  );

  // After every hook, never before: an early return above them would change the
  // number of hooks this component calls between renders.
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

  return (
    <View style={styles.flex}>
      <MapLibreMap
        style={styles.flex}
        mapStyle={EMPTY_STYLE}
        // Our own attribution is rendered below, because the layers come from
        // children rather than from a style document — MapLibre's built-in
        // attribution control has nothing to read.
        attribution={false}
        logo={false}
        compass
      >
        {bounds && (
          // initialViewState, not the controlled `bounds` prop: this frames the
          // route once, when the map first loads, and then leaves the camera
          // alone. The controlled form would snap the view back to the whole
          // route on every re-render — including a locale change or the
          // steepness toggle — undoing whatever the user had panned to.
          <Camera
            initialViewState={{
              bounds,
              // Room for the toggle pill at the top and the stats bar at the
              // bottom, so a route that reaches the edge of its own bounding
              // box does not sit underneath them. ViewPadding is the CSS-ish
              // {top,right,bottom,left}, not React Native's paddingTop names.
              padding: { top: 64, right: 32, bottom: 88, left: 32 },
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
                precisely where you most need to see it.

                THE FOUR NUMBERS HERE ARE apps/web/src/routeStyle.ts's, and they
                have to be: a route drawn 3.5 wide on the phone and 4 wide on the
                laptop is the same route looking like two different lines, which
                is exactly the drift the shared package exists to prevent. Three
                of them already agreed by luck — HALO_COLOR '#ffffff',
                HALO_WEIGHT (ROUTE_WEIGHT + 3 = 7) and HALO_OPACITY 0.9 — and
                ROUTE_WEIGHT did not, so the line below was 3.5 against the web's
                4. They are still literals rather than imports because
                routeStyle.ts lives in apps/web and this file may not reach into
                another app; moving it into packages/core is the correct fix and
                is Phase 2's, where the profile needs those constants anyway. */}
            <Layer
              id="route-casing"
              type="line"
              source="route"
              paint={{
                'line-color': '#ffffff',
                'line-width': 7,
                'line-opacity': 0.9,
              }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
            <Layer
              id="route-line"
              type="line"
              source="route"
              // `colors.route`, not `colors.accent`. The same value today, and
              // the name says which of the two this call site means.
              paint={{ 'line-color': colors.route, 'line-width': 4 }}
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

      <View style={styles.bottomBar} pointerEvents="none">
        <Text style={styles.stats}>
          {[formatDistance(state.route.distanceM), formatAscent(state.route.ascentM)]
            .filter((part) => part !== '—')
            .join('  ·  ')}
        </Text>
        <Text style={styles.attribution}>
          {/* The NVE half only appears while its layer is on — crediting a
              source whose tiles are not on screen is noise, and the point of
              the credit is to say what you are looking at. */}
          {showSteepness
            ? `${TOPO_ATTRIBUTION} · ${STEEPNESS_ATTRIBUTION}`
            : TOPO_ATTRIBUTION}
        </Text>
      </View>
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

  bottomBar: {
    position: 'absolute',
    left: space.s4,
    right: space.s4,
    bottom: space.s4,
    padding: space.s2,
    borderRadius: radius.md,
    backgroundColor: colors.glass,
    gap: 2,
  },
  stats: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  attribution: { fontSize: fontSize.xs, color: colors.textMuted },
});
