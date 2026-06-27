import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ProfileData } from '../elevation/profile';
import type { SnowData } from '../snow/useSnow';
import { setHoverPoint } from '../hoverStore';
import { DatePopover } from './DatePopover';
import styles from './ProfilePanel.module.css';

interface ElevationProps {
  profile: ProfileData | null;
  loading: boolean;
  error: string | null;
}

interface SnowProps {
  profile: ProfileData | null;
  snow: SnowData | null;
  loading: boolean;
  error: string | null;
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

// Non-plot chrome inside the chart container. These drive the AreaChart
// margin / axis-size props AND the canvas-overlay geometry below, so the
// steepness line drawn on the canvas registers exactly with Recharts'
// plot rectangle. The axis sizes are pinned (YAxis width / XAxis height)
// to make that rectangle deterministic.
const M_LEFT = 8;
const M_RIGHT = 16;
const M_TOP = 8;
const M_BOTTOM = 4;
const Y_AXIS_W = 58;
const X_AXIS_H = 22;
const PLOT_CHROME_W = Y_AXIS_W + M_RIGHT + M_LEFT; // yAxis + right margin + left margin
const PLOT_CHROME_H = M_TOP + M_BOTTOM + X_AXIS_H;  // top margin + bottom margin + xAxis band

// Shared hover handler factory. Both charts emit map-marker updates
// from the same chartData, and Recharts' syncId="route" keeps their
// tooltip cursors aligned.
function useChartHover(chartData: ChartPoint[]) {
  const lastHoverIdx = useRef<number | null>(null);
  const onMouseMove = (e: unknown) => {
    const ev = e as { activeTooltipIndex?: string | null };
    const raw = ev?.activeTooltipIndex;
    const idx = raw != null ? Number(raw) : NaN;
    const next = Number.isFinite(idx) ? idx : null;
    if (next === lastHoverIdx.current) return;
    lastHoverIdx.current = next;
    const cp = next != null ? chartData[next] : undefined;
    if (cp && typeof cp.lat === 'number' && typeof cp.lng === 'number') {
      setHoverPoint([cp.lat, cp.lng]);
    } else {
      setHoverPoint(null);
    }
  };
  const onMouseLeave = () => {
    if (lastHoverIdx.current === null) return;
    lastHoverIdx.current = null;
    setHoverPoint(null);
  };
  return { onMouseMove, onMouseLeave };
}

export function ElevationPanel({ profile, loading, error }: ElevationProps) {
  // Live pixel size of the elevation chart container, used to size
  // the chart's height at true 1:1 metres-per-pixel so the curve's
  // visual slope reflects real terrain steepness.
  const [containerWidth, setContainerWidth] = useState(0);
  // Measure the chart container's actual pixel width via a callback
  // ref (not a useEffect). This component returns null while there
  // is no profile/loading/error, so the chart div isn't mounted on
  // the very first render — a useEffect with empty deps would only
  // fire on that first render (when the ref is null) and never re-
  // attach when the div later appears. A callback ref reliably runs
  // each time the element attaches/detaches.
  //
  // The callback also installs a ResizeObserver to catch later size
  // changes (window resize, sidebar toggles) and ignores transient
  // 0-width readings so an initial layout hiccup can't clobber a
  // previously-valid measurement.
  const roRef = useRef<ResizeObserver | null>(null);
  const chartRefCallback = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth;
      if (w > 0) setContainerWidth((prev) => (prev === w ? prev : w));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    roRef.current = ro;
  }, []);
  const chartData = useMemo(
    () => (profile ? flattenForChart(profile, null) : []),
    [profile],
  );
  // Y-axis ticks — rounded to nice intervals covering the actual
  // elevation range. The plot area height is then derived from this
  // exact domain so the round-to-nice doesn't break the 1:1 ratio.
  const yTicks = useMemo(() => {
    if (!profile) return [];
    const lo = profile.stats.minElevation;
    const hi = profile.stats.maxElevation;
    const t = niceTicks(lo, hi);
    if (t.length < 2) {
      // Degenerate (perfectly flat) profile: pad by ±0.5 m so Recharts
      // has a non-zero domain. The chart will still render as a sliver.
      return [t[0] - 0.5, t[0] + 0.5];
    }
    return t;
  }, [profile]);
  // Chart container height — sized so 1 m vertical equals 1 m horizontal
  // on screen. A 45° terrain slope therefore renders as a 45° line.
  // No min/max clamp: flat terrain produces a sliver (correctly flat),
  // steep terrain produces a tall chart (correctly steep).
  const elevChartHeight = useMemo(() => {
    if (!profile || containerWidth <= 0 || yTicks.length < 2) {
      return PLOT_CHROME_H;
    }
    const plotW = Math.max(containerWidth - PLOT_CHROME_W, 1);
    const dist = Math.max(profile.stats.distance, 1);
    const domainSpan = yTicks[yTicks.length - 1] - yTicks[0];
    const plotH = (plotW * domainSpan) / dist;
    return plotH + PLOT_CHROME_H;
  }, [profile, containerWidth, yTicks]);
  // X-domain max (route distance). Set explicitly on the XAxis below so
  // Recharts doesn't recompute "dataMax" each render, and reused by the
  // canvas overlay to map data → pixels.
  const xMax = useMemo(() => {
    let m = 0;
    for (const p of chartData) if (p.distance > m) m = p.distance;
    return m;
  }, [chartData]);

  // Colored steepness line, decimated into runs of consecutive segments
  // that share a color. Each run is a flat [d0,e0,d1,e1,…] polyline.
  // Merging same-color segments collapses the typical ~500 segments to a
  // handful of runs, drawn in a single canvas pass (effect below) instead
  // of as hundreds of SVG <ReferenceLine> components. The old approach
  // blocked the main thread — and froze the Leaflet map — while Recharts
  // committed and the browser laid out/painted the large SVG subtree.
  const steepnessRuns = useMemo(() => {
    const runs: { color: string; points: number[] }[] = [];
    let cur: { color: string; points: number[] } | null = null;
    for (let i = 0; i < chartData.length - 1; i++) {
      const a = chartData[i];
      const b = chartData[i + 1];
      if (a.elevation == null || b.elevation == null) {
        cur = null;
        continue;
      }
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
      if (cur && cur.color === color) {
        cur.points.push(b.distance, b.elevation);
      } else {
        cur = {
          color,
          points: [a.distance, a.elevation, b.distance, b.elevation],
        };
        runs.push(cur);
      }
    }
    return runs;
  }, [chartData]);

  // Draw the decimated runs onto a canvas overlay aligned with Recharts'
  // plot rectangle (geometry is deterministic thanks to the pinned axis
  // sizes / margins above). One canvas pass replaces hundreds of SVG
  // nodes, keeping the commit + paint cheap so the map stays responsive.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(containerWidth * dpr);
    canvas.height = Math.round(elevChartHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, containerWidth, elevChartHeight);
    if (yTicks.length < 2 || xMax <= 0) return;
    const yMin = yTicks[0];
    const yMax = yTicks[yTicks.length - 1];
    const plotLeft = M_LEFT + Y_AXIS_W;
    const plotRight = containerWidth - M_RIGHT;
    const plotTop = M_TOP;
    const plotBottom = elevChartHeight - M_BOTTOM - X_AXIS_H;
    const plotW = plotRight - plotLeft;
    const plotH = plotBottom - plotTop;
    if (plotW <= 0 || plotH <= 0 || yMax <= yMin) return;
    const px = (d: number) => plotLeft + (d / xMax) * plotW;
    const py = (e: number) => plotBottom - ((e - yMin) / (yMax - yMin)) * plotH;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const run of steepnessRuns) {
      const pts = run.points;
      ctx.beginPath();
      ctx.moveTo(px(pts[0]), py(pts[1]));
      for (let i = 2; i < pts.length; i += 2) {
        ctx.lineTo(px(pts[i]), py(pts[i + 1]));
      }
      ctx.strokeStyle = run.color;
      ctx.stroke();
    }
  }, [steepnessRuns, containerWidth, elevChartHeight, xMax, yTicks]);

  const hover = useChartHover(chartData);

  if (!profile && !loading && !error) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.body}>
        <div className={styles.sectionHeader}>
          {profile ? (
            <div className={styles.stats}>
              <Stat label="Distance" value={fmtKm(profile.stats.distance)} />
              <Stat label="Ascent ↗" value={fmtElev(profile.stats.ascent)} />
              <Stat label="Descent ↘" value={fmtElev(profile.stats.descent)} />
              <Stat
                label="Min / Max"
                value={`${profile.stats.minElevation} / ${profile.stats.maxElevation} m`}
              />
            </div>
          ) : (
            <span className={styles.statusText}>
              {loading ? 'Loading elevations…' : error ? `Error: ${error}` : ''}
            </span>
          )}
        </div>
        <div
          className={styles.chart}
          ref={chartRefCallback}
          style={{ height: elevChartHeight, width: '100%' }}
        >
            {loading && !profile && (
              <div className={styles.overlay}>Loading elevations…</div>
            )}
            {error && !profile && (
              <div className={styles.overlay}>Elevation unavailable</div>
            )}
            {profile && containerWidth > 0 && (
              <>
              <AreaChart
                width={containerWidth}
                height={elevChartHeight}
                data={chartData}
                syncId="route"
                margin={{ top: M_TOP, right: M_RIGHT, left: M_LEFT, bottom: M_BOTTOM }}
                onMouseMove={hover.onMouseMove}
                onMouseLeave={hover.onMouseLeave}
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
                  <CartesianGrid stroke="#f1f2f4" strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="distance"
                    type="number"
                    domain={[0, xMax]}
                    height={X_AXIS_H}
                    tickFormatter={fmtKm}
                    stroke="transparent"
                    tick={{ fill: '#9ca3af', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    dataKey="elevation"
                    domain={[yTicks[0], yTicks[yTicks.length - 1]]}
                    ticks={yTicks}
                    interval={0}
                    tickFormatter={(v) => `${Math.round(v)}`}
                    stroke="transparent"
                    tick={{ fill: '#9ca3af', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={Y_AXIS_W}
                    unit=" m"
                  />
                  <Tooltip
                    cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '3 3' }}
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
                            background: '#ffffff',
                            border: '1px solid rgba(0,0,0,0.06)',
                            borderRadius: 10,
                            padding: '8px 12px',
                            fontSize: 12,
                            lineHeight: 1.5,
                            color: '#1d1d1f',
                            fontVariantNumeric: 'tabular-nums',
                            boxShadow:
                              '0 10px 24px -8px rgba(15,23,42,0.18), 0 4px 8px -4px rgba(15,23,42,0.08)',
                          }}
                        >
                          <div
                            style={{
                              color: '#9ca3af',
                              fontSize: 10,
                              textTransform: 'uppercase',
                              letterSpacing: '0.08em',
                              fontWeight: 600,
                              marginBottom: 4,
                            }}
                          >
                            {fmtKm(label as number)}
                          </div>
                          <div style={{ fontWeight: 600 }}>
                            {Math.round(p.elevation)} m
                          </div>
                          <div style={{ color: '#6b7280' }}>Steepness {slope}</div>
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
              </AreaChart>
              {/* Colored steepness line, drawn in one canvas pass on top
                  of the SVG area fill. pointer-events:none lets the chart
                  underneath keep handling hover/tooltip. */}
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: containerWidth,
                  height: elevChartHeight,
                  pointerEvents: 'none',
                }}
              />
              </>
            )}
        </div>
      </div>
    </div>
  );
}

export function SnowPanel({
  profile,
  snow,
  loading,
  error,
  date,
  onDateChange,
}: SnowProps) {
  const chartData = useMemo(
    () => (profile ? flattenForChart(profile, snow) : []),
    [profile, snow],
  );
  const snowMax = useMemo(() => {
    let m = 0;
    for (const p of chartData) {
      if (typeof p.snow === 'number' && p.snow > m) m = p.snow;
    }
    return m;
  }, [chartData]);
  const snowTicks = useMemo(
    () => niceTicks(0, Math.max(snowMax, 50)),
    [snowMax],
  );
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const hover = useChartHover(chartData);

  if (!profile && !loading && !error) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.body}>
        <div className={`${styles.sectionHeader} ${styles.sectionHeaderRight}`}>
          <div className={styles.dateField}>
            <span className={styles.statLabel}>Snow date</span>
            <DatePopover value={date} max={today} onChange={onDateChange} />
          </div>
        </div>
        <div className={styles.chart}>
          {loading && !snow && profile && (
            <div className={styles.overlay}>Loading snow depth…</div>
          )}
          {error && !snow && profile && (
            <div className={styles.overlay}>Snow data unavailable</div>
          )}
          {profile && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                syncId="route"
                margin={{ top: 8, right: 16, left: 8, bottom: 4 }}
                onMouseMove={hover.onMouseMove}
                onMouseLeave={hover.onMouseLeave}
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
                <CartesianGrid stroke="#f1f2f4" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="distance"
                  type="number"
                  domain={[0, 'dataMax']}
                  tickFormatter={fmtKm}
                  stroke="transparent"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  dataKey="snow"
                  domain={[snowTicks[0], snowTicks[snowTicks.length - 1]]}
                  ticks={snowTicks}
                  interval={0}
                  tickFormatter={(v) => `${Math.round(v)}`}
                  stroke="transparent"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={58}
                  unit=" cm"
                />
                <Tooltip
                  cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '3 3' }}
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
                          background: '#ffffff',
                          border: '1px solid rgba(0,0,0,0.06)',
                          borderRadius: 10,
                          padding: '8px 12px',
                          fontSize: 12,
                          lineHeight: 1.5,
                          color: '#1d1d1f',
                          fontVariantNumeric: 'tabular-nums',
                          boxShadow:
                            '0 10px 24px -8px rgba(15,23,42,0.18), 0 4px 8px -4px rgba(15,23,42,0.08)',
                        }}
                      >
                        <div
                          style={{
                            color: '#9ca3af',
                            fontSize: 10,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                            fontWeight: 600,
                            marginBottom: 4,
                          }}
                        >
                          {fmtKm(label as number)}
                        </div>
                        <div style={{ fontWeight: 600 }}>Snow {snowStr}</div>
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
