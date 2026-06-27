// Avalanche danger ("snøskredvarsel") from NVE's Varsom warning service —
// the same forecast shown on senorge.no. The AvalancheWarningByCoordinates
// endpoint resolves a (lat, lon) to the avalanche forecast region it falls in
// and returns that region's daily warning, including the EAWS danger level
// (1–5; "0" / empty means the region is not assessed, e.g. outside the
// winter season) and the avalanche problems Varsom has identified.
//
// We use the "Detail" variant so a single request yields both the danger
// level and the avalanche-problem breakdown (type, weak layer, likelihood,
// trigger sensitivity, size, distribution, exposed aspects/elevations).
//
// Varsom's host does not send CORS headers, so in the browser we go through
// the Vite dev proxy (see vite.config.ts) which rewrites the `/varsom-api`
// prefix to https://api01.nve.no.

// langKey 2 → English text / names.
const ENDPOINT =
  '/varsom-api/hydrology/forecast/avalanche/v6.3.2/api/AvalancheWarningByCoordinates/Detail';

export interface AvalancheProblem {
  typeId: number; // AvalancheProblemTypeId (e.g. 30 = persistent weak layer)
  typeName: string;
  cause: string; // weak layer / AvalCauseName
  probability: string; // AvalProbabilityName, e.g. "Likely"
  sensitivity: string; // AvalTriggerSimpleName, e.g. "Easy to trigger"
  size: string; // DestructiveSizeExtName, e.g. "2 - Medium"
  distribution: string; // AvalPropagationName, e.g. "Some steep slopes"
  summary: string; // human-readable sentence combining the above
  // 8-char bitstring of valid aspects, clockwise from N: N,NE,E,SE,S,SW,W,NW.
  expositions: string;
  exposedHeight1: number;
  exposedHeight2: number;
  exposedHeightFill: number; // 1–4, see AvalancheProblems component
}

export interface AvalancheWarning {
  regionId: number;
  regionName: string;
  dangerLevel: number; // 0 = not assessed, 1–5 = EAWS danger level
  mainText: string;
  problems: AvalancheProblem[];
}

interface VarsomProblem {
  AvalancheProblemTypeId: number;
  AvalancheProblemTypeName: string;
  AvalCauseName: string;
  AvalProbabilityName: string;
  AvalTriggerSimpleName: string;
  DestructiveSizeExtName: string;
  AvalPropagationName: string;
  TriggerSenitivityPropagationDestuctiveSizeText: string;
  ValidExpositions: string;
  ExposedHeight1: number;
  ExposedHeight2: number;
  ExposedHeightFill: number;
}

interface VarsomWarning {
  RegionId: number;
  RegionName: string;
  DangerLevel: string; // "0".."5"
  MainText: string;
  AvalancheProblems: VarsomProblem[] | null;
}

// Quantized (lat,lon,date) → warning. Avalanche regions are large, but route
// points are quantized only to ~100 m so two nearby samples that straddle a
// region border still resolve independently.
const cache = new Map<string, AvalancheWarning | null>();

function cacheKey(lat: number, lon: number, date: string): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}@${date}`;
}

function mapProblem(p: VarsomProblem): AvalancheProblem {
  return {
    typeId: p.AvalancheProblemTypeId,
    typeName: p.AvalancheProblemTypeName,
    cause: p.AvalCauseName,
    probability: p.AvalProbabilityName,
    sensitivity: p.AvalTriggerSimpleName,
    size: p.DestructiveSizeExtName,
    distribution: p.AvalPropagationName,
    summary: (p.TriggerSenitivityPropagationDestuctiveSizeText ?? '').trim(),
    expositions: p.ValidExpositions ?? '',
    exposedHeight1: p.ExposedHeight1,
    exposedHeight2: p.ExposedHeight2,
    exposedHeightFill: p.ExposedHeightFill,
  };
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
        mainText: w.MainText ?? '',
        problems: (w.AvalancheProblems ?? []).map(mapProblem),
      }
    : null;

  cache.set(key, result);
  return result;
}
