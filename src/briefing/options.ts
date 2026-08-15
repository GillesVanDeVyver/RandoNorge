// What goes on the printed briefing.
//
// A briefing is handed to a particular person for a particular purpose, and
// those purposes differ: a skredkurs wall needs the terrain and the day's
// warning, a client handout is mostly route and weather, and a January tour
// cares about snow depth in a way a July one does not. So the sections are
// switchable rather than fixed.
//
// The map is not switchable. It is the one thing that makes the sheet legible
// as "this tour" rather than "a tour", and a briefing without it is a table.
//
// One dependency exists between the switches: avalanche terrain is an extra
// layer on top of steepness (runout zones and the day's Varsom warning only
// mean something next to the slope angles they apply to), so it cannot be on
// while steepness is off. `withDependencies` enforces that in one place rather
// than leaving each caller to remember it.

export interface BriefingOptions {
  /** Slope colouring on the profile and the map, plus the band breakdown. */
  steepness: boolean;
  /** Runout-zone exposure and the Varsom warning + problems for the day. */
  avalanche: boolean;
  /** seNorge snow depth along the route. */
  snow: boolean;
  /** MET forecast for the tour date, at both ends of the route. */
  weather: boolean;
  /** Ruled space for the party's own plan and turnaround decisions. */
  notes: boolean;
}

export const DEFAULT_OPTIONS: BriefingOptions = {
  steepness: true,
  avalanche: true,
  snow: true,
  weather: true,
  notes: true,
};

export const OPTION_KEYS = [
  'steepness',
  'avalanche',
  'snow',
  'weather',
  'notes',
] as const;

/**
 * Apply the one rule between switches: avalanche terrain requires steepness.
 * Turning steepness off therefore also turns avalanche terrain off, rather
 * than leaving a runout figure and a danger level stranded on a page with no
 * slope angles to read them against.
 */
export function withDependencies(opts: BriefingOptions): BriefingOptions {
  return opts.steepness ? opts : { ...opts, avalanche: false };
}

const STORAGE_KEY = 'randonorge:briefing-sections';

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
