import { apiUrl } from '../net/base.ts';

// Hourly weather forecast from MET Norway's Locationforecast service
// (the data behind yr.no). Single request per (lat, lon, altitude) returns
// ~10 days of hourly data; we cache it client-side keyed on the quantized
// coordinates so route panning around the same area doesn't re-fetch.
//
// The endpoint requires an identifying User-Agent header, and MET's terms make
// it a condition of use rather than a nicety. Browsers don't let fetch() set
// User-Agent, so the request goes through the Vite dev proxy (see
// vite.config.ts) in development and the Worker in production; both rewrite
// /metno-api → https://api.met.no and stamp the header server-side.
//
// React Native's fetch WOULD let the app set User-Agent itself, but the phone
// goes through the same proxy anyway. The identifying string is a deployment
// fact, not an app fact — it has to change when the contact address does — and
// the Worker also carries the edge cache MET asks callers to keep. A phone
// calling api.met.no directly would be a second, unnamed, uncached client of a
// service that logs who its callers are.
const ENDPOINT = '/metno-api/weatherapi/locationforecast/2.0/compact';

export interface WeatherHour {
  time: string; // ISO timestamp, UTC, hour-aligned
  temperature: number; // °C
  windSpeed: number; // m/s
  windGust: number | null; // m/s, if reported
  windFromDeg: number; // direction the wind is blowing FROM, degrees
  symbolCode: string | null; // e.g. "partlycloudy_day"
  /** Expected precipitation over the next `precipHours` — usually one hour, but
   *  not always, so read the two together. */
  precipMm: number | null;
  precipMinMm: number | null;
  precipMaxMm: number | null;
  /** How many hours the three precipitation figures above cover: 1 when MET
   *  published a next_1_hours block for this entry, 6 when only the coarser
   *  next_6_hours was available, null when neither was.
   *
   *  MET publishes hourly for roughly the first two days and then switches to
   *  entries every six hours, and those carry no next_1_hours at all. Reading
   *  only next_1_hours therefore left every far-out entry with no precipitation
   *  whatsoever, which is what the fallback is for — but a six-hour total must
   *  never be shown as an hourly rate, so the window travels with the numbers
   *  instead of being assumed by whoever reads them.
   *
   *  Optional because snapshots captured before this field existed are replayed
   *  exactly as they were stored; treat a missing value as 1, which is what
   *  those entries always were. */
  precipHours?: 1 | 6 | null;
}

interface MetNoTimeseries {
  time: string;
  data: {
    instant: {
      details: {
        air_temperature: number;
        wind_from_direction: number;
        wind_speed: number;
        wind_speed_of_gust?: number;
      };
    };
    next_1_hours?: {
      summary?: { symbol_code?: string };
      details?: {
        precipitation_amount?: number;
        precipitation_amount_min?: number;
        precipitation_amount_max?: number;
      };
    };
    next_6_hours?: {
      summary?: { symbol_code?: string };
      details?: {
        precipitation_amount?: number;
        precipitation_amount_min?: number;
        precipitation_amount_max?: number;
      };
    };
  };
}

interface MetNoResponse {
  properties: { timeseries: MetNoTimeseries[] };
}

export interface ForecastResult {
  hours: WeatherHour[];
  // Epoch ms of when this forecast was actually retrieved from MET. Cache
  // hits keep their original retrieval time so the UI can show honest data
  // age (mirrors the avalanche panel's fetchedAt).
  fetchedAt: number;
}

// (lat,lon quantized to 3 decimals ≈ ~100 m) → cached forecast.
// Entries expire after CACHE_TTL_MS: MET updates Locationforecast roughly
// hourly, and a session-long cache would silently serve an outdated forecast
// for as long as the tab stays open — dangerous for a trip-planning tool.
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; hours: WeatherHour[] }>();

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

export async function fetchForecast(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<ForecastResult> {
  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { hours: cached.hours, fetchedAt: cached.at };
  }

  // Same-origin on the web (apiUrl is the identity until setApiBase runs),
  // absolute against the Worker on the phone. See snow/api.ts's fetchCell for
  // why this carries no auth headers.
  const url = apiUrl(`${ENDPOINT}?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Weather API ${res.status}`);
  const data = (await res.json()) as MetNoResponse;

  const hours: WeatherHour[] = data.properties.timeseries.map((ts) => {
    const det = ts.data.instant.details;
    const n1 = ts.data.next_1_hours;
    const n6 = ts.data.next_6_hours;
    const sym = n1?.summary?.symbol_code ?? n6?.summary?.symbol_code ?? null;
    // Hourly where MET has it, its six-hour block where it does not. Never both
    // added together: the blocks overlap the hours they contain, so preferring
    // one and recording which is the only way the figure stays a fact.
    const pDet = n1?.details ?? n6?.details;
    const pHours: 1 | 6 | null =
      n1?.details != null ? 1 : n6?.details != null ? 6 : null;
    return {
      time: ts.time,
      temperature: det.air_temperature,
      windSpeed: det.wind_speed,
      windGust: typeof det.wind_speed_of_gust === 'number' ? det.wind_speed_of_gust : null,
      windFromDeg: det.wind_from_direction,
      symbolCode: sym,
      precipMm: pDet?.precipitation_amount ?? null,
      precipMinMm: pDet?.precipitation_amount_min ?? null,
      precipMaxMm: pDet?.precipitation_amount_max ?? null,
      precipHours: pHours,
    };
  });

  const at = Date.now();
  cache.set(key, { at, hours });
  return { hours, fetchedAt: at };
}
