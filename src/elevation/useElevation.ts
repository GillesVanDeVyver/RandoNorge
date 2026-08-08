import { startTransition, useEffect, useRef, useState } from 'react';
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
  // Set when the worker could not be constructed at all, so the second effect
  // can report that instead of leaving an empty panel that never resolves.
  const workerErrorRef = useRef<string | null>(null);

  useEffect(() => {
    // `new Worker` is not a safe expression: it throws synchronously if the
    // page's CSP forbids the script URL (worker-src), and it can also fail
    // behind strict enterprise policies or in browsers with workers disabled.
    // Un-caught, that error escapes the mount effect and React unwinds to the
    // nearest ErrorBoundary — so a missing elevation profile would take the
    // entire planner down with it. The profile is an enhancement; losing it
    // must not cost the user the map, the route they are drawing, or their
    // unsaved work.
    let worker: Worker;
    try {
      worker = new Worker(new URL('./profile.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (err) {
      workerErrorRef.current =
        err instanceof Error ? err.message : String(err);
      setState({
        profile: null,
        loading: false,
        error: workerErrorRef.current,
      });
      return;
    }
    workerErrorRef.current = null;
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.id !== latestIdRef.current) return; // superseded
      if ('aborted' in msg) return; // newer request will produce the answer
      // Apply the result as a transition: mounting the elevation/snow/weather
      // charts (hundreds of Recharts SVG elements) is a heavy synchronous
      // render that would otherwise block the main thread — and with it both
      // map render/input loops — until it finishes. A transition renders
      // concurrently and yields to the browser, so the map stays pannable and
      // rotatable while the panels fill in.
      startTransition(() => {
        if (msg.ok) {
          setState({ profile: msg.profile, loading: false, error: null });
        } else {
          setState({ profile: null, loading: false, error: msg.error });
        }
      });
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
    if (!worker) {
      // No worker was ever created (see the mount effect). Surface the reason
      // rather than sitting in a permanent, silent "no profile yet" state.
      if (workerErrorRef.current) {
        latestIdRef.current++;
        setState({
          profile: null,
          loading: false,
          error: workerErrorRef.current,
        });
      }
      return;
    }
    const id = ++latestIdRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    worker.postMessage({ id, route });
  }, [route]);

  return state;
}
