import { startTransition, useEffect, useState } from 'react';
import type { ProfileData } from '../elevation/profile';
import { fetchForecast, type WeatherHour } from './api';

interface WeatherState {
  hours: WeatherHour[] | null;
  loading: boolean;
  error: string | null;
  // Epoch ms of when the shown forecast was retrieved from MET (cached
  // results keep their original time). Null while nothing is loaded.
  fetchedAt: number | null;
}

export interface WeatherPoint {
  lat: number;
  lng: number;
  elevation: number;
}

export interface WeatherCandidates {
  lowest: WeatherPoint;
  highest: WeatherPoint;
}

// Pick the lowest- and highest-elevation points along the route to anchor
// the forecast. Returns null if the profile has no usable elevation data.
export function weatherCandidates(
  profile: ProfileData,
): WeatherCandidates | null {
  let lowest: WeatherPoint | null = null;
  let highest: WeatherPoint | null = null;
  for (const seg of profile.segments) {
    for (const p of seg) {
      if (!Number.isFinite(p.elevation)) continue;
      const wp: WeatherPoint = {
        lat: p.lat,
        lng: p.lng,
        elevation: p.elevation,
      };
      if (!lowest || p.elevation < lowest.elevation) lowest = wp;
      if (!highest || p.elevation > highest.elevation) highest = wp;
    }
  }
  if (!lowest || !highest) return null;
  return { lowest, highest };
}

// Fetch a 10-day hourly forecast from MET Norway for a chosen route anchor
// point. The point is selected by the caller (lowest / highest).
export function useWeather(point: WeatherPoint | null): WeatherState {
  const [state, setState] = useState<WeatherState>({
    hours: null,
    loading: false,
    error: null,
    fetchedAt: null,
  });

  // Destructure so the effect only re-runs when the coordinates actually
  // change, not when a new object identity is passed in.
  const lat = point?.lat;
  const lng = point?.lng;

  useEffect(() => {
    if (lat == null || lng == null) {
      startTransition(() => {
        setState({ hours: null, loading: false, error: null, fetchedAt: null });
      });
      return;
    }
    const controller = new AbortController();
    startTransition(() => {
      setState((s) => ({ ...s, loading: true, error: null }));
    });

    fetchForecast(lat, lng, controller.signal)
      .then(({ hours, fetchedAt }) => {
        if (controller.signal.aborted) return;
        // Transition: the weather chart mounts alongside the elevation/snow
        // panels when a route's data lands; rendering it concurrently keeps
        // the map interactive. See useElevation.
        startTransition(() => {
          setState({ hours, loading: false, error: null, fetchedAt });
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : 'Failed to fetch';
        startTransition(() => {
          setState({ hours: null, loading: false, error: msg, fetchedAt: null });
        });
      });

    return () => controller.abort();
  }, [lat, lng]);

  return state;
}
