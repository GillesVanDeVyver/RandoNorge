// The live terrain view inside the sheet's map frame, and the gesture that
// aims it.
//
// Everything to do with MapLibre lives next door in terrainMap.ts, which is
// reached through a dynamic import so that a guide exporting the ordinary flat
// map never downloads a megabyte of WebGL. This file is the thin part: a box to
// build the map in, a drag to turn it with, and the plumbing that keeps the
// printable copy and the sheet's compass in step with wherever it ends up.
//
// Two things about the box are load-bearing, and both are explained where they
// are done: the map is built at print size and shown shrunk (so what prints is
// the resolution it was rendered at), and the turning is done by hand rather
// than by MapLibre's own handlers (so a drag turns the map, and so the pointer
// arithmetic cannot disagree with a frame that is scaled twice over).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { Route } from '../types';
import type { TerrainMapHandle } from './terrainMap';
import { useT } from '../i18n/index.ts';

/** A key press turns the map by a twelfth of a frame — 15° round, 7.5° up —
 *  which is coarse enough to get somewhere in a few presses and fine enough to
 *  stop on the aspect you meant. */
const KEY_STEP = 1 / 12;

export function TerrainPicture({
  route,
  steepness,
  width,
  height,
  scale,
  canvasRef,
  onReady,
  onFailed,
  onBearing,
}: {
  route: Route;
  steepness: boolean;
  /** The size the map is *rendered* at, which is the size it prints at. */
  width: number;
  height: number;
  scale: number;
  /** The still copy that goes on paper. Owned by the frame around us, because
   *  the flat map draws into the same one. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** There is a finished picture on the canvas; the sheet may enable Print. */
  onReady: () => void;
  /** No terrain view is possible here — fall back to the flat map. */
  onFailed: () => void;
  /** Which way the camera is now facing, for the north mark. */
  onBearing: (deg: number) => void;
}) {
  const t = useT();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<TerrainMapHandle | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // How far down the map has to be drawn to fit the frame: the frame's own
  // width over the width the map is rendered at. Measured rather than
  // calculated, because the frame is sized in millimetres inside a sheet that
  // is itself drawn at 75%, and the only honest source for "how wide is this
  // box, really" is the box.
  const [shrink, setShrink] = useState<number | null>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // No first measurement of our own: a ResizeObserver reports the size it
    // finds when it starts observing, so the first callback is the initial
    // measurement and the rest are the frame changing under it.
    const observer = new ResizeObserver(() =>
      setShrink(frame.clientWidth / width),
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [width]);

  // Held in refs so a parent re-rendering with fresh closures cannot tear down
  // a map that took seconds of tile fetching to build.
  const cbRef = useRef({ onReady, onFailed, onBearing });
  useEffect(() => {
    cbRef.current = { onReady, onFailed, onBearing };
  }, [onReady, onFailed, onBearing]);

  useEffect(() => {
    const holder = holderRef.current;
    const canvas = canvasRef.current;
    if (!holder || !canvas) return;
    let cancelled = false;
    let handle: TerrainMapHandle | null = null;

    void import('./terrainMap')
      .then((m) =>
        m.createTerrainMap(holder, {
          route,
          width,
          height,
          scale,
          steepness,
          canvas,
          onBearing: (deg) => cbRef.current.onBearing(deg),
          cancelled: () => cancelled,
        }),
      )
      .then((built) => {
        if (cancelled) {
          built.destroy();
          return;
        }
        handle = built;
        handleRef.current = built;
        cbRef.current.onReady();
      })
      .catch(() => {
        if (!cancelled) cbRef.current.onFailed();
      });

    return () => {
      cancelled = true;
      handle?.destroy();
      handleRef.current = null;
    };
  }, [route, steepness, width, height, scale, canvasRef]);

  // The last thing between the picture and the paper. The copy is already
  // retaken every time the camera comes to rest, so this is belt and braces —
  // but it is the cheap kind, and the failure it guards against (a page that
  // prints a frame older than the one on screen) is silent.
  useEffect(() => {
    const freeze = () => handleRef.current?.capture();
    window.addEventListener('beforeprint', freeze);
    return () => window.removeEventListener('beforeprint', freeze);
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!handleRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const from = dragRef.current;
    const handle = handleRef.current;
    if (!from || !handle) return;
    // Measured against the frame the user can see, not the map behind it: the
    // gesture should mean the same thing whatever size the picture is drawn at.
    const box = e.currentTarget.getBoundingClientRect();
    handle.turn((e.clientX - from.x) / box.width, (e.clientY - from.y) / box.height);
    dragRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // The idle copy will follow a moment later anyway; taking one now means the
    // page is right immediately after the gesture rather than a frame or two
    // afterwards, which is when a quick user hits Print.
    handleRef.current?.capture();
  }, []);

  return (
    <div
      ref={frameRef}
      className="briefingMapLive"
      // Focusable and arrow-key operable: the map is the one part of this sheet
      // that can be aimed, and aiming it should not require a mouse.
      tabIndex={0}
      role="group"
      aria-label={t(
        'Snu kartet: dra det, eller bruk piltastene',
        'Turn the map: drag it, or use the arrow keys',
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(e) => {
        const handle = handleRef.current;
        if (!handle) return;
        const step: Record<string, [number, number]> = {
          ArrowLeft: [-KEY_STEP, 0],
          ArrowRight: [KEY_STEP, 0],
          ArrowUp: [0, -KEY_STEP],
          ArrowDown: [0, KEY_STEP],
        };
        const move = step[e.key];
        if (!move) return;
        e.preventDefault();
        handle.turn(move[0], move[1]);
        handle.capture();
      }}
    >
      <div
        ref={holderRef}
        className="briefingMapLiveInner"
        // Built big, shown small — see terrainMap.ts. Hidden until the frame
        // has been measured, so the map is never seen at full size for a frame
        // before the scale lands on it.
        style={{
          transform: `scale(${shrink ?? 0})`,
          visibility: shrink === null ? 'hidden' : undefined,
        }}
      />
      <p className="briefingMapHint" aria-hidden>
        {t('Dra for å snu · skrives ut slik det vises', 'Drag to turn · prints as shown')}
      </p>
      {/* The way back. The sheet opens on whatever camera the planner was left
       *  at, which can be halfway up one bowl of a long tour — the right
       *  picture on a screen you can pan, the wrong one on a single sheet. Since
       *  panning and zooming are deliberately not offered here, without this
       *  button that view would be a dead end. */}
      <button
        type="button"
        className="briefingMapRefit"
        // A press on the button must not also be the beginning of a drag on the
        // map behind it, which would turn the map on the way to resetting it.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const handle = handleRef.current;
          if (!handle) return;
          handle.reset();
          handle.capture();
        }}
      >
        {t('Vis hele ruta', 'Fit the route')}
      </button>
    </div>
  );
}
