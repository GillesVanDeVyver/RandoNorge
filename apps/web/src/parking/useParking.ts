import { startTransition, useEffect, useState } from 'react';
import type { LatLng } from '@fjellrute/core/types';
import { fetchParkingNear, type ParkingArea } from './api';
import { setParkingAreas } from './store';

/** How many lots the tab lists. Five is the product decision, and it is also
 *  roughly where a list stops being an answer and starts being a search
 *  result — nobody drives to their sixth choice of car park. */
export const PARKING_LIMIT = 5;

/** Default search radius, meters.
 *
 *  3 km rather than something larger because a car park further than that from
 *  the trailhead is not somewhere anyone actually leaves the car; it is noise
 *  that pushes the real answer down the list. docs/parking-data-sources.md puts
 *  the realistic range at 300 m to 2 km, and the extra kilometre is slack for
 *  the tour whose start is up a side valley from the road. The radius can be
 *  raised to 20 km for the cases that break the rule — a long approach up a
 *  closed winter road, say — but that is a number the guide has to go and
 *  type, which is the right amount of friction for a search that wide. */
export const PARKING_DEFAULT_RADIUS_M = 3000;
export const PARKING_MIN_RADIUS_M = 1000;
export const PARKING_MAX_RADIUS_M = 20000;

/** The radius is chosen, shown and stored in whole kilometres.
 *
 *  It used to move in 500 m steps behind a label that rounded to whole ones, so
 *  a guide could leave it reading "3 km" while the query ran at 2.5 or 3.5 —
 *  and the printed briefing, which prints the same label, said "3 km" too.
 *  One unit, all the way through. */
export const PARKING_RADIUS_STEP_M = 1000;

/** Debounce before querying /api/parking, ms.
 *
 *  Both inputs now change one commit at a time — the route start on a finished
 *  stroke, the radius when the guide leaves the field — so this no longer has a
 *  drag to swallow, as it did when the radius was a slider emitting a distinct
 *  request per pixel. It stays because the route start still arrives in bursts
 *  while a stroke is being edited, and because each distinct query is a D1 read:
 *  cheaper than the third-party register this replaced, and still not free. */
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
