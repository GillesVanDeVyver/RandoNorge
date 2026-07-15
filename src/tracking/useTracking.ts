// Live GPS recording for navigation mode ("Start route", komoot-style).
//
// While recording, geolocation fixes stream in through watchPosition and
// accumulate into a `Route` (the same segments-of-[lat,lng] shape the
// planner uses), so the recorded track can be rendered, analysed, and
// serialized exactly like a drawn route. Pausing stops the watch and a
// later resume starts a new segment, so the gap in the recording is a gap
// in the MultiLineString rather than a straight jump across it.
//
// Fixes are gated before they extend the track:
//  - accuracy worse than MAX_ACCURACY_M is dropped (a bad urban/first fix
//    would otherwise smear hundred-meter spikes into the line);
//  - moves shorter than MIN_STEP_M from the last accepted point are
//    dropped, so standing still doesn't grow a GPS-noise "bird's nest".
// The live position marker still follows every fix — only the recorded
// line is gated.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLng, Route } from '../types';
import { haversine } from '../geometry';

export type TrackingStatus = 'idle' | 'recording' | 'paused' | 'finished';

const MAX_ACCURACY_M = 75;
const MIN_STEP_M = 3;

export interface Tracking {
  status: TrackingStatus;
  /** The recorded track so far (one segment per uninterrupted stretch). */
  track: Route;
  /** Latest raw GPS fix (also while paused/finished: last known). */
  position: LatLng | null;
  /** Reported accuracy of the latest fix, meters. */
  accuracy: number | null;
  /** Geolocation failure, if any (permission denied, no signal, …). */
  error: string | null;
  /** Active recording time in ms (pauses excluded), ticking each second. */
  elapsedMs: number;
  /** ISO timestamp of when recording first started. */
  startedAt: string | null;
  /** ISO timestamp of when Finish was pressed. */
  finishedAt: string | null;
  start: () => void;
  pause: () => void;
  resume: () => void;
  finish: () => void;
  /** Back to idle; clears the track. */
  reset: () => void;
}

function geoErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Location access was denied. Allow location to record your route.';
    case err.POSITION_UNAVAILABLE:
      return 'Your position is currently unavailable.';
    case err.TIMEOUT:
      return 'Getting your position timed out.';
    default:
      return 'Could not get your position.';
  }
}

export function useTracking(): Tracking {
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [track, setTrack] = useState<Route>([]);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  // Mutable working copy of the track; state is refreshed from it on every
  // accepted fix. Avoids re-reading state inside the watch callback.
  const trackRef = useRef<Route>([]);
  const lastAcceptedRef = useRef<LatLng | null>(null);
  // True until the first fix of the current segment arrives; the segment
  // array is only created then, so pauses can't leave empty segments.
  const needsSegmentRef = useRef(true);
  // Active-time bookkeeping: accumulated ms from earlier recording
  // stretches + the timestamp of the current stretch's start.
  const accumulatedMsRef = useRef(0);
  const resumedAtRef = useRef<number | null>(null);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const startWatch = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by this browser.');
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (fix) => {
        const point: LatLng = [fix.coords.latitude, fix.coords.longitude];
        setPosition(point);
        setAccuracy(fix.coords.accuracy);
        setError(null);

        // Gate what extends the recorded line (see module comment).
        if (fix.coords.accuracy > MAX_ACCURACY_M) return;
        const last = lastAcceptedRef.current;
        if (last && haversine(last, point) < MIN_STEP_M) return;

        if (needsSegmentRef.current) {
          trackRef.current = [...trackRef.current, [point]];
          needsSegmentRef.current = false;
        } else {
          const segs = trackRef.current;
          const lastSeg = segs[segs.length - 1];
          trackRef.current = [...segs.slice(0, -1), [...lastSeg, point]];
        }
        lastAcceptedRef.current = point;
        setTrack(trackRef.current);
      },
      (err) => {
        setError(geoErrorMessage(err));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
  }, []);

  const start = useCallback(() => {
    trackRef.current = [];
    lastAcceptedRef.current = null;
    needsSegmentRef.current = true;
    accumulatedMsRef.current = 0;
    resumedAtRef.current = Date.now();
    setTrack([]);
    setElapsedMs(0);
    setError(null);
    setStartedAt(new Date().toISOString());
    setFinishedAt(null);
    setStatus('recording');
    startWatch();
  }, [startWatch]);

  const pause = useCallback(() => {
    setStatus((s) => {
      if (s !== 'recording') return s;
      stopWatch();
      if (resumedAtRef.current !== null) {
        accumulatedMsRef.current += Date.now() - resumedAtRef.current;
        resumedAtRef.current = null;
      }
      return 'paused';
    });
  }, [stopWatch]);

  const resume = useCallback(() => {
    setStatus((s) => {
      if (s !== 'paused') return s;
      // Break the line: the next accepted fix starts a fresh segment, and
      // the distance gate must not compare against the pre-pause point.
      needsSegmentRef.current = true;
      lastAcceptedRef.current = null;
      resumedAtRef.current = Date.now();
      startWatch();
      return 'recording';
    });
  }, [startWatch]);

  const finish = useCallback(() => {
    setStatus((s) => {
      if (s !== 'recording' && s !== 'paused') return s;
      stopWatch();
      if (resumedAtRef.current !== null) {
        accumulatedMsRef.current += Date.now() - resumedAtRef.current;
        resumedAtRef.current = null;
      }
      setElapsedMs(accumulatedMsRef.current);
      setFinishedAt(new Date().toISOString());
      return 'finished';
    });
  }, [stopWatch]);

  const reset = useCallback(() => {
    stopWatch();
    trackRef.current = [];
    lastAcceptedRef.current = null;
    needsSegmentRef.current = true;
    accumulatedMsRef.current = 0;
    resumedAtRef.current = null;
    setTrack([]);
    setPosition(null);
    setAccuracy(null);
    setError(null);
    setElapsedMs(0);
    setStartedAt(null);
    setFinishedAt(null);
    setStatus('idle');
  }, [stopWatch]);

  // Tick the elapsed clock once a second while recording.
  useEffect(() => {
    if (status !== 'recording') return;
    const tick = () => {
      const running =
        resumedAtRef.current !== null ? Date.now() - resumedAtRef.current : 0;
      setElapsedMs(accumulatedMsRef.current + running);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [status]);

  // Stop the GPS watch if the component unmounts mid-recording.
  useEffect(() => stopWatch, [stopWatch]);

  return {
    status,
    track,
    position,
    accuracy,
    error,
    elapsedMs,
    startedAt,
    finishedAt,
    start,
    pause,
    resume,
    finish,
    reset,
  };
}
