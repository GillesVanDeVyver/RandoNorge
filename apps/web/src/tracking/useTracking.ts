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
import type { LatLng, Route, TrackTimes } from '../types';
import { haversine } from '../geometry';
import { translate } from '../i18n/locale.ts';

export type TrackingStatus = 'idle' | 'recording' | 'paused' | 'finished';

const MAX_ACCURACY_M = 75;
const MIN_STEP_M = 3;

// ---- Pace bookkeeping ----------------------------------------------------
// Below this speed a fix interval counts as standing still (GPS noise while
// stationary typically reads a few tenths of a m/s).
const MOVING_MIN_SPEED_MPS = 0.5;
// Fix intervals longer than this (signal loss, backgrounded tab) tell us
// nothing about motion, so they count as neither moving nor add to max speed.
const MAX_FIX_GAP_S = 15;
// Guard against position jumps: anything faster than ~160 km/h on a tour is
// a GPS glitch, not skiing.
const MAX_PLAUSIBLE_SPEED_MPS = 45;

export interface Tracking {
  status: TrackingStatus;
  /** The recorded track so far (one segment per uninterrupted stretch). */
  track: Route;
  /** Fix timestamps (epoch ms), shaped exactly like `track`: times[s][i]
   *  is when track[s][i] was accepted. Persisted with the track so a
   *  review can scrub through real clock time. */
  times: TrackTimes;
  /** Latest raw GPS fix (also while paused/finished: last known). */
  position: LatLng | null;
  /** Reported accuracy of the latest fix, meters. */
  accuracy: number | null;
  /** Geolocation failure, if any (permission denied, no signal, …). */
  error: string | null;
  /** Active recording time in ms (pauses excluded), ticking each second. */
  elapsedMs: number;
  /** Time actually spent moving, ms (standing-still intervals excluded). */
  movingMs: number;
  /** Fastest observed speed in m/s (null until the first measurable move). */
  maxSpeedMps: number | null;
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
      return translate(
        'Posisjonstilgang ble avslått. Tillat posisjon for å registrere ruta.',
        'Location access was denied. Allow location to record your route.',
      );
    case err.POSITION_UNAVAILABLE:
      return translate(
        'Posisjonen din er utilgjengelig for øyeblikket.',
        'Your position is currently unavailable.',
      );
    case err.TIMEOUT:
      return translate(
        'Det tok for lang tid å hente posisjonen din.',
        'Getting your position timed out.',
      );
    default:
      return translate(
        'Kunne ikke hente posisjonen din.',
        'Could not get your position.',
      );
  }
}

export function useTracking(): Tracking {
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [track, setTrack] = useState<Route>([]);
  const [times, setTimes] = useState<TrackTimes>([]);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [movingMs, setMovingMs] = useState(0);
  const [maxSpeedMps, setMaxSpeedMps] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  // Mutable working copy of the track; state is refreshed from it on every
  // accepted fix. Avoids re-reading state inside the watch callback.
  const trackRef = useRef<Route>([]);
  // Fix timestamps, kept in lockstep with trackRef (same segment/point shape).
  const timesRef = useRef<TrackTimes>([]);
  const lastAcceptedRef = useRef<LatLng | null>(null);
  // True until the first fix of the current segment arrives; the segment
  // array is only created then, so pauses can't leave empty segments.
  const needsSegmentRef = useRef(true);
  // Active-time bookkeeping: accumulated ms from earlier recording
  // stretches + the timestamp of the current stretch's start.
  const accumulatedMsRef = useRef(0);
  const resumedAtRef = useRef<number | null>(null);
  // Pace bookkeeping: every good-accuracy fix (also the sub-MIN_STEP_M ones
  // dropped from the line — standing still must read as 0 km/h, which needs
  // the short intervals) is compared with the previous one to classify the
  // interval as moving or standing and to update the max speed.
  const lastFixRef = useRef<{ point: LatLng; time: number } | null>(null);
  const movingMsRef = useRef(0);
  const maxSpeedRef = useRef<number | null>(null);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const startWatch = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError(
        translate(
          'Geolokalisering støttes ikke av denne nettleseren.',
          'Geolocation is not supported by this browser.',
        ),
      );
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

        // Pace stats — measured fix-to-fix, before the min-step gate so
        // standing still is observed (as near-zero speed) rather than
        // silently dropped.
        const prevFix = lastFixRef.current;
        lastFixRef.current = { point, time: fix.timestamp };
        if (prevFix) {
          const dtS = (fix.timestamp - prevFix.time) / 1000;
          if (dtS > 0 && dtS <= MAX_FIX_GAP_S) {
            // Prefer the device's Doppler-derived speed when available;
            // fall back to distance/time between fixes.
            const reported = fix.coords.speed;
            const speed =
              reported != null && Number.isFinite(reported) && reported >= 0
                ? reported
                : haversine(prevFix.point, point) / dtS;
            if (speed <= MAX_PLAUSIBLE_SPEED_MPS) {
              if (speed >= MOVING_MIN_SPEED_MPS) {
                movingMsRef.current += dtS * 1000;
                setMovingMs(movingMsRef.current);
              }
              if (maxSpeedRef.current === null || speed > maxSpeedRef.current) {
                maxSpeedRef.current = speed;
                setMaxSpeedMps(speed);
              }
            }
          }
        }

        const last = lastAcceptedRef.current;
        if (last && haversine(last, point) < MIN_STEP_M) return;

        if (needsSegmentRef.current) {
          trackRef.current = [...trackRef.current, [point]];
          timesRef.current = [...timesRef.current, [fix.timestamp]];
          needsSegmentRef.current = false;
        } else {
          const segs = trackRef.current;
          const lastSeg = segs[segs.length - 1];
          trackRef.current = [...segs.slice(0, -1), [...lastSeg, point]];
          const tsegs = timesRef.current;
          const lastTimes = tsegs[tsegs.length - 1];
          timesRef.current = [
            ...tsegs.slice(0, -1),
            [...lastTimes, fix.timestamp],
          ];
        }
        lastAcceptedRef.current = point;
        setTrack(trackRef.current);
        setTimes(timesRef.current);
      },
      (err) => {
        setError(geoErrorMessage(err));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
  }, []);

  const start = useCallback(() => {
    trackRef.current = [];
    timesRef.current = [];
    lastAcceptedRef.current = null;
    needsSegmentRef.current = true;
    accumulatedMsRef.current = 0;
    resumedAtRef.current = Date.now();
    lastFixRef.current = null;
    movingMsRef.current = 0;
    maxSpeedRef.current = null;
    setTrack([]);
    setTimes([]);
    setElapsedMs(0);
    setMovingMs(0);
    setMaxSpeedMps(null);
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
      // Same for pace: the gap spent paused must not read as an interval.
      lastFixRef.current = null;
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
    timesRef.current = [];
    lastAcceptedRef.current = null;
    needsSegmentRef.current = true;
    accumulatedMsRef.current = 0;
    resumedAtRef.current = null;
    lastFixRef.current = null;
    movingMsRef.current = 0;
    maxSpeedRef.current = null;
    setTrack([]);
    setTimes([]);
    setPosition(null);
    setAccuracy(null);
    setError(null);
    setElapsedMs(0);
    setMovingMs(0);
    setMaxSpeedMps(null);
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
    times,
    position,
    accuracy,
    error,
    elapsedMs,
    movingMs,
    maxSpeedMps,
    startedAt,
    finishedAt,
    start,
    pause,
    resume,
    finish,
    reset,
  };
}
