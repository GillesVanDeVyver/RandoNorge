// Compute a route's elevation profile and hold the result, loading flag and
// error — the same three-field contract `useSnow`, `useWeather` and
// `useAvalanche` already return.
//
// WHY THIS EXISTS WHEN apps/web ALREADY HAS useElevation. It does, and it is
// staying: on the web `computeProfile` resamples to a few thousand points,
// fires several hundred fetches and decodes a multi-megabyte PNG to sample
// NVE's runout raster, all of which used to peg the main thread and freeze the
// page. apps/web/src/elevation/useElevation.ts pushes that into a dedicated
// module worker, and a Worker constructed from `new URL(..., import.meta.url)`
// is a bundler feature that React Native's Metro does not have.
//
// So the phone runs the pipeline in place, and it can: `hasRasterSampler()` is
// false without a DOM canvas, so `fetchRunoutLevels` returns RUNOUT_UNKNOWN for
// every point without fetching or decoding anything at all. The expensive half
// of the work the worker exists to move off the main thread does not happen
// here — what is left is network waits, which block nothing.
//
// The two therefore share a CONTRACT rather than an implementation, and
// `ProfileState` below is that contract stated once: useElevation imports it
// and returns it, so a field added here has to be answered there. Sharing more
// than the type would mean pretending one of the platforms can do something it
// cannot, and this file would rather say plainly which half is different.

import { startTransition, useEffect, useState } from 'react';
import type { Route } from '../types';
import { computeProfile, type ProfileData } from './profile';

/** What a profile consumer gets back, on either platform. */
export interface ProfileState {
  profile: ProfileData | null;
  loading: boolean;
  error: string | null;
}

/**
 * The elevation profile of `route`, recomputed whenever the route changes.
 *
 * An in-flight computation is aborted when the route changes again or the
 * component unmounts — the same lifetime the other three data hooks give their
 * requests. Aborting matters more than usual here because a single call fans
 * out into hundreds of Kartverket requests, and a user who opens a route and
 * immediately goes back should not leave them all running.
 *
 * A null or empty route is not an error and not a loading state: it is a route
 * with no profile, which is what the planner shows before anything is drawn.
 */
export function useProfile(route: Route | null): ProfileState {
  const [state, setState] = useState<ProfileState>({
    profile: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!route || route.length === 0) {
      startTransition(() => {
        setState({ profile: null, loading: false, error: null });
      });
      return;
    }
    const controller = new AbortController();
    startTransition(() => {
      setState((s) => ({ ...s, loading: true, error: null }));
    });

    computeProfile(route, controller.signal)
      .then((profile) => {
        if (controller.signal.aborted) return;
        // A transition, for the reason useElevation gives: committing a chart
        // of several hundred line elements synchronously stalls whatever else
        // is drawing, and on the phone that is a MapLibre surface the user may
        // still have a finger on.
        startTransition(() => {
          setState({ profile, loading: false, error: null });
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : 'Failed to fetch';
        startTransition(() => {
          setState({ profile: null, loading: false, error: message });
        });
      });

    return () => controller.abort();
  }, [route]);

  return state;
}
