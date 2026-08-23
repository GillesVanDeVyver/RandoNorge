import { useSyncExternalStore } from 'react';
import type { LatLng } from '../types';
import { setHoverPoint } from '../hoverStore';
import { PARKING_PIN_COLOR } from './pin';

// "Which parking is the reader pointing at right now", and the one pair of
// functions that is allowed to answer it.
//
// The store is the same shape and the same reason as hoverStore and
// parking/store: pointing at a row must not re-render App / Map / the panel,
// only the signs on the map.
//
// It holds the area's id rather than its coordinates because the sign layer
// asks "is this the hovered one" once per sign, and deciding that by comparing
// floating-point coordinates is a bug waiting for two lots mapped on the same
// node. The id is what the panel and the parking store already agree on.
//
// TWO STORES, ONE HIGHLIGHT. Pointing at a lot also moves the dot in
// hoverStore — the same dot the elevation chart drives, and the only half of
// the highlight that exists in the 3D view, where there are no Leaflet markers
// to grow. So the highlight is two stores that must agree, and the way they are
// kept in agreement is that nothing sets either of them directly: callers use
// takeParkingHighlight / releaseParkingHighlight, here, together. A panel row
// and a sign on the map both do, which is why pointing at either end lights the
// same lot and why neither end can drift from the other.

let current: string | null = null;
const listeners = new Set<() => void>();

/** Light `id`, and move the coordinate dot to the lot it names. */
export function takeParkingHighlight(id: string, point: LatLng) {
  setHoverPoint(point, PARKING_PIN_COLOR);
  if (current === id) return;
  current = id;
  for (const l of listeners) l();
}

/** Give up the highlight, but only if `id` still holds it.
 *
 *  A pointer crossing from row 2 straight onto row 3 fires enter(3) BEFORE
 *  leave(2). Clearing unconditionally would therefore put out the light that
 *  the enter had just switched on, and the symptom is a highlight that works
 *  when approached slowly and dies when the reader drags down the list. Same
 *  sequence when the pointer leaves a row for a sign on the map.
 *
 *  The dot is only cleared when the id was in fact ours, because the dot is
 *  keyed by position and cannot work out on its own that someone else has
 *  since taken over. */
export function releaseParkingHighlight(id: string) {
  if (current !== id) return;
  current = null;
  setHoverPoint(null);
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  return current;
}

export function useHoveredParkingId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
