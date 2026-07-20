import { startTransition, useEffect, useState } from 'react';
import type { ProfileData } from '../elevation/profile';
import { fetchSnowDepths } from './api';

export interface SnowData {
  // Snow depth (cm) per segment, parallel to ProfileData.segments. NaN where
  // the seNorge grid has no value for that point on the requested date.
  depths: number[][];
  date: string;
  // Epoch ms of the oldest retrieval among the grid cells shown (cached
  // cells keep their original time). Null when no cell produced data.
  fetchedAt: number | null;
}

interface SnowState {
  snow: SnowData | null;
  loading: boolean;
  error: string | null;
}

// Fetch seNorge snow depth at every point of the elevation profile for the
// requested date. Re-runs whenever either input changes; in-flight requests
// are aborted when the inputs change again or the component unmounts.
//
// `frozen` short-circuits the network: when a saved/shared route is opened it
// carries the depths captured at save time, so every viewer sees identical
// data. It only applies while the viewer stays on the frozen date — changing
// the date (or hitting Refresh, which passes null) falls through to live data.
export function useSnow(
  profile: ProfileData | null,
  date: string,
  frozen?: SnowData | null,
): SnowState {
  const [state, setState] = useState<SnowState>({
    snow: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (frozen) {
      startTransition(() => {
        setState({ snow: frozen, loading: false, error: null });
      });
      return;
    }
    if (!profile || profile.segments.length === 0) {
      startTransition(() => {
        setState({ snow: null, loading: false, error: null });
      });
      return;
    }
    const controller = new AbortController();
    startTransition(() => {
      setState((s) => ({ ...s, loading: true, error: null }));
    });

    const flat: [number, number][] = [];
    const segLens: number[] = [];
    for (const seg of profile.segments) {
      segLens.push(seg.length);
      for (const p of seg) flat.push([p.lat, p.lng]);
    }

    fetchSnowDepths(flat, date, controller.signal)
      .then(({ depths: all, fetchedAt }) => {
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
          setState({
            snow: { depths, date, fetchedAt },
            loading: false,
            error: null,
          });
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
  }, [profile, date, frozen]);

  // Hand back the frozen data on the first paint (no loading flash) when a
  // saved route is opened on its captured date.
  if (frozen) return { snow: frozen, loading: false, error: null };
  return state;
}
