import { useSyncExternalStore } from 'react';
import type { LatLng } from './types';

// Tiny pub/sub store for the elevation-chart hover point. Kept out of
// React state so that hovering the chart doesn't trigger re-renders of
// App / Map / the chart itself — only the subscribed HoverMarker updates.
//
// Besides the position, the hover carries the color of the dataset being
// hovered (teal for the planned route's profile, the recorded-track orange
// for the actual route's), so the map dot always matches the line it
// retraces. Undefined color = the marker's default (teal).

export interface HoverPoint {
  point: LatLng;
  color?: string;
}

let current: HoverPoint | null = null;
const listeners = new Set<() => void>();

export function setHoverPoint(p: LatLng | null, color?: string) {
  if (p === null) {
    if (current === null) return;
    current = null;
  } else {
    if (
      current &&
      p[0] === current.point[0] &&
      p[1] === current.point[1] &&
      color === current.color
    ) {
      return;
    }
    // A fresh object per change keeps useSyncExternalStore snapshots
    // referentially stable between changes.
    current = { point: p, color };
  }
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

export function useHoverPoint(): HoverPoint | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
