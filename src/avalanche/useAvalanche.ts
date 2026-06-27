import { startTransition, useEffect, useMemo, useState } from 'react';
import type { ProfileData } from '../elevation/profile';
import { fetchAvalancheWarning, type AvalancheWarning } from './api';

export interface AvalancheState {
  // Highest danger level among the regions the route passes through. 0 means
  // every region the route touches is unassessed (e.g. out of season).
  level: number;
  // Distinct assessed regions along the route, highest danger first.
  regions: AvalancheWarning[];
  loading: boolean;
  error: string | null;
}

// How many points along the route to probe. Avalanche regions are large
// (thousands of km²), so a handful of evenly spaced samples reliably covers
// every region a single route crosses without hammering the service.
const MAX_SAMPLES = 8;

const pad2 = (n: number) => String(n).padStart(2, '0');
function todayLocalYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Evenly spaced sample points across the whole route (all segments flattened),
// quantized to ~100 m so adjacent samples in the same area collapse to one
// network lookup.
function samplePoints(profile: ProfileData): { lat: number; lng: number }[] {
  const flat: { lat: number; lng: number }[] = [];
  for (const seg of profile.segments) {
    for (const p of seg) flat.push({ lat: p.lat, lng: p.lng });
  }
  if (flat.length === 0) return [];

  const picked: { lat: number; lng: number }[] = [];
  const seen = new Set<string>();
  const step = Math.max(1, (flat.length - 1) / (MAX_SAMPLES - 1));
  for (let i = 0; i < MAX_SAMPLES; i++) {
    const p = flat[Math.min(flat.length - 1, Math.round(i * step))];
    const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(p);
  }
  return picked;
}

// Resolve the current avalanche danger for every forecast region the route
// passes through and surface the worst (highest) level.
export function useAvalanche(profile: ProfileData | null): AvalancheState {
  const date = useMemo(() => todayLocalYMD(), []);
  // useMemo keyed on the profile gives a stable `points` identity for the
  // effect below; the profile object itself is stable per route computation.
  const points = useMemo(
    () => (profile ? samplePoints(profile) : []),
    [profile],
  );

  const [state, setState] = useState<AvalancheState>({
    level: 0,
    regions: [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (points.length === 0) {
      setState({ level: 0, regions: [], loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    Promise.all(
      points.map((p) =>
        fetchAvalancheWarning(p.lat, p.lng, date, controller.signal),
      ),
    )
      .then((results) => {
        if (controller.signal.aborted) return;
        // Dedupe by region, keeping the highest level reported for each.
        const byRegion = new Map<number, AvalancheWarning>();
        for (const w of results) {
          if (!w || w.dangerLevel <= 0) continue;
          const prev = byRegion.get(w.regionId);
          if (!prev || w.dangerLevel > prev.dangerLevel) byRegion.set(w.regionId, w);
        }
        const regions = [...byRegion.values()].sort(
          (a, b) => b.dangerLevel - a.dangerLevel,
        );
        const level = regions.reduce((m, r) => Math.max(m, r.dangerLevel), 0);
        startTransition(() => {
          setState({ level, regions, loading: false, error: null });
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : 'Failed to fetch';
        startTransition(() => {
          setState({ level: 0, regions: [], loading: false, error: msg });
        });
      });

    return () => controller.abort();
  }, [points, date]);

  return state;
}
