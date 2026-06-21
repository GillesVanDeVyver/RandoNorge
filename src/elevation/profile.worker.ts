/// <reference lib="WebWorker" />
// Dedicated module worker that runs the entire elevation profile pipeline
// (resampling, parallel HTTP fetches for elevations + slope-neighbour grid,
// PNG decode for the NVE runout layer) off the main thread. Long routes
// resample to several thousand points, decode a multi-MB PNG, and read
// every pixel from it — doing all that on the UI thread is what was
// pegging the CPU at ~100% and freezing the page during loading.

import type { Route } from '../types';
import { computeProfile, type ProfileData } from './profile';

declare const self: DedicatedWorkerGlobalScope;

interface RunRequest {
  id: number;
  route: Route;
}

type Response =
  | { id: number; ok: true; profile: ProfileData }
  | { id: number; ok: false; error: string }
  | { id: number; aborted: true };

// Tracks the latest accepted request so we can abort any in-flight one
// when a newer route arrives (the user kept drawing/erasing).
let currentController: AbortController | null = null;
let currentId = 0;

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  const { id, route } = e.data;
  if (currentController) currentController.abort();
  currentController = new AbortController();
  currentId = id;
  const signal = currentController.signal;

  try {
    const profile = await computeProfile(route, signal);
    // Skip stale results: a newer request has already taken over.
    if (id !== currentId) return;
    const msg: Response = { id, ok: true, profile };
    self.postMessage(msg);
  } catch (err) {
    if (signal.aborted) {
      const msg: Response = { id, aborted: true };
      self.postMessage(msg);
      return;
    }
    const msg: Response = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};
