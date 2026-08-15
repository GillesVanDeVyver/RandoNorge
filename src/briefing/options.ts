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
  'elevation',
  'steepness',
  'avalanche',
  'snow',
  'weather',
  'notes',
] as const;

/**
 * Apply the one rule between switches: steepness requires the elevation
 * profile. Turning the profile off therefore also turns steepness off, rather
 * than leaving a slope-angle breakdown on a page with no profile to read it
 * against.
 */
export function withDependencies(opts: BriefingOptions): BriefingOptions {
  return opts.elevation ? opts : { ...opts, steepness: false };
}

// Bumped when the set of switches changed: a remembered selection from the
// old set has no opinion about the map or the profile, and silently defaulting
// those to "off" would hand someone a blank sheet.
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
