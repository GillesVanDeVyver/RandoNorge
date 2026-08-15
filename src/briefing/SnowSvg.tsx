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

import type { ProfileData } from '../elevation/profile';
import type { SnowData } from '../snow/useSnow';
import { snowSamples, type SnowSample } from './snowSummary';
import { ticks } from './axis';
import { translate } from '../i18n/locale.ts';

const W = 1000;
const H = 120;
const PAD_L = 46;
const PAD_R = 12;
const PAD_T = 8;
const PAD_B = 24;

const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

// Flat fills rather than the screen's gradient: gradients are the first thing
// a printer driver renders badly, and they cost ink for no added meaning.
const SNOW_FILL = '#cfe0f0';
const SNOW_LINE = '#5b8bc5';

export function SnowSvg({
  profile,
  snow,
}: {
  profile: ProfileData;
  snow: SnowData | null;
}) {
  const pts = snowSamples(profile, snow).filter((p) => Number.isFinite(p.cm));
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
  const runs: SnowSample[][] = [];
  let run: SnowSample[] = [];
  let prevD = -Infinity;
  for (const p of pts) {
    // A jump much larger than the route's own sampling implies dropped points.
    if (run.length > 0 && p.d - prevD > maxD / 40) {
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
                fill={SNOW_FILL}
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
