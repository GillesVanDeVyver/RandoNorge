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
import type { SnowData } from '../snow/useSnow';
import { setHoverPoint } from '../hoverStore';
import styles from './ProfilePanel.module.css';

interface Props {
  profile: ProfileData | null;
  loading: boolean;
  error: string | null;
  snow: SnowData | null;
  snowLoading: boolean;
  snowError: string | null;
  date: string;
  onDateChange: (date: string) => void;
}

// Flatten multi-segment profile to a single Recharts-friendly array.
// Insert a null-elevation entry between segments so the line renders
// as a discontinuous chart with gaps where the eraser cut the route.
function flattenForChart(profile: ProfileData, snow: SnowData | null) {
  const out: {
    distance: number;
    elevation: number | null;
    slopeDeg: number;
    lat: number | null;
    lng: number | null;
    runoutLevel: number;
    snow: number | null;
  }[] = [];
  for (let s = 0; s < profile.segments.length; s++) {
    const seg = profile.segments[s];
    const snowSeg = snow?.depths[s];
    if (s > 0 && seg.length > 0) {
      out.push({
        distance: seg[0].distance,
        elevation: null,
        slopeDeg: NaN,
        lat: null,
        lng: null,
        runoutLevel: 0,
        snow: null,
      });
    }
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i];
      const sd = snowSeg?.[i];
      out.push({
        distance: p.distance,
        elevation: Number.isFinite(p.elevation) ? p.elevation : null,
        slopeDeg: p.slopeDeg,
        lat: p.lat,
        lng: p.lng,
        runoutLevel: p.runoutLevel,
        snow: typeof sd === 'number' && Number.isFinite(sd) ? sd : null,
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
  snow: number | null;
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

export function ProfilePanel({
  profile,
  loading,
  error,
  snow,
  snowLoading,
  snowError,
  date,
  onDateChange,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  // Track the last-emitted hover index so we don't fire setHoverPoint for
  // every sub-pixel mouse move when the cursor is still on the same data
  // point.
  const lastHoverIdx = useRef<number | null>(null);
  const chartData = useMemo(
    () => (profile ? flattenForChart(profile, snow) : []),
    [profile, snow],
  );
  const yTicks = useMemo(
    () =>
      profile
        ? niceTicks(profile.stats.minElevation, profile.stats.maxElevation)
        : [],
    [profile],
  );
  const snowMax = useMemo(() => {
    let m = 0;
    for (const p of chartData) {
      if (typeof p.snow === 'number' && p.snow > m) m = p.snow;
    }
    return m;
  }, [chartData]);
  const snowTicks = useMemo(
    () => (snowMax > 0 ? niceTicks(0, snowMax) : [0, 10]),
    [snowMax],
  );
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
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
            <div className={styles.dateField}>
              <span className={styles.statLabel}>Snow date</span>
              <input
                type="date"
                lang="en-GB"
                className={styles.dateInput}
                value={date}
                max={today}
                onChange={(e) => onDateChange(e.target.value)}
              />
            </div>
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
                  syncId="route"
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
                    {/* Rock-like fill: weathered tan at the ridge, darker
                        granite/basalt tones at depth. Stops are tuned to
                        keep the colored steepness ReferenceLines on top
                        clearly visible. */}
                    <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a89072" stopOpacity={0.55} />
                      <stop offset="35%" stopColor="#7a624a" stopOpacity={0.7} />
                      <stop offset="70%" stopColor="#544334" stopOpacity={0.85} />
                      <stop offset="100%" stopColor="#332821" stopOpacity={0.95} />
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
                    width={58}
                    unit=" m"
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const p = payload[0].payload as ChartPoint;
                      if (p.elevation == null) return null;
                      const slope = Number.isFinite(p.slopeDeg)
                        ? `${p.slopeDeg.toFixed(1)}°`
                        : '–';
                      return (
                        <div
                          style={{
                            background: 'rgba(255,255,255,0.95)',
                            border: '1px solid #ccc',
                            padding: '4px 8px',
                            fontSize: 12,
                            lineHeight: 1.4,
                          }}
                        >
                          <div style={{ color: '#666' }}>
                            {fmtKm(label as number)}
                          </div>
                          <div>Elevation: {Math.round(p.elevation)} m</div>
                          <div>Steepness: {slope}</div>
                        </div>
                      );
                    }}
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
                      strokeWidth={4}
                      ifOverflow="extendDomain"
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className={styles.chart}>
            {snowLoading && !snow && profile && (
              <div className={styles.overlay}>Loading snow depth…</div>
            )}
            {snowError && !snow && profile && (
              <div className={styles.overlay}>Snow data unavailable</div>
            )}
            {profile && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  syncId="route"
                  margin={{ top: 8, right: 16, left: 8, bottom: 4 }}
                  onMouseMove={(e: unknown) => {
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
                    {/* Snow-like fill: bright sun-lit surface up top, soft
                        blue snow-shadow in the body, fading to a deeper
                        firn/ice blue at depth. */}
                    <linearGradient id="snowFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity={0.98} />
                      <stop offset="35%" stopColor="#eaf3fb" stopOpacity={0.95} />
                      <stop offset="70%" stopColor="#bcd6ec" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#7fa8cf" stopOpacity={0.9} />
                    </linearGradient>
                    {/* Snowflake tile, stamped over the gradient via a
                        second Area layer. Two snowflakes per 28×28 cell at
                        different sizes give a non-mechanical scatter. */}
                    <pattern
                      id="snowflakePattern"
                      x="0"
                      y="0"
                      width="28"
                      height="28"
                      patternUnits="userSpaceOnUse"
                    >
                      <g
                        transform="translate(8,9)"
                        stroke="#ffffff"
                        strokeWidth="0.8"
                        strokeLinecap="round"
                        opacity="0.9"
                      >
                        <line x1="0" y1="-5" x2="0" y2="5" />
                        <line x1="-4.33" y1="-2.5" x2="4.33" y2="2.5" />
                        <line x1="-4.33" y1="2.5" x2="4.33" y2="-2.5" />
                        {/* barbs on the top arm */}
                        <line x1="-1.2" y1="-3.5" x2="0" y2="-2.3" />
                        <line x1="1.2" y1="-3.5" x2="0" y2="-2.3" />
                        {/* barbs on the bottom arm */}
                        <line x1="-1.2" y1="3.5" x2="0" y2="2.3" />
                        <line x1="1.2" y1="3.5" x2="0" y2="2.3" />
                        {/* barbs on the NE arm */}
                        <line x1="3.2" y1="-2.6" x2="2.0" y2="-1.15" />
                        <line x1="3.9" y1="-1.2" x2="2.0" y2="-1.15" />
                        {/* barbs on the SW arm */}
                        <line x1="-3.2" y1="2.6" x2="-2.0" y2="1.15" />
                        <line x1="-3.9" y1="1.2" x2="-2.0" y2="1.15" />
                      </g>
                      <g
                        transform="translate(21,21)"
                        stroke="#ffffff"
                        strokeWidth="0.65"
                        strokeLinecap="round"
                        opacity="0.7"
                      >
                        <line x1="0" y1="-3.2" x2="0" y2="3.2" />
                        <line x1="-2.77" y1="-1.6" x2="2.77" y2="1.6" />
                        <line x1="-2.77" y1="1.6" x2="2.77" y2="-1.6" />
                      </g>
                    </pattern>
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
                    dataKey="snow"
                    domain={[snowTicks[0], snowTicks[snowTicks.length - 1]]}
                    ticks={snowTicks}
                    interval={0}
                    tickFormatter={(v) => `${Math.round(v)}`}
                    stroke="#666"
                    fontSize={11}
                    width={58}
                    unit=" cm"
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const p = payload[0].payload as ChartPoint;
                      const snowStr =
                        typeof p.snow === 'number'
                          ? `${Math.round(p.snow)} cm`
                          : '–';
                      return (
                        <div
                          style={{
                            background: 'rgba(255,255,255,0.95)',
                            border: '1px solid #ccc',
                            padding: '4px 8px',
                            fontSize: 12,
                            lineHeight: 1.4,
                          }}
                        >
                          <div style={{ color: '#666' }}>
                            {fmtKm(label as number)}
                          </div>
                          <div>Snow depth: {snowStr}</div>
                        </div>
                      );
                    }}
                  />
                  {/* Base snowpack — gradient fill with the surface line. */}
                  <Area
                    type="monotone"
                    dataKey="snow"
                    stroke="#5b8bc5"
                    strokeWidth={1.25}
                    fill="url(#snowFill)"
                    connectNulls={false}
                    isAnimationActive={false}
                    activeDot={{ r: 3 }}
                  />
                  {/* Snowflake stamps, clipped to the snowpack area. */}
                  <Area
                    type="monotone"
                    dataKey="snow"
                    stroke="none"
                    fill="url(#snowflakePattern)"
                    connectNulls={false}
                    isAnimationActive={false}
                    activeDot={false}
                    legendType="none"
                  />
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
