// Elevation profile for the printable briefing, drawn as a plain inline SVG.
//
// The on-screen chart (ProfilePanel) uses Recharts inside a ResponsiveContainer
// that measures the DOM to size itself. That is exactly the wrong mechanism for
// printing: the print renderer lays the page out at a different width than the
// screen, and a measured-at-screen-size chart either clips or collapses. A
// fixed-viewBox SVG has no such dependency — it scales cleanly to whatever the
// page gives it and prints as vectors rather than pixels.
//
// The colour rule is deliberately identical to the chart's (elevation/steepness
// bands, with NVE's runout blues overriding otherwise-flat terrain), so the
// paper matches what the planner showed.
//
// So is the vertical scale, which the chart lets the reader choose between and
// the sheet therefore has to be able to draw both ways. "Fit" is a fixed strip
// with the relief stretched into it — every tour the same shape, which is why
// it is the one that always reads. "True" makes a metre up as long as a metre
// along, so the strip's own proportions are the tour's: a 45° slope is a 45°
// line, and a page can be handed to a party who will believe what they see on
// it. Only the plot's height and the number of elevations there is room to
// label change between them; nothing about the drawing itself does.

import type { ProfileData } from '@fjellrute/core/elevation/profile';
import {
  elevationExtent,
  segmentStyle,
} from '@fjellrute/core/elevation/profileChart';
import { ticks } from '@fjellrute/core/chart/axis';
import { translate } from '@fjellrute/core/i18n/locale';

// Viewport units. The SVG is scaled to the page by CSS, so these are just the
// internal coordinate system — chosen wide and short to suit a landscape strip.
const W = 1000;
const PAD_L = 46;
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 26;

const PLOT_W = W - PAD_L - PAD_R;

/** Height of the plot when the strip is a fixed height and the relief is
 *  stretched to fill it — the sheet's original and default shape, and the one
 *  the 29 mm in briefing.css was chosen for. */
const FIT_PLOT_H = 174;

/** Vertical room one elevation label needs: the 11-unit type of briefingAxisText
 *  plus enough air that two of them read as two numbers rather than as a
 *  smudge. Used to decide how many of the axis's ticks can be numbered, which
 *  at true scale is a question the terrain answers — a long valley approach
 *  drawn honestly is a strip a couple of millimetres tall, and four numbers do
 *  not fit in it however much the domain would like them to. */
const LABEL_PITCH = 16;

/** Colour of the profile line when steepness is switched off: the planner's
 *  own route teal, so the line reads as "the route" and nothing more. */
const PLAIN_COLOR = '#0f766e';

/** The planner's terrain fill, lightened for paper.
 *
 *  The chart on screen runs a top-lit earth ramp — #a89072 at 55% opacity down
 *  through #7a624a and #544334 to #332821 at 95% — and that ramp is most of what
 *  makes the profile recognisable as the app's. Printed as-is it fails twice:
 *  the bottom two-thirds become a solid block of toner across the widest
 *  element on the page, and the dark red (#730000) and dark blue (#004DA8) ends
 *  of the steepness and runout scales drawn on top of it stop being visible at
 *  all. Every stop is therefore taken up in lightness and down in opacity,
 *  keeping the ramp's direction and its warmth. The four stops are the app's
 *  four, at the app's offsets. */
const ELEV_FILL_ID = 'briefingElevFill';
const ELEV_STOPS: { at: string; color: string; opacity: number }[] = [
  { at: '0%', color: '#d8cbb8', opacity: 0.5 },
  { at: '35%', color: '#c0ae97', opacity: 0.58 },
  { at: '70%', color: '#a89681', opacity: 0.66 },
  { at: '100%', color: '#8f7d6b', opacity: 0.72 },
];

interface Props {
  profile: ProfileData;
  /** Colour the line by slope angle. Off prints a plain elevation profile. */
  steepness?: boolean;
  /** Let NVE's runout blues override otherwise-benign terrain. Only meaningful
   *  with `steepness` on; the sheet keeps the two switches in step. */
  runout?: boolean;
  /** Draw a metre of climb the same length as a metre of ground, so a 45° slope
   *  prints as a 45° line — the planner's "Riktig skala". The strip is then as
   *  tall as the terrain makes it, which is the whole point: a tour's shape is
   *  information, and a fixed height throws it away by making every tour the
   *  same shape. Off draws the fixed strip, relief stretched to fill it. */
  trueScale?: boolean;
}

/** At most `keep` of `values`, evenly spread and including both ends.
 *
 *  The same thinning the on-screen chart does to its elevation labels, for the
 *  same reason: the domain decides which elevations are worth a line, and the
 *  height available decides how many of them there is room to say. Fewer than
 *  two is never useful — a single number gives the reader no scale — so two is
 *  the floor, and where even two will not fit inside the plot the caller moves
 *  them out of it rather than dropping one. */
function pickEvenly(values: number[], keep: number): number[] {
  if (values.length <= keep) return values;
  const n = values.length;
  const out: number[] = [];
  for (let i = 0; i < keep; i++) {
    const v = values[Math.round((i * (n - 1)) / (keep - 1))];
    if (out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

interface Pt {
  d: number; // distance, metres
  e: number; // elevation, metres
  slope: number;
  runout: number;
}

export function ProfileSvg({
  profile,
  steepness = true,
  runout = true,
  trueScale = false,
}: Props) {
  // Only segments with usable elevations can be drawn.
  const segs: Pt[][] = profile.segments
    .map((seg) =>
      seg
        .filter((p) => Number.isFinite(p.elevation))
        .map((p) => ({
          d: p.distance,
          e: p.elevation,
          slope: p.slopeDeg,
          runout: p.runoutLevel,
        })),
    )
    .filter((seg) => seg.length >= 2);

  if (segs.length === 0) {
    return (
      <p className="briefingEmpty">
        {translate(
          'Høydeprofil utilgjengelig for denne ruta.',
          'Elevation profile unavailable for this route.',
        )}
      </p>
    );
  }

  const maxD = profile.stats.distance || 1;
  // A flat route widened to a sane vertical span instead of dividing by zero,
  // then breathing room above the summit so the line never touches the frame.
  // Core's, because the phone's profile sizes its plot the same way and a
  // second opinion about how tall a flat tour looks is a second app.
  const { min: yMin, max: yMax } = elevationExtent(
    segs.flatMap((seg) => seg.map((p) => p.e)),
  );

  // At true scale the height of the plot is not a design decision but a
  // measurement: the vertical span drawn in the same units per metre as the
  // horizontal one. The tiny floor is arithmetic hygiene, not a clamp — a plot
  // of zero height divides by zero, and one unit is a fifth of a millimetre on
  // paper. Nothing else is clamped: a flat approach prints as the thread it is
  // and a wall prints tall, which is what asking for true scale asks for.
  const plotH = trueScale
    ? Math.max(((yMax - yMin) * PLOT_W) / maxD, 1)
    : FIT_PLOT_H;

  // How many elevations can be numbered without them piling up, and where those
  // numbers go. Below one label's worth of height there is no room for even the
  // two ends inside the plot, so they move outside it — the top number above the
  // strip and the bottom number below — and the padding grows to hold them,
  // including enough at the foot that they do not land in the distance axis.
  const labelsOutside = plotH < LABEL_PITCH;
  const padT = labelsOutside ? 16 : PAD_T;
  const padB = labelsOutside ? PAD_B + 14 : PAD_B;
  const H = padT + plotH + padB;

  const x = (d: number) => PAD_L + (d / maxD) * PLOT_W;
  const y = (e: number) =>
    padT + plotH - ((e - yMin) / (yMax - yMin)) * plotH;

  const yTicks = ticks(yMin, yMax, 4);
  const xTicks = ticks(0, maxD, 6);

  // Which of those ticks are drawn at all. Gridline and number are thinned
  // together: a dashed line with no number against it says nothing, and the
  // point of thinning is that the axis stays readable, not that it stays busy.
  // Evenly spread and always keeping both ends, so what survives is the range.
  const shownTicks = pickEvenly(
    yTicks,
    Math.max(2, Math.floor(plotH / LABEL_PITCH) + 1),
  );

  // Colour for the stretch between two points: steepness band, with NVE's
  // runout blue overriding terrain that is otherwise flat enough to read as
  // benign. Unknown runout is left gray — never recoloured as "safe".
  //
  // The rule is core's, shared with the planner's chart and the phone's. It
  // returns a `dashed` flag as well, which this renderer drops: a printed page
  // has no hover and no legend beside the line, so a dashed stretch would be an
  // unexplained one. What the flag would have said is said in words instead —
  // the sheet prints a "data unavailable" note whenever the profile contains
  // unknown slope or unknown runout. Adopting the shared rule did change one
  // case on paper: a stretch with unknown slope inside a known runout zone used
  // to print solid blue and now prints grey, because an unknown slope stays
  // unknown however much else is known about the ground.
  const strokeFor = (a: Pt, b: Pt): string =>
    segmentStyle(
      { slopeDeg: a.slope, runoutLevel: a.runout },
      { slopeDeg: b.slope, runoutLevel: b.runout },
      { steepness, runout, plainColor: PLAIN_COLOR },
    ).color;

  return (
    <svg
      className="briefingProfileSvg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      // The stylesheet gives the strip a fixed 29 mm, which is exactly what
      // "fit to view" means. True scale cannot accept a height from anywhere:
      // the drawing is only 1:1 if a unit is the same size across as it is up,
      // so the box has to take the viewBox's own proportions. Stated as an
      // aspect ratio rather than a height because the width is the page's to
      // decide — paper, margins and the sheet's zoom all have a say in it.
      style={
        trueScale ? { height: 'auto', aspectRatio: `${W} / ${H}` } : undefined
      }
      role="img"
      aria-label={
        (steepness
          ? translate(
              'Høydeprofil farget etter terrenghelling',
              'Elevation profile coloured by terrain steepness',
            )
          : translate('Høydeprofil', 'Elevation profile')) +
        // Worth saying: at true scale the shape of the strip is itself the
        // information, and a reader who cannot see it is owed the fact that
        // the numbers and the picture are for once the same claim.
        (trueScale
          ? translate(', i riktig målestokk', ', at true scale')
          : '')
      }
    >
      {/* One gradient for the whole plot, in user space rather than the default
          object-bounding-box units. A route with gaps is drawn as several area
          paths, and a bounding-box gradient would restart in each of them — so
          a short segment over a narrow height range would print the full ramp
          in a few millimetres while the long segment beside it printed it over
          thirty. Pinning the stops to the plot's own top and bottom makes the
          shading mean elevation, which is what it means on screen. */}
      <defs>
        <linearGradient
          id={ELEV_FILL_ID}
          gradientUnits="userSpaceOnUse"
          x1={0}
          y1={padT}
          x2={0}
          y2={padT + plotH}
        >
          {ELEV_STOPS.map((s) => (
            <stop
              key={s.at}
              offset={s.at}
              stopColor={s.color}
              stopOpacity={s.opacity}
            />
          ))}
        </linearGradient>
      </defs>

      {/* Horizontal guides + elevation labels. The gridline is always at the
          elevation it stands for; only the number moves, and only when the
          strip is too thin to hold it — which it can be at true scale, where a
          long gentle tour is honestly a few millimetres tall. The line is then
          what ties the number to its height, over a distance small enough that
          there is nothing else it could be pointing at. */}
      {shownTicks.map((e, i) => (
        <g key={`y${e}`}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(e)}
            y2={y(e)}
            className="briefingGrid"
          />
          <text
            x={PAD_L - 6}
            y={
              !labelsOutside
                ? y(e) + 4
                : i === 0
                  ? padT + plotH + 12 // lowest tick, under the strip
                  : padT - 5 // highest tick, over it
            }
            className="briefingAxisText"
            textAnchor="end"
          >
            {Math.round(e)}
          </text>
        </g>
      ))}

      {/* Distance labels along the base */}
      {xTicks.map((d) => (
        <text
          key={`x${d}`}
          x={x(d)}
          y={H - 8}
          className="briefingAxisText"
          textAnchor="middle"
        >
          {maxD >= 3000 ? `${(d / 1000).toFixed(1)}` : `${Math.round(d)}`}
        </text>
      ))}
      <text x={PAD_L - 6} y={H - 8} className="briefingAxisUnit" textAnchor="end">
        {maxD >= 3000 ? 'km' : 'm'}
      </text>

      {segs.map((seg, si) => {
        // Filled body under the line, in the earth ramp defined above. Pale
        // enough throughout that the coloured crest still reads as the
        // information-carrying element.
        const area =
          `M ${x(seg[0].d)} ${y(seg[0].e)} ` +
          seg
            .slice(1)
            .map((p) => `L ${x(p.d)} ${y(p.e)}`)
            .join(' ') +
          ` L ${x(seg[seg.length - 1].d)} ${padT + plotH}` +
          ` L ${x(seg[0].d)} ${padT + plotH} Z`;
        return (
          <g key={si}>
            <path d={area} fill={`url(#${ELEV_FILL_ID})`} />
            {seg.slice(1).map((p, i) => {
              const a = seg[i];
              return (
                <line
                  key={i}
                  x1={x(a.d)}
                  y1={y(a.e)}
                  x2={x(p.d)}
                  y2={y(p.e)}
                  stroke={strokeFor(a, p)}
                  className="briefingProfileLine"
                />
              );
            })}
          </g>
        );
      })}
      {/* No baseline. The planner's chart draws neither axis lines nor a frame —
          the dashed gridlines and the labels are the whole of its furniture —
          and the card the sheet now puts around this SVG supplies the edge the
          baseline was standing in for. */}
    </svg>
  );
}
