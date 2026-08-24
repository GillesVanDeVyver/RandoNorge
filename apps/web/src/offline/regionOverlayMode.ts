// Shared "show downloaded-area boundaries" flag. Toggled from the map controls
// and read by both the 2D overlay (RegionBoundaryLayer) and the 3D view's
// region layers, so a single button controls both map implementations without
// threading state through App. Mirrors networkMode.ts's tiny pub/sub store.

import { useSyncExternalStore } from 'react';

// Boundaries are shown by default — they're the whole point of the feature.
let visible = true;
const listeners = new Set<() => void>();

export function isRegionsVisible(): boolean {
  return visible;
}

export function setRegionsVisible(value: boolean): void {
  if (value === visible) return;
  visible = value;
  for (const fn of listeners) fn();
}

export function toggleRegionsVisible(): void {
  setRegionsVisible(!visible);
}

/** Subscribe to visibility changes; returns an unsubscribe function. */
export function subscribeRegionOverlay(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React binding for control buttons that reflect and flip the flag. */
export function useRegionsVisible(): boolean {
  return useSyncExternalStore(subscribeRegionOverlay, isRegionsVisible);
}
