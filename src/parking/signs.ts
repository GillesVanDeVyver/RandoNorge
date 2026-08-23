// Which sign goes where, and which one is lit: the one answer, for all four
// maps that draw parking.
//
// The list of lots lives in parking/store, the highlight in parking/hover, and
// the sign itself in parking/sign. What was missing was the small piece of
// judgement between them — the numbering, and the rule about a highlight that
// has gone stale — and it was living inside ParkingLayer, which is the one
// renderer that no longer has it to itself. Four maps now draw these signs:
//
//   - the planner's flat map (Leaflet divIcons, ParkingLayer)
//   - the planner's 3D view (a MapLibre symbol layer, Map3DParkingSigns)
//   - the briefing's flat map (canvas, briefing/staticMap.ts)
//   - the briefing's 3D map (a MapLibre symbol layer, briefing/terrainMap.ts)
//
// A numbering rule copied into four renderers is a numbering rule that will
// eventually disagree with the numbered rows in the Parking tab on one of them,
// and the reader has no way to tell which of the two is lying. So it is stated
// once, here, and every renderer asks.
//
// Nothing in this file touches a map, a store or the DOM: it turns the lots and
// the hovered id into a list of signs. That is what makes it checkable outside
// a browser — see scripts/verify-parking-signs.mjs.

import type { LatLng } from '../types';
import type { SignState } from './sign';

/** One sign: where it stands, what number it carries, and how it is drawn. */
export interface ParkingSign {
  /** 1-based list number. The badge on the plate, and the row in the Parking
   *  tab and on the printed sheet — they are the same number because they are
   *  all this one. */
  n: number;
  point: LatLng;
  state: SignState;
}

/** A sign plus the lot it belongs to, for renderers that also bind events. */
export interface ParkingSignFor extends ParkingSign {
  id: string;
}

/** The minimum a caller has to know about a lot to get a sign for it. Narrower
 *  than ParkingArea on purpose: the briefing's renderers have points and
 *  nothing else, and none of the fee/surface/capacity detail decides anything
 *  here. */
export interface Lot {
  id: string;
  point: LatLng;
}

/**
 * The signs for `areas`, numbered in the order given, with `hoveredId` lit and
 * the rest faded back.
 *
 * `areas` is the list the Parking tab shows, in the Parking tab's order, so
 * `n` is the row number the reader is looking at. Nothing here sorts or
 * filters: whoever fetched the lots decided which five they are.
 *
 * A hovered id that isn't in `areas` is ignored rather than honoured. It
 * happens for a frame whenever a re-fetch lands under the pointer — the search
 * radius changed, or the route start did — and taking it at face value would
 * fade all five signs to highlight a lot that is no longer on the map, which is
 * worse than highlighting nothing.
 */
export function parkingSigns(
  areas: readonly Lot[],
  hoveredId: string | null,
): ParkingSignFor[] {
  const lit =
    hoveredId !== null && areas.some((a) => a.id === hoveredId)
      ? hoveredId
      : null;
  return areas.map((a, i) => ({
    id: a.id,
    n: i + 1,
    point: a.point,
    state:
      a.id === lit ? 'hovered' : lit !== null ? 'dimmed' : ('plain' as const),
  }));
}

/**
 * The signs for a list of points, all drawn plain.
 *
 * For the printed sheet, which has the same five lots in the same order but no
 * pointer to hover them with. It goes through this rather than through
 * `parkingSigns` with a null id so that the paper renderers never have to
 * invent ids for lots they were only given coordinates for.
 */
export function plainParkingSigns(points: readonly LatLng[]): ParkingSign[] {
  return points.map((point, i) => ({ n: i + 1, point, state: 'plain' }));
}
