import { useCallback, useEffect, useRef, useState } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import type { LatLng, Overlay } from '../types';
import { fetchElevationSlope } from '../elevation/pointSample';
import { fetchSnowDepths } from '../snow/api';
import { useIsMobile } from '../useIsMobile';
import styles from './CursorReadout.module.css';

// Floating readout that follows the mouse cursor over the map and shows the
// terrain values for the active thematic overlay at that exact point:
//   - steepness overlay → elevation (m) + terrain steepness (°), sampled the
//     same way as the elevation profile chart (central differences on the
//     Kartverket DTM, see elevation/pointSample.ts), so the two always agree.
//   - snow depth overlay → snow depth (cm) from the seNorge 1 km grid for the
//     currently selected snow date.
//
// Rendered as a child of <MapContainer> in Map.tsx, which is shared by the
// planning and review screens — so both modes get the readout for free.
// Hidden on mobile (no hover cursor) and while drawing/erasing.

// Wait for the cursor to settle before firing network requests; both APIs
// are cached, so revisited spots resolve instantly on the next hover.
const DEBOUNCE_MS = 150;
// Approximate tooltip footprint used to flip it away from the map edges.
const BOX_W = 110;
const BOX_H = 26;
const CURSOR_GAP = 12;

interface Reading {
  elevation?: number;
  slopeDeg?: number;
  snowCm?: number;
}

interface Props {
  overlay: Overlay;
  snowDate: string;
  /** Suppress the readout (e.g. while the user is drawing or erasing). */
  disabled?: boolean;
}

export function CursorReadout({ overlay, snowDate, disabled = false }: Props) {
  const map = useMap();
  const isMobile = useIsMobile();
  const active = !isMobile && !disabled && overlay !== 'none';

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);

  const timer = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  // Monotonic id so a late response for an old hover position can never
  // overwrite the value for the current one.
  const seq = useRef(0);
  const dragging = useRef(false);

  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    abortRef.current?.abort();
    seq.current++;
    setPos(null);
    setReading(null);
  }, []);

  // Drop the readout whenever it gets deactivated or the layer/date changes
  // (a steepness reading must not linger over a freshly picked snow layer).
  // State is reset with the adjust-during-render pattern (lint-safe, no
  // cascading effect renders); the pending timer/fetch is cancelled by the
  // effect cleanup below, which also covers unmount.
  const configKey = `${active}|${overlay}|${snowDate}`;
  const [lastConfigKey, setLastConfigKey] = useState(configKey);
  if (configKey !== lastConfigKey) {
    setLastConfigKey(configKey);
    setPos(null);
    setReading(null);
  }
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      abortRef.current?.abort();
      seq.current++;
    },
    [configKey],
  );

  const query = useCallback(
    (latlng: LatLng) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const id = ++seq.current;
        try {
          if (overlay === 'steepness') {
            const s = await fetchElevationSlope(latlng, ctrl.signal);
            if (seq.current === id) {
              setReading({ elevation: s.elevation, slopeDeg: s.slopeDeg });
            }
          } else if (overlay === 'snowdepth') {
            const { depths } = await fetchSnowDepths(
              [latlng],
              snowDate,
              ctrl.signal,
            );
            if (seq.current === id) setReading({ snowCm: depths[0] });
          }
        } catch {
          // Aborted (cursor moved on) or transient network error — the next
          // hover position simply retries.
        }
      }, DEBOUNCE_MS);
    },
    [overlay, snowDate],
  );

  useMapEvents({
    mousemove(e) {
      if (!active || dragging.current) return;
      setPos({ x: e.containerPoint.x, y: e.containerPoint.y });
      // Invalidate any value fetched for the previous position so we never
      // show stale numbers for the new cursor location.
      seq.current++;
      setReading(null);
      query([e.latlng.lat, e.latlng.lng]);
    },
    mouseout() {
      clear();
    },
    dragstart() {
      dragging.current = true;
      clear();
    },
    dragend() {
      dragging.current = false;
    },
  });

  if (!active || pos === null) return null;

  // Keep the tooltip inside the map pane: flip to the other side of the
  // cursor when it would spill past the right/bottom edge.
  const size = map.getSize();
  const left =
    pos.x + CURSOR_GAP + BOX_W > size.x
      ? pos.x - CURSOR_GAP - BOX_W
      : pos.x + CURSOR_GAP;
  const top =
    pos.y + CURSOR_GAP + BOX_H > size.y
      ? pos.y - CURSOR_GAP - BOX_H
      : pos.y + CURSOR_GAP;

  // Compact single-line pill: "312 m · 27.4°" (steepness) or "45 cm" (snow).
  const fmt = {
    elevation: (v: number | undefined) =>
      v === undefined ? '…' : Number.isFinite(v) ? `${Math.round(v)} m` : '–',
    slope: (v: number | undefined) =>
      v === undefined ? '…' : Number.isFinite(v) ? `${v.toFixed(1)}°` : '–',
    snow: (v: number | undefined) =>
      v === undefined ? '…' : Number.isFinite(v) ? `${Math.round(v)} cm` : '–',
  };

  return (
    <div className={styles.readout} style={{ left, top }} aria-hidden>
      {overlay === 'steepness' ? (
        <>
          {fmt.elevation(reading?.elevation)}
          <span className={styles.sep}>·</span>
          {fmt.slope(reading?.slopeDeg)}
        </>
      ) : (
        fmt.snow(reading?.snowCm)
      )}
    </div>
  );
}
