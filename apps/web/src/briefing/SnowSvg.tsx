// Snow depth along the route, for the printed briefing.
//
// Same reasoning as ProfileSvg: a fixed-viewBox SVG rather than the screen's
// Recharts area, because print lays the page out at a width nobody measured.
// It is drawn shorter than the elevation profile — depth is a supporting fact,
// not the shape of the day — and shares the profile's x-axis conventions so
// the two charts stacked on the page line up at the same distances.
//
// The numbers that go beside it live in snowSummary.ts, which the sheet also
// reads for its key-facts panel.

import type { ProfileData } from '@fjellrute/core/elevation/profile';
import type { SnowData } from '@fjellrute/core/snow/useSnow';
import { snowSamples, type SnowSample } from './snowSummary';
import { ticks } from '@fjellrute/core/chart/axis';
import { translate } from '@fjellrute/core/i18n/locale';

const W = 1000;
const H = 120;
const PAD_L = 46;
const PAD_R = 12;
const PAD_T = 8;
const PAD_B = 24;

const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

// The planner's snowpack fill: white at the surface deepening to a cold blue at
// the ground, which is what makes a pale chart read as snow rather than as a
// generic area plot. This was a flat #cfe0f0 — chosen on the theory that a
// printer driver renders a gradient badly — but a four-stop vertical ramp is
// the one gradient case drivers do handle, and losing it made the printed chart
// the one panel on the sheet that looked nothing like the screen. The stops are
// the app's #snowFill stops at the app's offsets, nudged lighter at the deep end
// so the fill never competes with the surface line drawn on top of it.
const SNOW_FILL_ID = 'briefingSnowFill';
const SNOW_STOPS: { at: string; color: string; opacity: number }[] = [
  { at: '0%', color: '#ffffff', opacity: 0.98 },
  { at: '35%', color: '#eaf3fb', opacity: 0.95 },
  { at: '70%', color: '#c8dcee', opacity: 0.9 },
  { at: '100%', color: '#9dbedd', opacity: 0.9 },
];

// The snowpack's surface. Left at the app's exact colour and the only firm edge
// on the chart, so it is what a depth is actually read off.
//
// The screen also lays a snowflake pattern over the fill — two flakes per 28-px
// cell in white strokes. That is not carried over: the cell would come out
// around 1.5 mm on paper, where two hairline flakes inside it stop being
// snowflakes and become a grey stipple, and a stipple over a pale gradient is
// how a chart acquires moire. The gradient and this line are what carry the
// resemblance; the texture only carried the charm.
const SNOW_LINE = '#5b8bc5';

export function SnowSvg({
  profile,
  snow,
}: {
  profile: ProfileData;
  snow: SnowData | null;
}) {
  const all = snowSamples(profile, snow);
  const pts = all.filter((p) => Number.isFinite(p.cm));
  if (pts.length < 2) return null;

  const maxD = profile.stats.distance || 1;
  let maxCm = 0;
  for (const p of pts) if (p.cm > maxCm) maxCm = p.cm;
  // A bare-ground route would otherwise divide by zero; show a 10 cm scale so
  // "no snow" reads as a flat line on a real axis rather than a broken chart.
  const yMax = Math.max(10, maxCm * 1.12);

  const x = (d: number) => PAD_L + (d / maxD) * PLOT_W;
  const y = (cm: number) => PAD_T + PLOT_H - (cm / yMax) * PLOT_H;

  // Runs of consecutive points that have data, so gaps in the seNorge grid
  // print as gaps instead of being bridged by an invented straight line.
  //
  // What counts as a gap is measured against this route's own sampling, not
  // against a fraction of its length. The threshold used to be maxD / 40, which
  // silently assumed every route has at least forty samples; profile.ts
  // resamples at 20 m, so anything under about 800 m has fewer, every ordinary
  // step counted as a gap, no run reached two points, and the chart printed
  // nothing at all. The median step is taken over *all* samples including the
  // ones the grid had nothing for, so a hole cannot inflate the yardstick it is
  // about to be measured by. One dropped point leaves a step of twice the
  // median, so 1.5x separates a real hole from ordinary jitter.
  const steps: number[] = [];
  for (let i = 1; i < all.length; i++) steps.push(all[i].d - all[i - 1].d);
  steps.sort((a, b) => a - b);
  const median = steps.length > 0 ? steps[steps.length >> 1] : maxD;
  const maxStep = median * 1.5;

  const runs: SnowSample[][] = [];
  let run: SnowSample[] = [];
  let prevD = -Infinity;
  for (const p of pts) {
    if (run.length > 0 && p.d - prevD > maxStep) {
      runs.push(run);
      run = [];
    }
    run.push(p);
    prevD = p.d;
  }
  if (run.length > 0) runs.push(run);

  return (
    <svg
      className="briefingSnowSvg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={translate(
        'Snødybde langs ruta',
        'Snow depth along the route',
      )}
    >
      {/* Pinned to the plot's own top and bottom rather than to each path's
          bounding box, so a run of deep snow and a run of shallow snow are
          shaded on the same scale. Same reasoning as ProfileSvg's fill. */}
      <defs>
        <linearGradient
          id={SNOW_FILL_ID}
          gradientUnits="userSpaceOnUse"
          x1={0}
          y1={PAD_T}
          x2={0}
          y2={PAD_T + PLOT_H}
        >
          {SNOW_STOPS.map((s) => (
            <stop
              key={s.at}
              offset={s.at}
              stopColor={s.color}
              stopOpacity={s.opacity}
            />
          ))}
        </linearGradient>
      </defs>

      {ticks(0, yMax, 3).map((cm) => (
        <g key={cm}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(cm)}
            y2={y(cm)}
            className="briefingGrid"
          />
          <text
            x={PAD_L - 6}
            y={y(cm) + 4}
            className="briefingAxisText"
            textAnchor="end"
          >
            {Math.round(cm)}
          </text>
        </g>
      ))}
      <text x={PAD_L - 6} y={H - 8} className="briefingAxisUnit" textAnchor="end">
        cm
      </text>

      {runs
        .filter((r) => r.length >= 2)
        .map((r, i) => {
          const line = r.map((p) => `${x(p.d)} ${y(p.cm)}`).join(' L ');
          const base = PAD_T + PLOT_H;
          return (
            <g key={i}>
              <path
                d={`M ${x(r[0].d)} ${base} L ${line} L ${x(r[r.length - 1].d)} ${base} Z`}
                fill={`url(#${SNOW_FILL_ID})`}
              />
              <path
                d={`M ${line}`}
                fill="none"
                stroke={SNOW_LINE}
                className="briefingSnowLine"
              />
            </g>
          );
        })}
      {/* No ground line, for the same reason the profile has no baseline: the
          planner's charts have no axis lines, and the card around this SVG
          draws the edge. Here it also removes an ambiguity — a solid rule along
          the bottom of a snow-depth chart looks like the ground, which would
          make a gap in the seNorge grid read as bare ground rather than as no
          data. */}
    </svg>
  );
}
