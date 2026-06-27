import { startTransition, useEffect, useState } from 'react';
import type { ProfileData } from '../elevation/profile';
import { fetchSnowDepths } from './api';

export interface SnowData {
  // Snow depth (cm) per segment, parallel to ProfileData.segments. NaN where
  // the seNorge grid has no value for that point on the requested date.
  depths: number[][];
  date: string;
}

interface SnowState {
  snow: SnowData | null;
  loading: boolean;
  error: string | null;
}

// Fetch seNorge snow depth at every point of the elevation profile for the
// requested date. Re-runs whenever either input changes; in-flight requests
// are aborted when the inputs change again or the component unmounts.
export function useSnow(profile: ProfileData | null, date: string): SnowState {
  const [state, setState] = useState<SnowState>({
    snow: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!profile || profile.segments.length === 0) {
      setState({ snow: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    const flat: [number, number][] = [];
    const segLens: number[] = [];
    for (const seg of profile.segments) {
      segLens.push(seg.length);
      for (const p of seg) flat.push([p.lat, p.lng]);
    }

    fetchSnowDepths(flat, date, controller.signal)
      .then((all) => {
        if (controller.signal.aborted) return;
        const depths: number[][] = [];
        let off = 0;
        for (const n of segLens) {
          depths.push(all.slice(off, off + n));
          off += n;
        }
        // Transition: the snow chart re-render is heavy enough to stall the
        // map's render/input loop if committed synchronously. See useElevation.
        startTransition(() => {
          setState({ snow: { depths, date }, loading: false, error: null });
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : 'Failed to fetch';
        startTransition(() => {
          setState({ snow: null, loading: false, error: msg });
        });
      });
    return () => controller.abort();
  }, [profile, date]);

  return state;
}
