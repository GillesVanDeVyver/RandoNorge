// Avalanche danger ("snøskredvarsel") from NVE's Varsom warning service —
// the same forecast shown on senorge.no. The AvalancheWarningByCoordinates
// endpoint resolves a (lat, lon) to the avalanche forecast region it falls in
// and returns that region's daily warning, including the EAWS danger level
// (1–5; "0" / empty means the region is not assessed, e.g. outside the
// winter season).
//
// Varsom's host does not send CORS headers, so in the browser we go through
// the Vite dev proxy (see vite.config.ts) which rewrites the `/varsom-api`
// prefix to https://api01.nve.no.

// langKey 2 → English MainText / region descriptions.
const ENDPOINT =
  '/varsom-api/hydrology/forecast/avalanche/v6.3.2/api/AvalancheWarningByCoordinates/Simple';

export interface AvalancheWarning {
  regionId: number;
  regionName: string;
  dangerLevel: number; // 0 = not assessed, 1–5 = EAWS danger level
}

interface VarsomWarning {
  RegionId: number;
  RegionName: string;
  DangerLevel: string; // "0".."5"
}

// Quantized (lat,lon,date) → warning. Avalanche regions are large, but route
// points are quantized only to ~100 m so two nearby samples that straddle a
// region border still resolve independently.
const cache = new Map<string, AvalancheWarning | null>();

function cacheKey(lat: number, lon: number, date: string): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}@${date}`;
}

// Fetch the avalanche warning for the region containing (lat, lon) on the
// given date (YYYY-MM-DD). Returns null when the service reports no warning
// for that point/date.
export async function fetchAvalancheWarning(
  lat: number,
  lon: number,
  date: string,
  signal?: AbortSignal,
): Promise<AvalancheWarning | null> {
  const key = cacheKey(lat, lon, date);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const url = `${ENDPOINT}/${lat.toFixed(4)}/${lon.toFixed(4)}/2/${date}/${date}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Avalanche API ${res.status}`);
  const data = (await res.json()) as VarsomWarning[];

  const w = data[0];
  const result: AvalancheWarning | null = w
    ? {
        regionId: w.RegionId,
        regionName: w.RegionName,
        dangerLevel: Number.parseInt(w.DangerLevel, 10) || 0,
      }
    : null;

  cache.set(key, result);
  return result;
}
