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
// Some of the switches depend on others: steepness and true scale are ways of
// drawing the elevation profile, not sections of their own, so neither can be
// on while the profile is off, and 3D is the same relationship to the map.
// `withDependencies` enforces that in one place rather than leaving each caller
// to remember it.
//
// One of them is not a switch at all. The planner drapes one of three things
// over its base map — bratthet, snødybde, or nothing — and the sheet offers the
// same three, because a briefing that shows a different map from the one the
// tour was planned on is a briefing about a different tour. Three states cannot
// be a boolean, so `mapOverlay` is the one option here that is a choice.

import type { Overlay } from '../types';

export interface BriefingOptions {
  /** Static Kartverket map with the route drawn over it. */
  map: boolean;
  /** Print that map as the planner's tilted 3D terrain view rather than the
   *  flat north-up one. Not a section of its own — the same frame in the same
   *  place, drawn from the same tiles by a different renderer. */
  map3d: boolean;
  /** What is draped over the printed map: slope shading, snow depth, or the
   *  bare topo sheet. The planner's own three-way overlay choice, offered here
   *  in the same three states.
   *
   *  Deliberately independent of `steepness` below. They used to be the same
   *  switch, which meant a guide who wanted the slope-band breakdown in the
   *  text also had to accept a map painted orange, and one who wanted a clean
   *  map to draw on lost the breakdown with it. They are two different
   *  questions — what the picture shows, and what the profile and the numbers
   *  under it are about — so they are two different controls. */
  mapOverlay: Overlay;
  /** Elevation profile along the route. */
  elevation: boolean;
  /** Slope colouring on the elevation profile, the band breakdown, and
   *  runout-zone exposure. Not the map — see `mapOverlay`. */
  steepness: boolean;
  /** Draw the profile with a metre up the same length as a metre along, so a
   *  45° slope prints as a 45° line and the strip is as tall as the terrain
   *  makes it. Off prints the fixed-height strip, relief stretched to fill it.
   *  Like 3D, a way of drawing a section rather than a section of its own. */
  trueScale: boolean;
  /** The day's Varsom danger level and avalanche problems. */
  avalanche: boolean;
  /** seNorge snow depth along the route. */
  snow: boolean;
  /** MET forecast for the tour date, at both ends of the route. */
  weather: boolean;
  /** Where NVDB says the car can be left, nearest the route start.
   *
   *  The one section that answers a question from before the tour rather than
   *  during it, which is exactly why it earns a place on paper: the sheet is
   *  read in the kitchen the night before at least as often as at the
   *  trailhead. */
  parking: boolean;
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
  // The fallback only, in the same sense as trueScale below: the dialog opens
  // on whatever the planner is currently draping over its map, and this is what
  // the planner itself starts on.
  mapOverlay: 'steepness',
  elevation: true,
  steepness: true,
  // Off by default only in the sense that this is the fallback: the dialog
  // opens on whichever scale the profile panel is being read at, and this is
  // the panel's own default, for a session where nobody has touched it.
  trueScale: false,
  avalanche: true,
  snow: true,
  weather: true,
  // On by default, but the dialog switches it off by itself when NVDB returned
  // nothing — the same courtesy the avalanche switch pays an unrated tour. A
  // heading over "no registered parking areas" is a section that costs paper to
  // say nothing.
  parking: true,
  notes: true,
};

/** Every option that is simply on or off. `mapOverlay` is the exception, and
 *  naming the rest as a group is what lets the code that treats options as a
 *  set of flags — remembering them, sweeping every combination in the tests —
 *  keep doing so without pretending a three-way choice is a flag. */
export type BooleanOptionKey = Exclude<keyof BriefingOptions, 'mapOverlay'>;

/** Print order, which is also the order the switches are listed in. */
export const OPTION_KEYS: readonly BooleanOptionKey[] = [
  'map',
  'map3d',
  'elevation',
  'steepness',
  'trueScale',
  'avalanche',
  'snow',
  'weather',
  'parking',
  'notes',
] as const;

/**
 * Apply the rules between switches. They are all of the same kind: a switch
 * that describes *how* something else is drawn cannot outlive the thing it
 * draws. Steepness colours the elevation profile and true scale sets its
 * height, and 3D is a way of rendering the map, so turning the profile or the
 * map off takes their modifiers with them rather than leaving a slope-angle
 * breakdown on a page with no profile, or a remembered "in 3D" waiting to
 * surprise the next person who switches the map back on.
 *
 * `mapOverlay` is not forced to 'none' with the map, even though it describes
 * how the map is drawn, because the two reasons for doing that to the others
 * are both absent here. There is nothing stranded on the page — an absent map
 * paints no overlay — and nothing is remembered, so no stale choice can lie in
 * wait. Blanking it would only mean a guide who switched the map off and back
 * on found their overlay silently changed. The dialog greys the control out
 * instead, which says the same thing without throwing the answer away.
 */
export function withDependencies(opts: BriefingOptions): BriefingOptions {
  const out = { ...opts };
  if (!out.elevation) out.steepness = false;
  if (!out.elevation) out.trueScale = false;
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
//
// Bumped to v3 for the parking switch, by that same rule and reluctantly: it
// defaults on, so a v2 record — written to describe a sheet with no parking
// section — would silently grow one. The alternative was to default it off,
// which would have hidden the section from everyone who had ever printed a
// briefing, i.e. exactly the people it is for.
const STORAGE_KEY = 'randonorge:briefing-sections-v3';

/** The switches worth carrying to the next export.
 *
 *  All of them but one. The profile's vertical scale is inherited from the
 *  panel on screen every time the dialog opens (see profileScale.ts), so a
 *  stored copy could only ever be a stale answer to a question that has already
 *  been asked afresh — and the first time the two disagreed, the sheet would
 *  look like it had ignored the toggle the guide had just used. Left out of
 *  storage rather than written and then overruled, so there is nothing to
 *  wonder about.
 *
 *  Two, counting the map overlay, which is inherited from the planner the same
 *  way and left out of storage for the same reason. It gets there by not being
 *  in OPTION_KEYS at all rather than by being filtered out here, which is the
 *  one benefit of it not being a switch. */
const REMEMBERED_KEYS = OPTION_KEYS.filter((k) => k !== 'trueScale');

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
    for (const key of REMEMBERED_KEYS) {
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
    const keep: Record<string, boolean> = {};
    for (const key of REMEMBERED_KEYS) keep[key] = opts[key];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
  } catch {
    // Persistence is a convenience; the print itself must not depend on it.
  }
}
