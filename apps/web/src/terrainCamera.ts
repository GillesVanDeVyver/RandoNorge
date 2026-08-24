// Where the guide was standing, the last time they looked at this tour in 3D.
//
// The planner's terrain view (Map3DView) owns its camera and throws it away
// when the view flips back to 2D, which is the right behaviour for a map you
// can always re-aim. The printed sheet cannot be re-aimed after it is a PDF, so
// it opens on the angle the tour was last seen from rather than on a default
// one: the guide turns the hillside until the couloir reads, opens the export,
// and finds the picture they were just looking at.
//
// Deliberately in memory only. This is not a preference — it is the state of a
// glance, and a camera restored from last week's session onto a tour the user
// has since redrawn would be a stale picture presented as a considered one. A
// reload starts again from the route's own framing, which is always correct if
// never personal.
//
// The guard below exists for the same reason: a camera is only handed back for
// a route it plausibly still looks at, so loading a different tour and printing
// it in 3D cannot produce a beautifully angled photograph of the wrong valley.

import type { Route } from '@fjellrute/core/types';

/** A MapLibre camera, in the terms MapLibre's own jumpTo takes. */
export interface TerrainCamera {
  /** [lng, lat], MapLibre's order rather than the app's. */
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

let remembered: TerrainCamera | null = null;

/** Called by the planner's 3D view whenever its camera comes to rest. */
export function rememberTerrainCamera(camera: TerrainCamera): void {
  remembered = camera;
}

/** Forget the angle — the tour on screen is no longer the tour it framed. */
export function forgetTerrainCamera(): void {
  remembered = null;
}

/**
 * The camera to open a 3D view of `route` on, or null to fall back to framing
 * the route from the default angle.
 *
 * Returns nothing when the remembered camera is not looking at this route.
 * That is the whole point of the check: the export dialog asks for "the angle
 * the user had, if any", and a camera left over from another tour is not an
 * angle they had on this one.
 */
export function recallTerrainCamera(route: Route): TerrainCamera | null {
  if (!remembered) return null;
  return looksAt(route, remembered.center) ? remembered : null;
}

/**
 * Is `center` somewhere within sight of `route`?
 *
 * The route's own bounding box, grown by half its span on each side — generous,
 * because a tilted camera sits back from what it is looking at and because an
 * edit made after leaving the 3D view should not cost the guide their angle,
 * and strict enough that the next fjord over fails. The floor keeps a tour that
 * fits in a single cirque, whose box is nearly a point, from rejecting a camera
 * a hundred metres off its centre.
 */
function looksAt(route: Route, center: [number, number]): boolean {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let seen = 0;
  for (const seg of route) {
    for (const [lat, lng] of seg) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      seen++;
    }
  }
  if (seen === 0) return false;

  const padLat = Math.max((maxLat - minLat) / 2, 0.02);
  const padLng = Math.max((maxLng - minLng) / 2, 0.05);
  const [lng, lat] = center;
  return (
    lat >= minLat - padLat &&
    lat <= maxLat + padLat &&
    lng >= minLng - padLng &&
    lng <= maxLng + padLng
  );
}
