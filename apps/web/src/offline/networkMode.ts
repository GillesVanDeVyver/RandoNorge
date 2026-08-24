// A tiny shared flag for "act as if there is no network", used to test offline
// maps on a desktop without touching DevTools. When set, OfflineTileLayer stops
// falling back to the network on a cache miss, so only downloaded tiles render
// and everything else goes blank — exactly what happens out of coverage.
//
// In production this always stays false; only the dev offline simulator
// (src/dev/offlineSimulator.ts, loaded with ?offline in dev) ever flips it.
//
// This module also exposes the *effective* offline state — the dev flag OR the
// browser reporting no connectivity (navigator.onLine) — which the offline
// mask overlay uses to gray out the map wherever there's no downloaded
// coverage, the way ut.no dims everything outside a saved area.

import { useSyncExternalStore } from 'react';

let forcedOffline = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function isForcedOffline(): boolean {
  return forcedOffline;
}

export function setForcedOffline(value: boolean): void {
  if (value === forcedOffline) return;
  forcedOffline = value;
  notify();
}

/** Subscribe to changes (layers use this to redraw when the flag flips). */
export function subscribeNetworkMode(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Browser connectivity, defaulting to "online" where navigator is unavailable
// (SSR/tests) so we never gray out the map on a false negative.
function browserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

// Real users go offline in the mountains without ever touching the dev
// simulator, so treat an actual loss of connectivity the same as the forced
// flag. The two are OR'd: either one puts us in offline mode.
export function isEffectivelyOffline(): boolean {
  return forcedOffline || !browserOnline();
}

// Mirror the browser's own online/offline events into our subscriber set so the
// mask and any other listeners redraw the moment connectivity drops or returns.
if (typeof window !== 'undefined') {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
}

/**
 * React binding for the effective offline state. Re-renders on the dev flag
 * flipping and on the browser's online/offline events.
 */
export function useEffectiveOffline(): boolean {
  return useSyncExternalStore(subscribeNetworkMode, isEffectivelyOffline);
}
