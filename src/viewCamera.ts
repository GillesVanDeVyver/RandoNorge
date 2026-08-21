// The camera the planner is looking through, passed between the flat map and
// the terrain view when the 2D/3D switch is flipped.
//
// The two views are different engines — Leaflet for 2D, MapLibre for 3D — so
// flipping the switch tears one map down and builds the other. Left to itself
// the new map opens on its own idea of where to start (the whole of Norway, or
// a fit to the route), which throws away the place the user had just found.
// The switch is not a navigation: it is a change of angle on the same ground,
// and it should read as one.
//
// So the outgoing map states where it is standing, the incoming map opens
// there, and the only thing that actually moves is the tilt. 2D is the same
// view with the camera straight down.
//
// Only the standpoint travels — centre and zoom. Pitch and bearing are not
// carried because they are not shared: Leaflet cannot tilt or rotate, so the
// flat map is always a north-up top view, and the terrain view's own angle is
// TERRAIN_PITCH (terrainView.ts). Those two are the ends of the animation
// rather than state to hand over.
//
// A module rather than a prop from App because the standpoint changes on every
// pan and nothing renders from it. Threading it through React would either
// re-render the whole planner on each frame of a drag or mean reading a ref
// during render; this is external state and is kept where external state goes.

/** Where a map is standing, in the terms both engines can be pointed at. */
export interface ViewCamera {
  /** [lng, lat] — MapLibre's order, since it is the fussier of the two. */
  center: [number, number];
  /** MapLibre's zoom scale, i.e. the 512 px-tile convention. */
  zoom: number;
}

// Where the map on screen is standing, and — separately — the standpoint a
// switch has offered to the map that is about to be built.
//
// Two slots rather than one because a map is built for reasons other than the
// switch: opening the planner, or coming back to it from the route library.
// Those should frame the route the way they always have. Only an explicit
// arm() gives the next map a standpoint to open on, so "somewhere the user was
// once" can never quietly become "where the planner opens".
let standing: ViewCamera | null = null;
let offered: ViewCamera | null = null;

/** The live map, reporting where it is. Called as the camera comes to rest. */
export function reportViewCamera(camera: ViewCamera): void {
  standing = camera;
}

/** Flipping the switch: whichever map is built next opens where this one is. */
export function armViewHandoff(): void {
  offered = standing;
}

/** No switch is in progress — the planner is leaving, or has just arrived. */
export function disarmViewHandoff(): void {
  offered = null;
}

/**
 * The standpoint a map should open on, or null to use its own framing.
 *
 * Read, not consumed: React mounts components twice in development, and a
 * hand-over that the first mount swallowed would leave the second one opening
 * on the whole of Norway — a bug visible only in dev, which is the worst place
 * for one. It is cleared by disarmViewHandoff() instead, when the planner
 * itself goes away.
 */
export function offeredViewCamera(): ViewCamera | null {
  return offered;
}

// Leaflet counts zoom in 256 px tiles and MapLibre in 512 px ones, so the same
// ground scale is one whole level apart. Getting this wrong is not subtle — the
// map would double or halve on every flip — but it is easy to get wrong, so it
// is written down once here rather than at each call site.

/** A MapLibre zoom at the Leaflet level that draws the same ground scale. */
export function toLeafletZoom(zoom: number): number {
  return zoom + 1;
}

/** A Leaflet zoom at the MapLibre level that draws the same ground scale. */
export function toMapLibreZoom(zoom: number): number {
  return zoom - 1;
}

/**
 * How long the camera takes to tilt between the flat view and the terrain
 * view's angle.
 *
 * Long enough to read as the ground turning rather than as a cut, short enough
 * that someone flicking between the two to compare a slope is not kept waiting.
 * The same number is used in both directions, so the switch feels symmetrical.
 */
export const VIEW_TILT_MS = 700;
