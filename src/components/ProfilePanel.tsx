import { useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ProfileData } from '../elevation/profile';
import { setHoverPoint } from '../hoverStore';
import styles from './ProfilePanel.module.css';

interface Props {
  profile: ProfileData | null;
  loading: boolean;
  error: string | null;
}

// Flatten multi-segment profile to a single Recharts-friendly array.
// Insert a null-elevation entry between segments so the line renders
// as a discontinuous chart with gaps where the eraser cut the route.
function flattenForChart(profile: ProfileData) {
  const out: {
    distance: number;
    elevation: number | null;
    slopeDeg: number;
    lat: number | null;
    lng: number | null;
    runoutLevel: number;
  }[] = [];
  for (let s = 0; s < profile.segments.length; s++) {
    const seg = profile.segments[s];
    if (s > 0 && seg.length > 0) {
      out.push({
        distance: seg[0].distance,
        elevation: null,
        slopeDeg: NaN,
        lat: null,
        lng: null,
        runoutLevel: 0,
      });
    }
    for (const p of seg) {
      out.push({
        distance: p.distance,
        elevation: Number.isFinite(p.elevation) ? p.elevation : null,
        slopeDeg: p.slopeDeg,
        lat: p.lat,
        lng: p.lng,
        runoutLevel: p.runoutLevel,
      });
    }
  }
  return out;
}

const fmtKm = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
const fmtElev = (m: number) => `${Math.round(m)} m`;

// NVE Bratthet 2024 color bands — same as the map overlay.
// Class 1 (< 27°) is transparent on the map; we use a neutral gray on the
// chart so the line stays visible against a white background.
const GRAY = '#666666';
// NVE Bratthet_med_utlop_2024 layer 2/3/4 fill colors (decoded from the
// service legend). Indexed by RunoutLevel: 0 unused, 1=long, 2=medium,
// 3=short runout.
const RUNOUT_COLORS = ['', '#9AB1E6', '#4C9BFF', '#004DA8'];
const STEEPNESS_BANDS: { max: number; color: string }[] = [
  { max: 27, color: GRAY },
  { max: 30, color: '#38a800' },
  { max: 35, color: '#ffff00' },
  { max: 40, color: '#ffaa00' },
  { max: 45, color: '#ff5500' },
  { max: 50, color: '#ff0000' },
  { max: Infinity, color: '#730000' },
];

function steepnessColor(deg: number): string {
  for (const b of STEEPNESS_BANDS) if (deg < b.max) return b.color;
  return STEEPNESS_BANDS[STEEPNESS_BANDS.length - 1].color;
}

type ChartPoint = {
  distance: number;
  elevation: number | null;
  slopeDeg: number;
  lat: number | null;
  lng: number | null;
  runoutLevel: number;
};

// Mean terrain slope of the segment between two chart points (used to pick
// a color). Falls back to whichever endpoint has a finite slope; if both
// are NaN, returns 0 (gray).
function segmentSlope(a: ChartPoint, b: ChartPoint): number {
  const aS = Number.isFinite(a.slopeDeg) ? a.slopeDeg : NaN;
  const bS = Number.isFinite(b.slopeDeg) ? b.slopeDeg : NaN;
  if (Number.isFinite(aS) && Number.isFinite(bS)) return (aS + bS) / 2;
  if (Number.isFinite(aS)) return aS;
  if (Number.isFinite(bS)) return bS;
  return 0;
}

// Generate round, evenly-spaced tick values covering [min, max] with
// step sizes from the 1/2/5 × 10ⁿ "nice" set. Targets ~5 ticks.
function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return [Math.round(min)];
  }
  const rawStep = (max - min) / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / magnitude;
  const step =
    (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * magnitude;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + 1e-9; v += step) ticks.push(Math.round(v));
  return ticks;
}

export function ProfilePanel({ profile, loading, error }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  // Track the last-emitted hover index so we don't fire setHoverPoint for
  // every sub-pixel mouse move when the cursor is still on the same data
  // point.
  const lastHoverIdx = useRef<number | null>(null);
  const chartData = useMemo(
    () => (profile ? flattenForChart(profile) : []),
    [profile],
  );
  const yTicks = useMemo(
    () =>
      profile
        ? niceTicks(profile.stats.minElevation, profile.stats.maxElevation)
        : [],
    [profile],
  );
  // Build a colored ReferenceLine per chart segment. ReferenceLine.segment
  // takes data-space coordinates so we don't depend on Recharts' internal
  // scale objects (which changed in v3 and are no longer exposed via
  // Customized).
  const segmentLines = useMemo(() => {
    const lines: { key: number; x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
    for (let i = 0; i < chartData.length - 1; i++) {
      const a = chartData[i];
      const b = chartData[i + 1];
      if (a.elevation == null || b.elevation == null) continue;
      let color = steepnessColor(segmentSlope(a, b));
      // Override the "flat terrain" gray with NVE's runout-zone blue when
      // both endpoints fall inside a modeled snow-avalanche runout polygon.
      // Colored (steep) segments keep their steepness color. Picking the
      // lower severity of the two endpoints (lighter blue) keeps the chart
      // visually conservative at boundaries.
      if (color === GRAY) {
        const lvl = Math.min(a.runoutLevel, b.runoutLevel);
        if (lvl > 0) color = RUNOUT_COLORS[lvl];
      }
      lines.push({
        key: i,
        x1: a.distance,
        y1: a.elevation,
        x2: b.distance,
        y2: b.elevation,
        color,
      });
    }
    return lines;
  }, [chartData]);

  if (!profile && !loading && !error) return null;

  return (
    <div
      className={`${styles.panel} ${collapsed ? styles.collapsed : ''}`}
    >
      <button
        type="button"
        className={styles.collapseBtn}
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? 'Expand profile' : 'Collapse profile'}
      >
        {collapsed ? '▲' : '▼'}
      </button>

      {!collapsed && (
        <div className={styles.body}>
          <div className={styles.stats}>
            {profile ? (
              <>
                <Stat label="Distance" value={fmtKm(profile.stats.distance)} />
                <Stat
                  label="Ascent"
                  value={fmtElev(profile.stats.ascent)}
                  color="#2e7d32"
                />
                <Stat
                  label="Descent"
                  value={fmtElev(profile.stats.descent)}
                  color="#c62828"
                />
                <Stat
                  label="Min / Max"
                  value={`${profile.stats.minElevation} / ${profile.stats.maxElevation} m`}
                />
              </>
            ) : (
              <span className={styles.statusText}>
                {loading ? 'Loading elevations…' : error ? `Error: ${error}` : ''}
              </span>
            )}
          </div>

          <div className={styles.chart}>
            {loading && !profile && (
              <div className={styles.overlay}>Loading elevations…</div>
            )}
            {error && !profile && (
              <div className={styles.overlay}>Elevation unavailable</div>
            )}
            {profile && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 8, right: 16, left: 8, bottom: 4 }}
                  onMouseMove={(e: unknown) => {
                    // Recharts 3.x: activeTooltipIndex is a numeric string
                    // ("0".."N") or null when the cursor is outside the
                    // plot area. activePayload no longer exists.
                    const ev = e as { activeTooltipIndex?: string | null };
                    const raw = ev?.activeTooltipIndex;
                    const idx = raw != null ? Number(raw) : NaN;
                    const next = Number.isFinite(idx) ? idx : null;
                    if (next === lastHoverIdx.current) return;
                    lastHoverIdx.current = next;
                    const cp = next != null ? chartData[next] : undefined;
                    if (
                      cp &&
                      typeof cp.lat === 'number' &&
                      typeof cp.lng === 'number'
                    ) {
                      setHoverPoint([cp.lat, cp.lng]);
                    } else {
                      setHoverPoint(null);
                    }
                  }}
                  onMouseLeave={() => {
                    if (lastHoverIdx.current === null) return;
                    lastHoverIdx.current = null;
                    setHoverPoint(null);
                  }}
                >
                  <defs>
                    <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#999" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#999" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e0e0e0" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="distance"
                    type="number"
                    domain={[0, 'dataMax']}
                    tickFormatter={fmtKm}
                    stroke="#666"
                    fontSize={11}
                  />
                  <YAxis
                    dataKey="elevation"
                    domain={[yTicks[0], yTicks[yTicks.length - 1]]}
                    ticks={yTicks}
                    interval={0}
                    tickFormatter={(v) => `${Math.round(v)}`}
                    stroke="#666"
                    fontSize={11}
                    width={40}
                    unit=" m"
                  />
                  <Tooltip
                    formatter={(v: number) => [`${Math.round(v)} m`, 'Elev.']}
                    labelFormatter={(d: number) => fmtKm(d)}
                  />
                  <Area
                    type="linear"
                    dataKey="elevation"
                    stroke="transparent"
                    fill="url(#elevFill)"
                    connectNulls={false}
                    isAnimationActive={false}
                    activeDot={false}
                  />
                  {segmentLines.map((s) => (
                    <ReferenceLine
                      key={s.key}
                      segment={[
                        { x: s.x1, y: s.y1 },
                        { x: s.x2, y: s.y2 },
                      ]}
                      stroke={s.color}
                      strokeWidth={2.5}
                      ifOverflow="extendDomain"
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue} style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}
