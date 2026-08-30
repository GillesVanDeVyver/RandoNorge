// What an elevation profile looks like, for every renderer that draws one.
//
// Three now draw the same chart from the same ProfileData and no two of them
// share a drawing API: the planner's on-screen chart is Recharts plus a canvas
// overlay, the printed briefing is a fixed-viewBox inline SVG, and the phone
// (Phase 2 of docs/mobile-web-parity-plan.md) is react-native-svg. What they
// have in common is not code — it is the *decisions*: which colour a stretch of
// terrain gets, when a stretch is drawn dashed because nobody actually knows,
// what "the ground" is coloured with, and how much air to leave above the
// summit. Those decisions are what this file holds.
//
// They were duplicated before the phone existed, and had already drifted in a
// way nobody had noticed: given a stretch whose slope is unknown but whose
// runout level is known and non-zero, the screen drew dashed grey ("we do not
// know this") and the sheet printed solid runout blue ("this is a runout
// zone"). Both are defensible readings and that is exactly the problem — the
// planner and the page it exports were making different claims about the same
// metre of snow. The rule below is the screen's, because an unknown slope is
// unknown regardless of what else is known about the ground, and a chart that
// resolves doubt in the direction of a definite-looking colour is the wrong
// chart to hand a party at a trailhead. The printed sheet has no dashes, so it
// now prints that case grey; grey with a "data unavailable" note under it is a
// smaller lie than blue.
//
// Nothing here renders. It returns colours, flags and numbers, and each of the
// three renderers turns those into whatever its own API calls a line.

import { RUNOUT_UNKNOWN } from './runout';
import { GRAY, RUNOUT_COLORS, steepnessColor } from './steepness';

/** The two facts about a profile point that decide how the stretch leaving it
 *  is coloured. Deliberately narrower than `ProfilePoint` so a renderer can
 *  hand over its own flattened chart row without converting it first — the
 *  screen chart's rows carry a `snow` and a nullable `elevation` that this has
 *  no business knowing about. */
export interface SlopePoint {
  /** Terrain slope at the point, degrees. NaN when the neighbour-elevation
   *  lookup failed there — never treat NaN as flat. */
  slopeDeg: number;
  /** NVE runout severity, or RUNOUT_UNKNOWN when the lookup failed. */
  runoutLevel: number;
}

/** Mean terrain slope of the stretch between two profile points.
 *
 *  Falls back to whichever endpoint has a finite slope, and returns NaN only
 *  when both are unknown. Callers must render NaN as unverified data and never
 *  as flat terrain: 0° and "we could not measure it" are the two readings a
 *  profile must never conflate, because one of them is an invitation to walk
 *  under something. */
export function segmentSlope(a: SlopePoint, b: SlopePoint): number {
  const aS = Number.isFinite(a.slopeDeg) ? a.slopeDeg : NaN;
  const bS = Number.isFinite(b.slopeDeg) ? b.slopeDeg : NaN;
  if (Number.isFinite(aS) && Number.isFinite(bS)) return (aS + bS) / 2;
  if (Number.isFinite(aS)) return aS;
  if (Number.isFinite(bS)) return bS;
  return NaN;
}

/** How to stroke one stretch of the profile line. */
export interface SegmentStyle {
  color: string;
  /** True when something about the stretch is unknown rather than known — an
   *  unmeasurable slope, or a runout lookup that failed. A renderer that can
   *  dash must dash; one that cannot (the printed sheet) must say so in words
   *  somewhere on the same page. */
  dashed: boolean;
}

export interface SegmentStyleOptions {
  /** Colour the line by slope angle. Off draws the whole profile in
   *  `plainColor` — the route as a shape, with no claim about the terrain. */
  steepness?: boolean;
  /** Let NVE's runout blues override terrain that is otherwise flat enough to
   *  read as benign. Only meaningful with `steepness` on.
   *
   *  A client with no runout data at all should pass `false` rather than let
   *  every flat stretch come back dashed: "unknown" repeated five hundred times
   *  along a valley floor is noise, and the honest form of it is one sentence
   *  next to the chart. apps/mobile does exactly that — it has no raster
   *  sampler, so `hasRasterSampler()` is false and there is nothing to
   *  override with. */
  runout?: boolean;
  /** The line's colour when `steepness` is off. Defaults to the route teal
   *  darkened for legibility over the terrain fill. */
  plainColor?: string;
}

/** The profile line when it is not saying anything about steepness: the route
 *  teal taken down in lightness, because #2dd4bf over the earth ramp is a pale
 *  line on a mid-brown ground. */
export const PLAIN_PROFILE_COLOR = '#0f766e';

/** Colour and dash for the stretch between two points.
 *
 *  The rule, in order: the slope band; then NVE's runout blue where the band
 *  came out flat-grey and both ends are inside a modelled runout polygon, at
 *  the *lower* of the two severities so a boundary reads conservatively; and
 *  never either of those where the slope itself is unknown. */
export function segmentStyle(
  a: SlopePoint,
  b: SlopePoint,
  { steepness = true, runout = true, plainColor }: SegmentStyleOptions = {},
): SegmentStyle {
  if (!steepness) {
    return { color: plainColor ?? PLAIN_PROFILE_COLOR, dashed: false };
  }
  const slope = segmentSlope(a, b);
  const known = Number.isFinite(slope);
  let color = known ? steepnessColor(slope) : GRAY;
  let dashed = !known;
  if (runout && color === GRAY) {
    if (a.runoutLevel === RUNOUT_UNKNOWN || b.runoutLevel === RUNOUT_UNKNOWN) {
      // "No data" must not end up looking identical to "verified outside every
      // zone", which is what solid grey means two lines up.
      dashed = true;
    } else if (known) {
      const lvl = Math.min(a.runoutLevel, b.runoutLevel);
      if (lvl > 0) color = RUNOUT_COLORS[lvl];
    }
  }
  return { color, dashed };
}

/** One stop of a vertical gradient, as a fraction of the plot's height. */
export interface FillStop {
  /** 0 at the top of the plot, 1 at the bottom. */
  at: number;
  color: string;
  opacity: number;
}

/** The ground under the line: a top-lit earth ramp, light where the light
 *  falls and nearly black at depth.
 *
 *  This is most of what makes a Fjellrute profile recognisable at a glance, and
 *  it is a picture of soil rather than a token from the palette, which is why
 *  it lives beside the chart logic instead of in either app's theme. The four
 *  stops and their offsets are the ones the planner has always used.
 *
 *  Print does NOT use these — see ProfileSvg's lightened set, and the reason
 *  there: at these values the lower two-thirds of the widest element on the
 *  page becomes a solid block of toner, and the dark ends of the steepness and
 *  runout scales drawn on top of it stop being visible at all. Same ramp,
 *  same direction, different medium. */
export const ELEV_FILL_STOPS: readonly FillStop[] = [
  { at: 0, color: '#a89072', opacity: 0.55 },
  { at: 0.35, color: '#7a624a', opacity: 0.7 },
  { at: 0.7, color: '#544334', opacity: 0.85 },
  { at: 1, color: '#332821', opacity: 0.95 },
];

/** The vertical span a profile should be drawn over, in metres. */
export interface ElevationExtent {
  min: number;
  max: number;
}

/** Turn the elevations actually present into a domain worth drawing.
 *
 *  Two corrections, both about routes the naive domain renders as a lie. A
 *  route flatter than 20 m end to end has its span widened to 20 m around the
 *  midpoint: without it a lakeside ski-in with 3 m of relief is stretched to
 *  fill the plot and prints as a mountain range, and a perfectly flat one
 *  divides by zero. Then 8% of the span is added at each end so the summit
 *  never touches the frame — a line that runs along the top edge reads as a
 *  line that was clipped.
 *
 *  Used by every renderer that sizes its own plot: the briefing's SVG and the
 *  phone's. The planner's on-screen chart does not — it hands the domain to
 *  Recharts as nice tick values instead, because it also has to keep the tick
 *  spacing and the 1:1 true-scale height consistent with each other. */
export function elevationExtent(
  elevations: Iterable<number>,
  { minSpan = 20, headroomFraction = 0.08 } = {},
): ElevationExtent {
  let min = Infinity;
  let max = -Infinity;
  for (const e of elevations) {
    if (!Number.isFinite(e)) continue;
    if (e < min) min = e;
    if (e > max) max = e;
  }
  // Nothing drawable. Return a domain rather than Infinities so the caller's
  // arithmetic stays finite; it should be checking whether it has points to
  // draw before it gets here, and this makes the failure a flat empty plot
  // instead of a crash or a chart full of NaN coordinates.
  if (min > max) return { min: 0, max: minSpan };
  if (max - min < minSpan) {
    const mid = (max + min) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
  }
  const headroom = (max - min) * headroomFraction;
  return { min: min - headroom, max: max + headroom };
}
