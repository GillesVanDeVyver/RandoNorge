// Hourly weather forecast from MET Norway's Locationforecast service
// (the data behind yr.no). Single request per (lat, lon, altitude) returns
// ~10 days of hourly data; we cache it client-side keyed on the quantized
// coordinates so route panning around the same area doesn't re-fetch.
//
// The endpoint requires an identifying User-Agent header. Browsers don't let
// fetch() set User-Agent, so we go through the Vite dev proxy (see
// vite.config.ts), which rewrites /metno-api → https://api.met.no and stamps
// the header server-side.

const ENDPOINT = '/metno-api/weatherapi/locationforecast/2.0/compact';

export interface WeatherHour {
  time: string; // ISO timestamp, UTC, hour-aligned
  temperature: number; // °C
  windSpeed: number; // m/s
  windGust: number | null; // m/s, if reported
  windFromDeg: number; // direction the wind is blowing FROM, degrees
  symbolCode: string | null; // e.g. "partlycloudy_day"
  precipMm: number | null; // expected precipitation for the next 1 h
  precipMinMm: number | null;
  precipMaxMm: number | null;
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
    };
  };
}

interface MetNoResponse {
  properties: { timeseries: MetNoTimeseries[] };
}

// (lat,lon quantized to 3 decimals ≈ ~100 m) → cached forecast.
const cache = new Map<string, WeatherHour[]>();

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

export async function fetchForecast(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<WeatherHour[]> {
  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached) return cached;

  const url = `${ENDPOINT}?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Weather API ${res.status}`);
  const data = (await res.json()) as MetNoResponse;

  const hours: WeatherHour[] = data.properties.timeseries.map((ts) => {
    const det = ts.data.instant.details;
    const n1 = ts.data.next_1_hours;
    const sym =
      n1?.summary?.symbol_code ?? ts.data.next_6_hours?.summary?.symbol_code ?? null;
    return {
      time: ts.time,
      temperature: det.air_temperature,
      windSpeed: det.wind_speed,
      windGust: typeof det.wind_speed_of_gust === 'number' ? det.wind_speed_of_gust : null,
      windFromDeg: det.wind_from_direction,
      symbolCode: sym,
      precipMm: n1?.details?.precipitation_amount ?? null,
      precipMinMm: n1?.details?.precipitation_amount_min ?? null,
      precipMaxMm: n1?.details?.precipitation_amount_max ?? null,
    };
  });

  cache.set(key, hours);
  return hours;
}
