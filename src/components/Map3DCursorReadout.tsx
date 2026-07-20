import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type { LatLng, Overlay } from '../types';
import { fetchElevationSlope } from '../elevation/pointSample';
import { fetchSnowDepths } from '../snow/api';
import { useIsMobile } from '../useIsMobile';
// Reuse the 2D readout's pill styling so the two maps look identical.
import styles from './CursorReadout.module.css';

// 3D counterpart of CursorReadout: a floating readout that follows the mouse
// over the MapLibre terrain view and shows the terrain values for the active
// thematic overlay at that exact point, sampled through the *same* helpers as
// the 2D map (elevation/pointSample.ts, snow/api.ts) so both views — and the
// elevation profile chart — always agree:
//   - steepness overlay → elevation (m) + terrain steepness (°)
//   - snow depth overlay → snow depth (cm) for the selected snow date
//
// Rendered as a sibling of the MapLibre canvas in Map3DView. Hidden on mobile
// (no hover cursor), while drawing/erasing (disabled), and whenever no overlay
// is shown. Positioned with e.point (screen px relative to the map canvas),
// which lines up with the container it is absolutely positioned inside.

// Match the 2D readout exactly.
const DEBOUNCE_MS = 150;
const BOX_W = 110;
const BOX_H = 26;
const CURSOR_GAP = 12;

interface Reading {
  elevation?: number;
  slopeDeg?: number;
  snowCm?: number;
}

interface Props {
  /** The MapLibre map instance, or null before it has been created. */
  map: maplibregl.Map | null;
  overlay: Overlay;
  snowDate: string;
  /** Suppress the readout (e.g. while the user is drawing or erasing). */
  disabled?: boolean;
}

export function Map3DCursorReadout({
  map,
  overlay,
  snowDate,
  disabled = false,
}: Props) {
  const isMobile = useIsMobile();
  const active = !!map && !isMobile && !disabled && overlay !== 'none';

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);

  const timer = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  // Monotonic id so a late response for an old hover position can never
  // overwrite the value for the current one.
  const seq = useRef(0);

  // Drop the readout whenever it gets deactivated or the layer/date changes
  // (a steepness reading must not linger over a freshly picked snow layer).
  // Adjust-during-render pattern (lint-safe, no cascading effect renders); the
  // pending timer/fetch is cancelled by the effect cleanup below.
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

  // Bind MapLibre hover handlers while active. These coexist with the
  // draw/erase mousemove handler in Map3DView (MapLibre allows multiple
  // listeners); this one only runs when the map is idle (disabled === false).
  useEffect(() => {
    if (!map || !active) return;

    const onMove = (e: maplibregl.MapMouseEvent) => {
      setPos({ x: e.point.x, y: e.point.y });
      // Invalidate any value fetched for the previous position so we never
      // show stale numbers for the new cursor location.
      seq.current++;
      setReading(null);
      query([e.lngLat.lat, e.lngLat.lng]);
    };
    const clear = () => {
      window.clearTimeout(timer.current);
      abortRef.current?.abort();
      seq.current++;
      setPos(null);
      setReading(null);
    };

    map.on('mousemove', onMove);
    map.on('mouseout', clear);
    // Hide during any camera move (pan / rotate / pitch / zoom) so the pill
    // doesn't chase a moving surface; it reappears on the next hover.
    map.on('movestart', clear);

    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', clear);
      map.off('movestart', clear);
    };
  }, [map, active, query]);

  if (!active || !map || pos === null) return null;

  // Keep the tooltip inside the map pane: flip to the other side of the
  // cursor when it would spill past the right/bottom edge.
  const container = map.getContainer();
  const sizeX = container.clientWidth;
  const sizeY = container.clientHeight;
  const left =
    pos.x + CURSOR_GAP + BOX_W > sizeX
      ? pos.x - CURSOR_GAP - BOX_W
      : pos.x + CURSOR_GAP;
  const top =
    pos.y + CURSOR_GAP + BOX_H > sizeY
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
