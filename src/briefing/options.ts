// What goes on the printed briefing.
//
// A briefing is handed to a particular person for a particular purpose, and
// those purposes differ: a skredkurs wall needs the terrain and the day's
// warning, a client handout is mostly route and weather, and a January tour
// cares about snow depth in a way a July one does not. So every section is
// switchable, the map included — a route table with no picture is a legitimate
// thing to want, and a switch that cannot be switched is furniture.
//
// What is never optional is the route's identity: its name, the day, the
// distance and the climb. Those are what make the sheet this tour rather than
// a tour, and they cost two centimetres.
//
// One dependency exists between the switches: steepness is a way of drawing
// the elevation profile, not a section of its own, so it cannot be on while
// the profile is off. `withDependencies` enforces that in one place rather
// than leaving each caller to remember it.

export interface BriefingOptions {
  /** Static Kartverket map with the route drawn over it. */
  map: boolean;
  /** Print that map as the planner's tilted 3D terrain view rather than the
   *  flat north-up one. Not a section of its own — the same frame in the same
   *  place, drawn from the same tiles by a different renderer. */
  map3d: boolean;
  /** Elevation profile along the route. */
  elevation: boolean;
  /** Slope colouring on the profile and the map, the band breakdown, and
   *  runout-zone exposure. */
  steepness: boolean;
  /** The day's Varsom danger level and avalanche problems. */
  avalanche: boolean;
  /** seNorge snow depth along the route. */
  snow: boolean;
  /** MET forecast for the tour date, at both ends of the route. */
  weather: boolean;
  /** Ruled space for the party's own plan and turnaround decisions. */
  notes: boolean;
}

export const DEFAULT_OPTIONS: BriefingOptions = {
  map: true,
  // Off by default. A north-up map is the one a party can navigate from, and
  // the 3D view is the one that explains the shape of the day — which of those
  // a briefing needs is a judgement about its reader, so the sheet does not
  // guess, and the plain answer is the one that is right more often.
  map3d: false,
  elevation: true,
  steepness: true,
  avalanche: true,
  snow: true,
  weather: true,
  notes: true,
};

/** Print order, which is also the order the switches are listed in. */
export const OPTION_KEYS = [
  'map',
  'map3d',
  'elevation',
  'steepness',
  'avalanche',
  'snow',
  'weather',
  'notes',
] as const;

/**
 * Apply the rules between switches. Both are of the same kind: a switch that
 * describes *how* something else is drawn cannot outlive the thing it draws.
 * Steepness is a way of colouring the elevation profile, and 3D is a way of
 * rendering the map, so turning either of those off takes its modifier with it
 * rather than leaving a slope-angle breakdown on a page with no profile, or a
 * remembered "in 3D" waiting to surprise the next person who switches the map
 * back on.
 */
export function withDependencies(opts: BriefingOptions): BriefingOptions {
  const out = { ...opts };
  if (!out.elevation) out.steepness = false;
  if (!out.map) out.map3d = false;
  return out;
}

// Bumped when the set of switches changed: a remembered selection from the
// old set has no opinion about the map or the profile, and silently defaulting
// those to "off" would hand someone a blank sheet.
//
// Not bumped for the 3D switch, deliberately: a v2 record has no opinion about
// it either, and the default it falls back to — off — is precisely the sheet
// that record was written to describe. Only a new switch whose default *adds*
// or *removes* something needs everyone's preferences thrown away.
const STORAGE_KEY = 'randonorge:briefing-sections-v2';

/** Remembered selection, so a guide printing a stack of briefings sets the
 *  switches once. Unknown or corrupt storage falls back to the defaults. */
export function loadOptions(): BriefingOptions {
  if (typeof window === 'undefined') return DEFAULT_OPTIONS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_OPTIONS;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_OPTIONS;
    const rec = parsed as Record<string, unknown>;
    const out = { ...DEFAULT_OPTIONS };
    for (const key of OPTION_KEYS) {
      if (typeof rec[key] === 'boolean') out[key] = rec[key];
    }
    return withDependencies(out);
  } catch {
    // Private mode, quota, or a hand-edited value: defaults are always valid.
    return DEFAULT_OPTIONS;
  }
}

export function storeOptions(opts: BriefingOptions): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {
    // Persistence is a convenience; the print itself must not depend on it.
  }
}
