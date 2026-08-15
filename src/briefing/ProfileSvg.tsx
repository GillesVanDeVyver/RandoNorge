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

import type { ProfileData } from '../elevation/profile';
import { RUNOUT_UNKNOWN } from '../elevation/runout';
import { GRAY, RUNOUT_COLORS, steepnessColor } from '../elevation/steepness';
import { ticks } from './axis';
import { translate } from '../i18n/locale.ts';

// Viewport units. The SVG is scaled to the page by CSS, so these are just the
// internal coordinate system — chosen wide and short to suit a landscape strip.
const W = 1000;
const H = 210;
const PAD_L = 46;
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 26;

const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

/** Colour of the profile line when steepness is switched off: the planner's
 *  own route teal, so the line reads as "the route" and nothing more. */
const PLAIN_COLOR = '#0f766e';

interface Props {
  profile: ProfileData;
  /** Colour the line by slope angle. Off prints a plain elevation profile. */
  steepness?: boolean;
  /** Let NVE's runout blues override otherwise-benign terrain. Only meaningful
   *  with `steepness` on; the sheet keeps the two switches in step. */
  runout?: boolean;
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
  let minE = Infinity;
  let maxE = -Infinity;
  for (const seg of segs) {
    for (const p of seg) {
      if (p.e < minE) minE = p.e;
      if (p.e > maxE) maxE = p.e;
    }
  }
  // Give a flat route a sane vertical span instead of dividing by zero.
  if (maxE - minE < 20) {
    const mid = (maxE + minE) / 2;
    minE = mid - 10;
    maxE = mid + 10;
  }
  // Breathing room above the summit so the line never touches the frame.
  const headroom = (maxE - minE) * 0.08;
  const yMin = minE - headroom;
  const yMax = maxE + headroom;

  const x = (d: number) => PAD_L + (d / maxD) * PLOT_W;
  const y = (e: number) =>
    PAD_T + PLOT_H - ((e - yMin) / (yMax - yMin)) * PLOT_H;

  const yTicks = ticks(yMin, yMax, 4);
  const xTicks = ticks(0, maxD, 6);

  // Colour for the stretch between two points: steepness band, with NVE's
  // runout blue overriding terrain that is otherwise flat enough to read as
  // benign. Unknown runout is left gray — never recoloured as "safe".
  const strokeFor = (a: Pt, b: Pt): string => {
    if (!steepness) return PLAIN_COLOR;
    const aS = Number.isFinite(a.slope) ? a.slope : NaN;
    const bS = Number.isFinite(b.slope) ? b.slope : NaN;
    const slope = Number.isNaN(aS)
      ? bS
      : Number.isNaN(bS)
        ? aS
        : (aS + bS) / 2;
    let color = Number.isFinite(slope) ? steepnessColor(slope) : GRAY;
    if (
      runout &&
      color === GRAY &&
      a.runout !== RUNOUT_UNKNOWN &&
      b.runout !== RUNOUT_UNKNOWN
    ) {
      const lvl = Math.min(a.runout, b.runout);
      if (lvl > 0) color = RUNOUT_COLORS[lvl];
    }
    return color;
  };

  return (
    <svg
      className="briefingProfileSvg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={
        steepness
          ? translate(
              'Høydeprofil farget etter terrenghelling',
              'Elevation profile coloured by terrain steepness',
            )
          : translate('Høydeprofil', 'Elevation profile')
      }
    >
      {/* Horizontal guides + elevation labels */}
      {yTicks.map((e) => (
        <g key={`y${e}`}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(e)}
            y2={y(e)}
            className="briefingGrid"
          />
          <text x={PAD_L - 6} y={y(e) + 4} className="briefingAxisText" textAnchor="end">
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
        // Filled body under the line: neutral, so the coloured crest reads as
        // the information-carrying element.
        const area =
          `M ${x(seg[0].d)} ${y(seg[0].e)} ` +
          seg
            .slice(1)
            .map((p) => `L ${x(p.d)} ${y(p.e)}`)
            .join(' ') +
          ` L ${x(seg[seg.length - 1].d)} ${PAD_T + PLOT_H}` +
          ` L ${x(seg[0].d)} ${PAD_T + PLOT_H} Z`;
        return (
          <g key={si}>
            <path d={area} className="briefingProfileArea" />
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

      {/* Plot frame drawn last so it sits above the fill */}
      <line
        x1={PAD_L}
        x2={W - PAD_R}
        y1={PAD_T + PLOT_H}
        y2={PAD_T + PLOT_H}
        className="briefingAxis"
      />
    </svg>
  );
}
