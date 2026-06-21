import { useEffect, useRef, useState } from 'react';
import type { Route } from '../types';
import type { ProfileData } from './profile';

interface ElevationState {
  profile: ProfileData | null;
  loading: boolean;
  error: string | null;
}

type WorkerResponse =
  | { id: number; ok: true; profile: ProfileData }
  | { id: number; ok: false; error: string }
  | { id: number; aborted: true };

// Drive elevation profile computation through a dedicated module worker so
// the main thread stays free during PNG decode, pixel sampling, and the
// many parallel network fetches. The worker handles aborts internally; we
// also tag every request with a monotonically increasing id and ignore
// any reply whose id is no longer the most recent (defensive against
// races during rapid route edits).
export function useElevation(route: Route): ElevationState {
  const [state, setState] = useState<ElevationState>({
    profile: null,
    loading: false,
    error: null,
  });
  const workerRef = useRef<Worker | null>(null);
  const latestIdRef = useRef(0);

  useEffect(() => {
    const worker = new Worker(
      new URL('./profile.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.id !== latestIdRef.current) return; // superseded
      if ('aborted' in msg) return; // newer request will produce the answer
      if (msg.ok) {
        setState({ profile: msg.profile, loading: false, error: null });
      } else {
        setState({ profile: null, loading: false, error: msg.error });
      }
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (route.length === 0) {
      latestIdRef.current++;
      setState({ profile: null, loading: false, error: null });
      return;
    }
    const worker = workerRef.current;
    if (!worker) return;
    const id = ++latestIdRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    worker.postMessage({ id, route });
  }, [route]);

  return state;
}
