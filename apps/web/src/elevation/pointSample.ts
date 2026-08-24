import type { LatLng } from '../types';
import { fetchElevations } from './api';

// Shared terrain sampling used by both the route elevation profile
// (elevation/profile.ts) and the map cursor readout
// (components/CursorReadout.tsx), so both report the exact same
// elevation/steepness for a given point.

// Half-distance (m) between paired neighbor samples used to estimate the
// terrain gradient at a point. The Kartverket DTM is on a 10 m grid, so
// anything <= ~10 m gets lost to quantization. 30 m spans several cells in
// each direction and gives a stable slope estimate while still being local
// enough to match the Bratthet overlay visually.
export const SLOPE_SAMPLE_OFFSET_M = 30;

// The four neighbor points (N, S, E, W) at SLOPE_SAMPLE_OFFSET_M from the
// given point — the sample stencil for a central-differences gradient.
export function slopeNeighbors([lat, lng]: LatLng): [LatLng, LatLng, LatLng, LatLng] {
  const dLat = SLOPE_SAMPLE_OFFSET_M / 111320;
  const dLng =
    SLOPE_SAMPLE_OFFSET_M / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lat + dLat, lng], // N
    [lat - dLat, lng], // S
    [lat, lng + dLng], // E
    [lat, lng - dLng], // W
  ];
}

// Terrain slope (degrees) from the four neighbor elevations via central
// differences. NaN when any neighbor has no elevation data.
export function slopeFromNeighbors(
  zN: number,
  zS: number,
  zE: number,
  zW: number,
): number {
  if (
    !Number.isFinite(zN) ||
    !Number.isFinite(zS) ||
    !Number.isFinite(zE) ||
    !Number.isFinite(zW)
  ) {
    return NaN;
  }
  const twoD = 2 * SLOPE_SAMPLE_OFFSET_M;
  const dzdy = (zN - zS) / twoD;
  const dzdx = (zE - zW) / twoD;
  return (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
}

export interface ElevationSlopeSample {
  // Meters above sea level; NaN when the DTM has no data here (e.g. sea).
  elevation: number;
  // Terrain slope in degrees; NaN when unknown.
  slopeDeg: number;
}

// Fetch elevation + terrain steepness for a single arbitrary point. One
// batched request of 5 points (center + N/S/E/W stencil); fetchElevations'
// quantized cache makes repeated hovers over the same spot free.
export async function fetchElevationSlope(
  point: LatLng,
  signal?: AbortSignal,
): Promise<ElevationSlopeSample> {
  const [z, zN, zS, zE, zW] = await fetchElevations(
    [point, ...slopeNeighbors(point)],
    signal,
  );
  return { elevation: z, slopeDeg: slopeFromNeighbors(zN, zS, zE, zW) };
}
