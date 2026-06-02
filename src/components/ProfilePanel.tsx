import { useMemo, useState } from 'react';
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
  const out: { distance: number; elevation: number | null }[] = [];
  for (let s = 0; s < profile.segments.length; s++) {
    const seg = profile.segments[s];
    if (s > 0 && seg.length > 0) {
      out.push({ distance: seg[0].distance, elevation: null });
    }
    for (const p of seg) {
      out.push({
        distance: p.distance,
        elevation: Number.isFinite(p.elevation) ? p.elevation : null,
      });
    }
  }
  return out;
}

const fmtKm = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
const fmtElev = (m: number) => `${Math.round(m)} m`;

export function ProfilePanel({ profile, loading, error }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const chartData = useMemo(
    () => (profile ? flattenForChart(profile) : []),
    [profile],
  );

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
                >
                  <defs>
                    <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#E91E63" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#E91E63" stopOpacity={0.05} />
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
                    type="monotone"
                    dataKey="elevation"
                    stroke="#E91E63"
                    strokeWidth={2}
                    fill="url(#elevFill)"
                    connectNulls={false}
                    isAnimationActive={false}
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
