// "Is this MapLibre map ready to be edited yet?" — asked once, correctly.
//
// Every deferred edit to a live MapLibre style needs this gate: setting a
// source's data, flipping a layer's visibility, repainting a line. Map3DView
// has a dozen of them, and now so does the component that keeps the parking
// signs in step with the Parking tab, which is why the answer moved out of
// Map3DView and into here rather than being written a second time.
//
// WHY THE OBVIOUS VERSION IS A BUG
//
// `map.isStyleLoaded()` does not mean what its name suggests. It is false not
// just before the style is up but at any moment a source still has tiles in
// flight — which, for the planner's 3D style (raster basemap + DEM + two
// overlays), is most of the time the user is moving. Pairing it with
// `once('load')` therefore deadlocks: a false reading taken after the map's
// single `load` has already gone by queues the work on an event that will never
// fire again, and the work is silently dropped for good.
//
// That is the bug behind a 2D/3D switch that sometimes just does nothing: press
// 2D while a tile is still arriving and the tilt is queued behind an event
// already in the past, so the camera never flattens, `onFlattened` never fires,
// and the switch is dead until the view is rebuilt. The same trap sat under
// every other deferred style edit — route repaints, overlay changes, the
// zoom-to-route button.
//
// So `load` is remembered here, and that — not tile traffic — is the gate.

import type maplibregl from 'maplibre-gl';

/** Maps whose one and only `load` has fired. A WeakSet so a torn-down map is
 *  not held alive by the bookkeeping about it. */
const styleLoaded = new WeakSet<maplibregl.Map>();

/** Record that `map` has had its `load`. Called by whoever owns the map, from
 *  its own `load` handler; everything else only ever reads the answer. */
export function markStyleLoaded(map: maplibregl.Map): void {
  styleLoaded.add(map);
}

/** Whether `map`'s style is up, without waiting. For code that has to decide
 *  something now rather than queue it — see Map3DView's camera reporting. */
export function isStyleReady(map: maplibregl.Map): boolean {
  return styleLoaded.has(map);
}

/**
 * Run `job` as soon as the map's style exists, and exactly once.
 *
 * Returns a canceller so an effect that is torn down before its turn comes does
 * not leave a listener behind.
 */
export function whenStyleReady(
  map: maplibregl.Map,
  job: () => void,
): () => void {
  if (styleLoaded.has(map) || map.isStyleLoaded()) {
    job();
    return () => {};
  }
  map.once('load', job);
  return () => {
    map.off('load', job);
  };
}
