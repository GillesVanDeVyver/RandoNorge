import { useSyncExternalStore } from 'react';
import type { LatLng } from './types';

// Tiny pub/sub store for the elevation-chart hover point. Kept out of
// React state so that hovering the chart doesn't trigger re-renders of
// App / Map / the chart itself — only the subscribed HoverMarker updates.
let current: LatLng | null = null;
const listeners = new Set<() => void>();

export function setHoverPoint(p: LatLng | null) {
  if (p === current) return;
  if (
    p &&
    current &&
    p[0] === current[0] &&
    p[1] === current[1]
  ) {
    return;
  }
  current = p;
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

export function useHoverPoint(): LatLng | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
