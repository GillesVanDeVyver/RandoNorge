import { startTransition, useEffect, useState } from 'react';
import type { LatLng } from '../types';
import { fetchParkingNear, type ParkingArea } from './api';
import { setParkingAreas } from './store';

/** How many lots the tab lists. Five is the product decision, and it is also
 *  roughly where a list stops being an answer and starts being a search
 *  result — nobody drives to their sixth choice of car park. */
export const PARKING_LIMIT = 5;

/** Default search radius, meters.
 *
 *  2 km rather than something larger because a car park further than that from
 *  the trailhead is not somewhere anyone actually leaves the car; it is noise
 *  that pushes the real answer down the list. docs/parking-data-sources.md puts
 *  the realistic range at 300 m to 2 km. The slider goes to 10 km for the cases
 *  that break the rule — a long approach up a closed winter road, say. */
export const PARKING_DEFAULT_RADIUS_M = 2000;
export const PARKING_MIN_RADIUS_M = 1000;
export const PARKING_MAX_RADIUS_M = 10000;

/** Debounce before querying NVDB, ms.
 *
 *  The route start only moves on a committed stroke, but the radius slider
 *  emits continuously while dragged, and each distinct radius is a distinct
 *  upstream request. Waiting for the drag to settle turns a hundred requests
 *  into one. */
const DEBOUNCE_MS = 300;

export interface ParkingState {
  areas: ParkingArea[];
  loading: boolean;
  error: string | null;
  /** Epoch ms the shown data was retrieved; null when there is none. */
  fetchedAt: number | null;
}

/** Parking areas near `origin`, nearest first, within `radiusM`.
 *
 *  Follows the useSnow / useAvalanche shape: re-runs when either input
 *  changes, aborts the in-flight request when they change again or the
 *  component unmounts, and commits results in a transition so the list render
 *  can't stall the map's input loop.
 *
 *  As a side effect it publishes the result to the parking store, which is
 *  what puts the pins on the map. That lives here rather than in the panel so
 *  the map and the list can never show different sets of lots. */
export function useParking(
  origin: LatLng | null,
  radiusM: number,
  limit: number = PARKING_LIMIT,
): ParkingState {
  const [state, setState] = useState<ParkingState>({
    areas: [],
    loading: false,
    error: null,
    fetchedAt: null,
  });

  useEffect(() => {
    if (!origin) {
      setParkingAreas([]);
      startTransition(() => {
        setState({ areas: [], loading: false, error: null, fetchedAt: null });
      });
      return;
    }

    const controller = new AbortController();
    startTransition(() => {
      setState((s) => ({ ...s, loading: true, error: null }));
    });

    const timer = setTimeout(() => {
      fetchParkingNear(origin, radiusM, limit, controller.signal)
        .then((areas) => {
          if (controller.signal.aborted) return;
          setParkingAreas(areas);
          startTransition(() => {
            setState({
              areas,
              loading: false,
              error: null,
              fetchedAt: areas[0]?.fetchedAt ?? Date.now(),
            });
          });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const msg = err instanceof Error ? err.message : 'Failed to fetch';
          setParkingAreas([]);
          startTransition(() => {
            setState({
              areas: [],
              loading: false,
              error: msg,
              fetchedAt: null,
            });
          });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // origin is a tuple rebuilt by the caller on every render, so depend on its
    // contents rather than its identity — otherwise every parent render would
    // restart the debounce and the request would never fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.[0], origin?.[1], radiusM, limit]);

  // Clear the map pins when the panel goes away (tab unmount, route cleared),
  // so pins can't outlive the list that explains them.
  useEffect(() => () => setParkingAreas([]), []);

  return state;
}
