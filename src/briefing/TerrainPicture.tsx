// The live terrain view inside the sheet's map frame, and the gesture that
// aims it.
//
// Everything to do with MapLibre lives next door in terrainMap.ts, which is
// reached through a dynamic import so that a guide exporting the ordinary flat
// map never downloads a megabyte of WebGL. This file is the thin part: a box to
// build the map in, a drag to aim it with, two buttons to draw it closer or
// wider, and the plumbing that keeps the printable copy and the sheet's compass
// in step with wherever it ends up.
//
// The drag has two meanings, and which is which is settled by the planner
// rather than by anything about this sheet: there, a plain drag moves the map
// and a held modifier turns it, so it does the same here. The guide who has
// just been turning a hillside in the planner should not have to learn that the
// same hand does something else one dialog later. Held second, because a map
// you cannot move is a much more surprising map than one you cannot turn.
//
// The zoom is deliberately not MapLibre's. It is an offset from the framing the
// map settled on, shared with the flat renderer through mapFraming.ts, so that
// one press means the same amount of closer whichever way the map is being
// drawn — and so that 0 always means the picture the sheet opened on.
//
// Two things about the box are load-bearing, and both are explained where they
// are done: the map is built at print size and shown shrunk (so what prints is
// the resolution it was rendered at), and the gestures are measured here rather
// than by MapLibre's own handlers, so the pointer arithmetic cannot disagree
// with a frame that is scaled twice over.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { Overlay, Route } from '../types';
import type { TerrainMapHandle } from './terrainMap';
import { MapZoomControls } from './MapZoomControls';
import { clampZoom, useWheelZoom, ZOOM_STEP } from './mapFraming';
import { useT } from '../i18n/index.ts';

/** A key press turns the map by a twelfth of a frame — 15° round, 7.5° up —
 *  which is coarse enough to get somewhere in a few presses and fine enough to
 *  stop on the aspect you meant. */
const KEY_STEP = 1 / 12;

/** A key press moves the map by a tenth of a frame. Larger than the turn step
 *  in what it costs the picture, because the reach is under a frame in each
 *  direction either way: ten presses crosses it, which is a few seconds of
 *  holding the key rather than a minute of it. */
const KEY_MOVE_STEP = 1 / 10;

/**
 * Does this gesture turn the map rather than move it?
 *
 * Shift, or the right button, or Ctrl — the three ways MapLibre's own
 * dragRotate can be invoked, so the modifier the guide already uses in the
 * planner is the modifier that works here. Meta is left out: it is Ctrl's
 * stand-in on a Mac for most things, but not for this, and claiming it would
 * quietly break Cmd-drag for anyone whose browser or desktop has a use for it.
 */
function turns(e: { shiftKey: boolean; ctrlKey: boolean; buttons?: number }): boolean {
  return e.shiftKey || e.ctrlKey || (e.buttons ?? 0) === 2;
}

export function TerrainPicture({
  route,
  overlay,
  snowDate,
  width,
  height,
  scale,
  canvasRef,
  onReady,
  onFailed,
  onBearing,
}: {
  route: Route;
  /** What is draped over the terrain: steepness, snow depth, or nothing. */
  overlay: Overlay;
  /** Which day's snow to drape, when the overlay is snow depth. */
  snowDate: string;
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
  // Where the pointer was last seen, and what this drag decided it meant. The
  // meaning is settled once, at the press, and held for the whole gesture: a
  // Shift released halfway through a turn should not hand the rest of the
  // stroke to the pan, leaving the map somewhere neither gesture was aiming at.
  const dragRef = useRef<{ x: number; y: number; turning: boolean } | null>(
    null,
  );

  // How close the camera is drawn, as an offset from the framing it settled
  // on. Kept here rather than inside the map so the buttons can grey out at
  // the limits, and so that a rebuild — a changed overlay, a new
  // route — starts from the whole tour again rather than from wherever the
  // last one was left. The flat map keeps its own, in its own terms; the two
  // are never on screen at the same time. See mapFraming.ts.
  const [zoom, setZoom] = useState(0);
  // Whether there is a map to say any of this to yet. A zoom asked for while
  // the terrain is still being built has to be applied when it arrives, and
  // this is what makes the effect below run again at that moment.
  const [built, setBuilt] = useState(false);

  const zoomByStep = useCallback(
    (delta: number) => setZoom((z) => clampZoom(z + delta)),
    [],
  );
  useWheelZoom(frameRef, zoomByStep);

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
          overlay,
          snowDate,
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
        setBuilt(true);
        cbRef.current.onReady();
      })
      .catch(() => {
        if (!cancelled) cbRef.current.onFailed();
      });

    return () => {
      cancelled = true;
      handle?.destroy();
      handleRef.current = null;
      setBuilt(false);
    };
  }, [route, overlay, snowDate, width, height, scale, canvasRef]);

  // Put the asked-for zoom on the camera — when it is asked for, and again as
  // soon as there is a camera to put it on. Not folded into the button's own
  // handler because those two moments are different, and a press that landed
  // while the terrain was still arriving would otherwise be forgotten while
  // the buttons went on claiming it had happened.
  useEffect(() => {
    const handle = handleRef.current;
    if (!built || !handle) return;
    handle.setZoom(zoom);
    // The still copy follows on idle anyway, once the newly revealed hillside
    // has its tiles; this is the same "be right immediately" belt-and-braces
    // the drag does, for a guide who presses + and then Print.
    handle.capture();
  }, [zoom, built]);

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
    dragRef.current = { x: e.clientX, y: e.clientY, turning: turns(e) };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const from = dragRef.current;
    const handle = handleRef.current;
    if (!from || !handle) return;
    // Measured against the frame the user can see, not the map behind it: the
    // gesture should mean the same thing whatever size the picture is drawn at.
    const box = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - from.x) / box.width;
    const dy = (e.clientY - from.y) / box.height;
    if (from.turning) handle.turn(dx, dy);
    else handle.move(dx, dy);
    dragRef.current = { ...from, x: e.clientX, y: e.clientY };
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
        'Flytt kartet: dra det, eller bruk piltastene. Hold Shift for å snu det. Zoom med rullehjulet eller + og −',
        'Move the map: drag it, or use the arrow keys. Hold Shift to turn it. Zoom with the wheel or + and −',
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // The right button is one of the ways to turn the map, so it must not
      // also be the way to open a menu over the top of the map being turned.
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const handle = handleRef.current;
        if (!handle) return;
        // The arrows mean whatever a drag means, and Shift flips them the same
        // way it flips a drag — one rule for both hands, rather than a keyboard
        // that has to be learned separately from the mouse.
        const unit = e.shiftKey ? KEY_STEP : KEY_MOVE_STEP;
        const step: Record<string, [number, number]> = {
          ArrowLeft: [-unit, 0],
          ArrowRight: [unit, 0],
          ArrowUp: [0, -unit],
          ArrowDown: [0, unit],
        };
        const aim = step[e.key];
        if (aim) {
          e.preventDefault();
          if (e.shiftKey) handle.turn(aim[0], aim[1]);
          // Arrows point where the *view* should go, which is the opposite of
          // where the ground goes: pressing right should walk the frame east
          // along the route, the way a drag to the left does.
          else handle.move(-aim[0], -aim[1]);
          handle.capture();
          return;
        }
        // Closer and wider, in the same step the buttons take, so the two ways
        // of asking cannot disagree about what one press is worth.
        const zooms: Record<string, number> = {
          '+': ZOOM_STEP,
          '=': ZOOM_STEP,
          '-': -ZOOM_STEP,
          _: -ZOOM_STEP,
        };
        const delta = zooms[e.key];
        if (delta === undefined) return;
        e.preventDefault();
        zoomByStep(delta);
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
        {t(
          'Dra for å flytte · Shift for å snu · rull for å zoome · skrives ut slik det vises',
          'Drag to move · Shift to turn · scroll to zoom · prints as shown',
        )}
      </p>
      {/* Closer and wider, and the way back from all of it. The sheet opens on
       *  whatever camera the planner was left at, which can be halfway up one
       *  bowl of a long tour, and every other control here is measured from
       *  that opening picture — the zoom counts from it and the map may only
       *  wander so far from it. Which is what makes this button load-bearing
       *  rather than a convenience: it is the only control that knows where the
       *  route is, so without it an inherited view is a dead end.
       *
       *  All of it lives inside .briefingMapLive on purpose: the print rule
       *  that hides the live map is the single thing keeping these controls off
       *  the paper. Move them out of this element and they start printing,
       *  silently. */}
      <MapZoomControls
        zoom={zoom}
        onZoom={zoomByStep}
        // A press on a button must not also be the beginning of a drag on the
        // map behind it, which would turn the map on the way to zooming it.
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="briefingMapRefit"
          onClick={(e) => {
            e.stopPropagation();
            const handle = handleRef.current;
            if (!handle) return;
            handle.reset();
            handle.capture();
            // The camera is home; the number the buttons read from has to
            // follow it, or the next press would be counted from a framing
            // that is no longer on screen.
            setZoom(0);
          }}
        >
          {t('Vis hele ruta', 'Fit the route')}
        </button>
      </MapZoomControls>
    </div>
  );
}
