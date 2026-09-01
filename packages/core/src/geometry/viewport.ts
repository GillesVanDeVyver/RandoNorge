import type { LatLng } from '../types';
import type { ScreenPoint } from '../draw/tools';

/** A synchronous lat/lng ⇄ screen-pixel projection for a map view.
 *
 *  WHY THIS EXISTS. The drawing tools in ../draw/tools take a project and an
 *  unproject function and do everything else in pixel space. On the web both
 *  map libraries hand those over directly: Leaflet has latLngToContainerPoint
 *  and MapLibre GL JS has project, and both return a value immediately.
 *  MapLibre React Native does not — its MapRef.project and MapRef.unproject go
 *  over the bridge to the native map and return Promises. A promise per route
 *  vertex per touch sample is not a projection, it is a network, and the
 *  eraser would be resolving last frame's answers into this frame's geometry.
 *
 *  So the phone computes the projection itself, from the camera state the map
 *  reports as it moves (centre, zoom, bearing) plus the view's own pixel size.
 *  This is the same spherical-Mercator arithmetic the map is doing internally;
 *  the only reason not to ask it is that asking is asynchronous.
 *
 *  PITCH IS DELIBERATELY NOT SUPPORTED. A tilted camera turns the projection
 *  into a perspective divide, where the pixel scale varies down the screen and
 *  the horizon can put points behind the camera — and a viewport that silently
 *  returned flat answers for a tilted map would put the drawn line somewhere
 *  other than under the finger, gradually worse toward the top of the screen.
 *  The mobile planner disables pitch gestures while a drawing tool is active
 *  instead, so the assumption below is enforced rather than hoped for. Nothing
 *  here inspects pitch, because there is no honest thing to do with it.
 *
 *  ACCURACY. This is the exact Web Mercator transform, not an approximation,
 *  so round-tripping a point through project then unproject returns it to
 *  within floating-point noise. What it does not model is terrain: like the
 *  web's 2D planner, a point is placed on the map plane, not on the ground
 *  surface. That is the right behaviour for a top-down map. */

/** Web Mercator's latitude limit — the parallel where the projection's square
 *  world runs out. Beyond it y runs to infinity, so inputs are clamped rather
 *  than allowed to produce NaN pixels. Norway's mainland tops out near 71°N,
 *  so this only ever bites on nonsense input. */
export const MAX_MERCATOR_LAT = 85.051129;

/** Pixel size of one tile at zoom 0, and therefore of the whole world. 512 is
 *  MapLibre's convention (Leaflet's is 256, which is the same map at a zoom
 *  offset of one); this module is used with MapLibre, so it matches MapLibre. */
const TILE_SIZE = 512;

/** The camera state a viewport is built from. Exactly the fields MapLibre
 *  React Native reports in its region-change events, plus the view size, which
 *  the map does not report and the caller measures with onLayout. */
export interface ViewportState {
  /** Map centre, [lat, lng]. */
  center: LatLng;
  /** Fractional zoom, as the map reports it. */
  zoom: number;
  /** Compass direction that is "up" on screen, degrees clockwise from north.
   *  Zero for a north-up map. */
  bearing?: number;
  /** Width of the map view in points/pixels — whatever unit the touch
   *  coordinates are in, since the two are compared directly. */
  width: number;
  /** Height of the map view, same unit as width. */
  height: number;
}

export interface Viewport {
  project: (ll: LatLng) => ScreenPoint;
  unproject: (x: number, y: number) => LatLng;
  /** The state this viewport was built from, kept so a caller can tell whether
   *  a newly reported camera differs from the one it is holding. */
  state: ViewportState;
}

/** Build a projection for one camera state.
 *
 *  Immutable by design: a viewport is a snapshot, and the caller replaces it
 *  wholesale when the map moves. That is what makes it safe to capture in a
 *  ref and call from a gesture handler — the projection cannot change halfway
 *  through an eraser pass and cut the route against two different cameras. */
export function createViewport(state: ViewportState): Viewport {
  const { center, zoom, width, height } = state;
  const bearing = state.bearing ?? 0;
  const worldSize = TILE_SIZE * Math.pow(2, zoom);
  const rad = (bearing * Math.PI) / 180;
  const cosB = Math.cos(rad);
  const sinB = Math.sin(rad);

  // World-pixel coordinates of the centre, computed once.
  const cx = lngToWorldX(center[1], worldSize);
  const cy = latToWorldY(center[0], worldSize);

  const project = (ll: LatLng): ScreenPoint => {
    const dx = lngToWorldX(ll[1], worldSize) - cx;
    const dy = latToWorldY(ll[0], worldSize) - cy;
    // Rotate the world under the camera. With bearing b, a point due east of
    // centre must appear above it when b is 90° — hence the sign of the y row.
    return {
      x: width / 2 + dx * cosB + dy * sinB,
      y: height / 2 - dx * sinB + dy * cosB,
    };
  };

  const unproject = (x: number, y: number): LatLng => {
    const ux = x - width / 2;
    const uy = y - height / 2;
    // Transpose of the rotation above, which for a rotation is its inverse.
    const dx = ux * cosB - uy * sinB;
    const dy = ux * sinB + uy * cosB;
    return [worldYToLat(cy + dy, worldSize), worldXToLng(cx + dx, worldSize)];
  };

  return { project, unproject, state };
}

function lngToWorldX(lng: number, worldSize: number): number {
  return ((lng + 180) / 360) * worldSize;
}

function latToWorldY(lat: number, worldSize: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize;
}

function worldXToLng(x: number, worldSize: number): number {
  return (x / worldSize) * 360 - 180;
}

function worldYToLat(y: number, worldSize: number): number {
  const n = Math.PI * (1 - (2 * y) / worldSize);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}
