import { useCallback, useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { Bounds } from '../offline/tileMath';
import styles from './RegionSelector.module.css';

// A draggable, resizable rectangle drawn over the map that the user adjusts to
// pick the area to download. The selection is held in geographic coordinates
// ([south, west, north, east]) so it stays pinned to the terrain while the map
// pans and zooms; on every map move we re-project the two corners to container
// pixels to position the box and its handles.

interface Props {
  bounds: Bounds;
  onChange: (bounds: Bounds) => void;
}

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
type DragMode = 'move' | Handle;

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  // Pixel rect at drag start: left/top = NW corner, right/bottom = SE corner.
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'];

export function RegionSelector({ bounds, onChange }: Props) {
  const map = useMap();
  // Bump on every map move/zoom so the projected pixel rect recomputes.
  const [, force] = useState(0);
  const drag = useRef<DragState | null>(null);

  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    map.on('move zoom zoomanim resize viewreset', rerender);
    return () => {
      map.off('move zoom zoomanim resize viewreset', rerender);
    };
  }, [map]);

  const [south, west, north, east] = bounds;
  const nw = map.latLngToContainerPoint([north, west]);
  const se = map.latLngToContainerPoint([south, east]);
  const left = Math.min(nw.x, se.x);
  const top = Math.min(nw.y, se.y);
  const width = Math.abs(se.x - nw.x);
  const height = Math.abs(se.y - nw.y);

  // Removes whatever window listeners the active drag installed. Held in a ref
  // so an unmount mid-drag can also tear them down.
  const cleanupRef = useRef<() => void>(() => {});
  useEffect(() => () => cleanupRef.current(), []);

  const startDrag = useCallback(
    (mode: DragMode) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Stop Leaflet from panning while we drag the selection.
      map.dragging.disable();
      drag.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        left,
        top,
        right: left + width,
        bottom: top + height,
      };

      const onMove = (ev: PointerEvent) => {
        const d = drag.current;
        if (!d) return;
        const dx = ev.clientX - d.startX;
        const dy = ev.clientY - d.startY;
        let { left: l, top: t, right: r, bottom: b } = d;

        if (d.mode === 'move') {
          l += dx;
          r += dx;
          t += dy;
          b += dy;
        } else {
          if (d.mode.includes('w')) l += dx;
          if (d.mode.includes('e')) r += dx;
          if (d.mode.includes('n')) t += dy;
          if (d.mode.includes('s')) b += dy;
        }

        // Convert the (possibly flipped) pixel rect back to geographic corners.
        const p1 = map.containerPointToLatLng([Math.min(l, r), Math.min(t, b)]);
        const p2 = map.containerPointToLatLng([Math.max(l, r), Math.max(t, b)]);
        onChange([
          Math.min(p1.lat, p2.lat),
          Math.min(p1.lng, p2.lng),
          Math.max(p1.lat, p2.lat),
          Math.max(p1.lng, p2.lng),
        ]);
      };

      const onUp = () => {
        drag.current = null;
        map.dragging.enable();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        cleanupRef.current = () => {};
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      cleanupRef.current = onUp;
    },
    [map, left, top, width, height, onChange],
  );

  // Keep clicks/scrolls on the overlay from reaching the map underneath.
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el) L.DomEvent.disableScrollPropagation(el);
  }, []);

  return (
    <div className={styles.overlay} aria-hidden="true">
      <div
        ref={boxRef}
        className={styles.box}
        style={{ left, top, width, height }}
        onPointerDown={startDrag('move')}
      >
        {HANDLES.map((h) => (
          <span
            key={h}
            className={`${styles.handle} ${styles[h]}`}
            onPointerDown={startDrag(h)}
          />
        ))}
      </div>
    </div>
  );
}
