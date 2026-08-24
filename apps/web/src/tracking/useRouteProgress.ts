// Monotonic progress along the planned route while navigating. Each GPS fix
// is projected onto the part of the route at/after the current progress
// point, so progress can only advance — backtracking (or the overlapping
// return leg of an out-and-back route) never moves the indicated position
// backwards. Progress resets when a new navigation session starts or the
// planned route changes.

import { useState } from 'react';
import { projectOntoRouteAhead } from '../geometry';
import type { LatLng, Route } from '../types';

// Beyond this straight-line distance from the route, the position is
// considered "somewhere else": no connector is drawn, no progress is shown
// (and none is accrued) until the user comes back within range. Tripled
// from the original 1000 m so the dotted "get back on track" connector to
// the closest point on the plan keeps showing from farther off-route.
export const PROGRESS_MAX_OFF_ROUTE_M = 3000;

// Forward search window per fix. Restricting the match to shortly ahead of
// the current progress keeps it from jumping to a later, overlapping part
// of the route (the return leg of an out-and-back) when the user backtracks
// over ground both legs share. With a GPS fix every few seconds nobody
// legitimately advances 500 m between fixes; when nothing in the window is
// within range (started mid-route, rejoined after a long detour) an
// unwindowed search takes over, so progress can still jump-start forward.
const ADVANCE_WINDOW_M = 500;

export interface RouteProgress {
  /** Monotonic along-route progress from the route start, meters. */
  alongM: number;
  /** The point on the route at `alongM` (the "you are here on the plan"). */
  point: LatLng;
  /** Straight-line distance from the live position to `point`, meters. */
  offRouteM: number;
}

interface ProgressState {
  // The inputs this state was derived from (identity comparison).
  route: Route;
  active: boolean;
  position: LatLng | null;
  /** The high-water mark: progress never goes below this. */
  alongM: number;
  result: RouteProgress | null;
}

export function useRouteProgress(
  route: Route,
  position: LatLng | null,
  active: boolean,
): RouteProgress | null {
  // Derived via React's adjust-state-during-render pattern (the supported
  // way to carry information between renders without effect cascades):
  // when any input changes identity, recompute once and store alongside
  // the inputs it came from.
  const [state, setState] = useState<ProgressState>({
    route,
    active,
    position,
    alongM: 0,
    result: null,
  });

  if (
    state.route === route &&
    state.active === active &&
    state.position === position
  ) {
    return state.result;
  }

  // Reset the high-water mark on session start or when the plan changes.
  const base =
    (active && !state.active) || route !== state.route ? 0 : state.alongM;
  let alongM = base;
  let result: RouteProgress | null = null;
  if (active && position && route.length > 0) {
    let hit = projectOntoRouteAhead(route, position, base, base + ADVANCE_WINDOW_M);
    if (!hit || hit.distanceM > PROGRESS_MAX_OFF_ROUTE_M) {
      // Nothing usable shortly ahead — search the whole remaining route.
      hit = projectOntoRouteAhead(route, position, base);
    }
    if (hit && hit.distanceM <= PROGRESS_MAX_OFF_ROUTE_M) {
      alongM = Math.max(base, hit.alongM);
      result = { alongM, point: hit.point, offRouteM: hit.distanceM };
    }
  }
  setState({ route, active, position, alongM, result });
  return result;
}
