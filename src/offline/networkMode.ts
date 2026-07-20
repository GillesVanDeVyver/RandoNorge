// A tiny shared flag for "act as if there is no network", used to test offline
// maps on a desktop without touching DevTools. When set, OfflineTileLayer stops
// falling back to the network on a cache miss, so only downloaded tiles render
// and everything else goes blank — exactly what happens out of coverage.
//
// In production this always stays false; only the dev offline simulator
// (src/dev/offlineSimulator.ts, loaded with ?offline in dev) ever flips it.

let forcedOffline = false;
const listeners = new Set<() => void>();

export function isForcedOffline(): boolean {
  return forcedOffline;
}

export function setForcedOffline(value: boolean): void {
  if (value === forcedOffline) return;
  forcedOffline = value;
  for (const fn of listeners) fn();
}

/** Subscribe to changes (layers use this to redraw when the flag flips). */
export function subscribeNetworkMode(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
