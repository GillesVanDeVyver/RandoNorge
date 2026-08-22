import { useSyncExternalStore } from 'react';
import type { ParkingArea } from './api';

// Tiny pub/sub store for the parking areas currently listed in the Parking
// tab, so the map can draw them without any of it passing through App.
//
// Same reasoning as hoverStore: the panel owns the radius control and the
// fetch, the map only needs to render the answer, and threading a nineteenth
// prop through App → Map → a layer would make every parking re-render redraw
// the whole map. Only the subscribed ParkingLayer updates.
//
// The list published here is exactly the list the panel shows — the same five
// lots in the same order — so the numbered pins on the map and the numbered
// rows in the tab always agree.

let current: ParkingArea[] = [];
const listeners = new Set<() => void>();

// A shared empty array so the "nothing found" snapshot is referentially
// stable; returning a fresh [] each time would spin useSyncExternalStore.
const EMPTY: ParkingArea[] = [];

export function setParkingAreas(areas: ParkingArea[]) {
  const next = areas.length === 0 ? EMPTY : areas;
  if (next === current) return;
  // Identical id lists mean the same lots — skip the notify so re-fetching the
  // same place (a route edit that didn't move the start) doesn't redraw pins.
  if (
    next.length === current.length &&
    next.every((a, i) => a.id === current[i].id)
  ) {
    return;
  }
  current = next;
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

export function useParkingAreas(): ParkingArea[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
