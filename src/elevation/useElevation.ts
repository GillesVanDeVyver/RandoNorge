import { useEffect, useState } from 'react';
import type { Route } from '../types';
import { computeProfile, type ProfileData } from './profile';

interface ElevationState {
  profile: ProfileData | null;
  loading: boolean;
  error: string | null;
}

// Fetch elevation profile whenever the route changes. Aborts any in-flight
// request when the route changes again or the component unmounts.
export function useElevation(route: Route): ElevationState {
  const [state, setState] = useState<ElevationState>({
    profile: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (route.length === 0) {
      setState({ profile: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    computeProfile(route, controller.signal)
      .then((profile) => {
        if (!controller.signal.aborted) {
          setState({ profile, loading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : 'Failed to fetch';
        setState({ profile: null, loading: false, error: msg });
      });
    return () => controller.abort();
  }, [route]);

  return state;
}
