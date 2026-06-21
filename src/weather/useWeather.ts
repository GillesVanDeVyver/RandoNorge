import { useEffect, useMemo, useState } from 'react';
import type { ProfileData } from '../elevation/profile';
import { fetchForecast, type WeatherHour } from './api';

interface WeatherState {
  hours: WeatherHour[] | null;
  loading: boolean;
  error: string | null;
}

// Geographic centroid of all profile points. Quantized to ~100 m precision in
// fetchForecast() so small route edits don't trigger refetches.
function routeCenter(profile: ProfileData): [number, number] | null {
  let sumLat = 0;
  let sumLng = 0;
  let n = 0;
  for (const seg of profile.segments) {
    for (const p of seg) {
      sumLat += p.lat;
      sumLng += p.lng;
      n++;
    }
  }
  if (n === 0) return null;
  return [sumLat / n, sumLng / n];
}

// Fetch a 10-day hourly forecast from MET Norway for the route's centre.
export function useWeather(profile: ProfileData | null): WeatherState {
  const center = useMemo(
    () => (profile ? routeCenter(profile) : null),
    [profile],
  );

  const [state, setState] = useState<WeatherState>({
    hours: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!center) {
      setState({ hours: null, loading: false, error: null });
      return;
    }
    const [lat, lng] = center;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    fetchForecast(lat, lng, controller.signal)
      .then((hours) => {
        if (controller.signal.aborted) return;
        setState({ hours, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : 'Failed to fetch';
        setState({ hours: null, loading: false, error: msg });
      });

    return () => controller.abort();
  }, [center]);

  return state;
}
