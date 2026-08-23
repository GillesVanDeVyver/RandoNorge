// How far out the guide was looking for parking when they opened the export.
//
// The same idea as profileScale.ts, and for a sharper reason. The parking tab's
// radius is not a display preference but a search: a guide who widened it to
// 8 km did so because 3 km returned nothing, and the lots they found at 8 km are
// the ones they are driving to. A briefing that printed the 3 km answer would
// print an empty section under a heading, on a page whose whole purpose is to be
// the thing carried away from the screen.
//
// It also keeps the two live queries in step. The parking panel and the briefing
// dialog are mounted at the same time — the dialog is a portal over the planner,
// not a replacement for it — and both publish their results to the parking
// store, which is what draws the pins. Asking the same question means one
// answer; asking two questions would mean the pins flickering between them.
//
// Memory only, like the profile scale: a reload starts again from the panel's
// own default. A search radius is a fact about this session's route, not a
// setting worth carrying across weeks.

let remembered: number | null = null;

/** Called by the parking panel whenever the guide changes the radius. */
export function rememberParkingRadius(radiusM: number): void {
  remembered = radiusM;
}

/** Forget the choice — used by the tests, and by anything that wants the
 *  panel's own default back. */
export function forgetParkingRadius(): void {
  remembered = null;
}

/**
 * The radius the parking tab is currently searching at, or null when the guide
 * has not changed it this session.
 *
 * Null is not the default radius: it is "nobody has said", which lets the
 * caller fall back to its own default rather than having this module assert one
 * on its behalf.
 */
export function recallParkingRadius(): number | null {
  return remembered;
}
