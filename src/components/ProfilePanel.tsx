import { useEffect, useMemo, useRef, useState } from 'react';
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

// Vertical exaggeration of the elevation curve relative to true 1:1
// metres-per-pixel. 1 = geometrically faithful (steep terrain looks
// steep, flat terrain looks flat). Values >1 stretch the curve
// vertically; <1 would compress it.
const ELEV_EXAGGERATION = 2;
// Approximate non-plot chrome inside the chart container, used to
// derive the plot area's pixel size from the container's size.
// Matches the YAxis width and margin props on the elevation AreaChart
// below, plus a rough allowance for the bottom XAxis tick band.
const PLOT_CHROME_W = 58 + 16 + 8; // yAxis + right margin + left margin
const PLOT_CHROME_H = 8 + 4 + 22;  // top margin + bottom margin + xAxis band
// Bounds for the elevation chart's actual plotted height. The chart is
// resized to keep the plot area at true 1:1 m/px so the curve's visual
// slope reflects real terrain steepness. Without bounds, very steep
// routes would push the chart over the map and very flat routes would
// collapse to a sliver.
const ELEV_CHART_MIN_H = 240;
const ELEV_CHART_MAX_H = 720;
// Worst-case elevation range (m) used to reserve the outer container's
// height. The chart inside grows to its true-1:1 size for the route's
// actual range, with empty padding above/below filling the rest, so
// the surrounding layout stays stable regardless of terrain.
const ELEV_CHART_WORST_CASE_RANGE = 2500;
// When true, reserve outer container space for the worst-case range
// (stable layout, empty padding around small profiles). When false,
// the outer container collapses to the actual chart height.
const ELEV_CHART_RESERVE_WORST_CASE = false;

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
  // Live pixel size of the elevation chart container, used to keep the
  // y-axis at true 1:1 metres-per-pixel (modulo ELEV_EXAGGERATION) so
  // the curve's visual slope reflects real terrain steepness.
  const elevChartRef = useRef<HTMLDivElement | null>(null);
  const [elevChartSize, setElevChartSize] = useState<{ w: number; h: number }>(
    { w: 0, h: 0 },
  );
  useEffect(() => {
    const el = elevChartRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setElevChartSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const chartData = useMemo(
    () => (profile ? flattenForChart(profile, snow) : []),
    [profile, snow],
  );
  // Plot height (range, distance) -> container height needed to render
  // that elevation range at true 1:1 m/px, with ~10% headroom and the
  // chrome added on, clamped to ELEV_CHART_MIN_H..ELEV_CHART_MAX_H.
  const heightForRange = (range: number, dist: number, plotW: number) => {
    const idealPlotH = (plotW * range * ELEV_EXAGGERATION * 1.1) / dist;
    return Math.max(
      ELEV_CHART_MIN_H,
      Math.min(ELEV_CHART_MAX_H, idealPlotH + PLOT_CHROME_H),
    );
  };
  // Inner chart height — sized to the route's actual elevation range.
  const elevChartHeight = useMemo(() => {
    if (!profile || elevChartSize.w <= 0) return ELEV_CHART_MIN_H;
    const plotW = Math.max(elevChartSize.w - PLOT_CHROME_W, 1);
    const dist = Math.max(profile.stats.distance, 1);
    const range = Math.max(
      profile.stats.maxElevation - profile.stats.minElevation,
      0,
    );
    return heightForRange(range, dist, plotW);
  }, [profile, elevChartSize.w]);
  // Outer reserved height — sized assuming a worst-case 2500 m range
  // so the surrounding layout doesn't reflow when switching routes.
  // When ELEV_CHART_RESERVE_WORST_CASE is false, the outer container
  // simply collapses to the actual chart height (no padding).
  const elevReservedHeight = useMemo(() => {
    if (!ELEV_CHART_RESERVE_WORST_CASE) return elevChartHeight;
    if (!profile || elevChartSize.w <= 0) return ELEV_CHART_MAX_H;
    const plotW = Math.max(elevChartSize.w - PLOT_CHROME_W, 1);
    const dist = Math.max(profile.stats.distance, 1);
    return heightForRange(ELEV_CHART_WORST_CASE_RANGE, dist, plotW);
  }, [profile, elevChartSize.w, elevChartHeight]);
  const yTicks = useMemo(() => {
    if (!profile) return [];
    const lo = profile.stats.minElevation;
    const hi = profile.stats.maxElevation;
    const actualRange = Math.max(hi - lo, 0);
    // Y span derived from the plot's pixel size so 1 m vertical equals
    // 1 m horizontal on screen (modulo ELEV_EXAGGERATION). When the
    // route's actual range is smaller, we expand the domain (centered
    // on the midpoint) so flat terrain renders as a truly flat line.
    // When the route's range is larger than the 1:1 span — i.e. the
    // chart was bound by ELEV_CHART_MAX_H — we fall back to auto-fit so
    // the whole profile remains visible; in that case visual slope
    // becomes mildly compressed, but the curve still uses the full box.
    const plotW = Math.max(elevChartSize.w - PLOT_CHROME_W, 1);
    const plotH = Math.max(elevChartSize.h - PLOT_CHROME_H, 1);
    const dist = Math.max(profile.stats.distance, 1);
    const trueRange =
      elevChartSize.w > 0
        ? (plotH * dist) / (plotW * ELEV_EXAGGERATION)
        : 0;
    let domainLo: number;
    let domainHi: number;
    if (actualRange <= trueRange) {
      const mid = (lo + hi) / 2;
      domainLo = mid - trueRange / 2;
      domainHi = mid + trueRange / 2;
    } else {
      const pad = Math.max(actualRange, 1) * 0.05;
      domainLo = lo - pad;
      domainHi = hi + pad;
    }
    return niceTicks(domainLo, domainHi);
  }, [profile, elevChartSize]);
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
          <div className={styles.leftCol}>
            <div
              className={styles.leftElev}
              style={{ height: elevReservedHeight }}
            >
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
            </div>
            <div className={styles.leftSnow}>
              <div className={styles.dateField}>
                <span className={styles.statLabel}>Snow date</span>
                <DatePopover value={date} max={today} onChange={onDateChange} />
              </div>
            </div>
          </div>

          <div className={styles.rightCol}>
          <div
            style={{
              height: elevReservedHeight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'stretch',
            }}
          >
          <div
            className={styles.chart}
            ref={elevChartRef}
            style={{ height: elevChartHeight, flex: '0 0 auto', width: '100%' }}
          >
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

// --- Custom date picker ------------------------------------------------
// The native <input type="date"> picker varies wildly across browsers:
// some emit value-change events while the user is just browsing months
// in the popup, which would cause the map and snow layer to refetch
// before the user has actually selected a day. This minimal popover
// gives us explicit control: month chevrons only mutate the local
// view-month state, and onChange is fired exclusively when the user
// clicks a day cell.
const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtYMD = (y: number, m: number, d: number) =>
  `${y}-${pad2(m)}-${pad2(d)}`;
const fmtMDY = (s: string) => {
  const { y, m, d } = parseYMD(s);
  return `${pad2(m)}/${pad2(d)}/${y}`;
};
function parseYMD(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}
// Day-of-week of the 1st of (y, m), 0=Monday..6=Sunday
function firstDowMon(y: number, m: number) {
  return (new Date(y, m - 1, 1).getDay() + 6) % 7;
}
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function DatePopover({
  value,
  max,
  onChange,
}: {
  value: string;
  max?: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const initial = useMemo(() => parseYMD(value), [value]);
  const [view, setView] = useState<{ y: number; m: number }>({
    y: initial.y,
    m: initial.m,
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  // Reset the visible month to the selected value each time the
  // popover opens, so reopening it doesn't leave the user on a stale
  // month from a previous browsing session.
  useEffect(() => {
    if (open) {
      const p = parseYMD(value);
      setView({ y: p.y, m: p.m });
    }
  }, [open, value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const prevMonth = () =>
    setView((v) => (v.m === 1 ? { y: v.y - 1, m: 12 } : { y: v.y, m: v.m - 1 }));
  const nextMonth = () =>
    setView((v) => (v.m === 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m: v.m + 1 }));

  const dim = daysInMonth(view.y, view.m);
  const lead = firstDowMon(view.y, view.m);
  // Always render a fixed 6×7 = 42-cell grid so the popover height
  // doesn't shift between months that span 5 vs 6 calendar rows.
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);

  return (
    <div ref={wrapRef} className={styles.dateWrap}>
      <button
        type="button"
        className={styles.dateInput}
        onClick={() => setOpen((o) => !o)}
      >
        {fmtMDY(value)}
      </button>
      {open && (
        <div className={styles.datePopover} role="dialog">
          <div className={styles.popHeader}>
            <button
              type="button"
              className={styles.popNav}
              onClick={prevMonth}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className={styles.popTitle}>
              {MONTH_NAMES[view.m - 1]} {view.y}
            </span>
            <button
              type="button"
              className={styles.popNav}
              onClick={nextMonth}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
          <div className={styles.popDows}>
            {DOW_NAMES.map((d) => (
              <div key={d} className={styles.popDow}>
                {d}
              </div>
            ))}
          </div>
          <div className={styles.popGrid}>
            {cells.map((d, i) => {
              if (d === null) return <div key={i} className={styles.popEmpty} />;
              const v = fmtYMD(view.y, view.m, d);
              const disabled = max ? v > max : false;
              const selected = v === value;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  className={`${styles.popDay} ${selected ? styles.popDaySelected : ''}`}
                  onClick={() => {
                    onChange(v);
                    setOpen(false);
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
