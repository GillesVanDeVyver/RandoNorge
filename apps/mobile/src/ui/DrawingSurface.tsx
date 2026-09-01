// The transparent sheet a finger draws on, over the planner's map.
//
// PHASE 4 OF docs/mobile-web-parity-plan.md — "touch gestures on the MapLibre
// map feeding the RDP simplifier in core". This file is the gesture half of
// that sentence and nothing else: it turns a drag into points and hands them
// out. What a stroke means, what the eraser cuts, and what gets saved all
// belong to the screen that renders this, and the maths belongs to
// @fjellrute/core/draw/tools. The plan's standing rule is that nothing
// non-visual gets written inside apps/mobile, and a gesture recognizer is
// about as visual as code gets — it exists because this platform has fingers.
//
// WHY PanResponder AND NOT react-native-gesture-handler. The library is
// installed (Expo's template brings it in for the navigator), and it is the
// better tool in general: it runs recognition on the UI thread, so a stroke
// keeps up with the finger even while JavaScript is busy. Two things ruled it
// out here. It needs a GestureHandlerRootView above everything that uses it,
// and app/_layout.tsx has no such wrapper — adding one changes touch delivery
// for every screen in the app, which is not a change to make in passing on the
// way to a drawing tool. And its Android implementation needs the native module
// linked, so any bug in the wiring would show up as a dead map on a device this
// session cannot build for. PanResponder is React Native's own, needs no
// provider and no native module, and the work per touch here is a subtraction
// and a comparison. If strokes ever feel laggy on a real phone, this is the
// first thing to revisit, and the surface is small enough to swap.
//
// WHY AN OVERLAY AND NOT THE MAP'S onPress. MapLibre's press events fire on tap,
// not on drag, and they arrive with a coordinate the native side computed —
// which is the right answer, one round trip too late. Drawing needs a continuous
// stream of positions during the drag, so the touches are taken here and turned
// into coordinates with core's own projection (see @fjellrute/core/geometry/
// viewport for why the map cannot be asked).

import { useEffect, useMemo, useRef } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';
import type { LatLng, Segment } from '@fjellrute/core/types';
import { MIN_DRAW_PX2, RDP_EPSILON_M } from '@fjellrute/core/draw/tools';
import { simplify } from '@fjellrute/core/geometry';
import type { Viewport } from '@fjellrute/core/geometry/viewport';

interface Props {
  /** Which tool the finger is holding. The surface is not rendered at all in
   *  'idle' — an invisible view that swallows every touch is exactly how a map
   *  stops panning for no visible reason. */
  mode: 'draw' | 'erase';
  /** The map camera as of now. A function rather than a value because the
   *  camera changes far more often than this component should re-render, and
   *  the only moment its value matters is the instant a gesture begins. */
  getViewport: () => Viewport | null;
  /** The stroke so far, for the translucent live line — or null when there is
   *  no stroke in progress. Called at most once per frame. */
  onDrawLive: (stroke: Segment | null) => void;
  /** A finished stroke, already RDP-simplified and guaranteed two points or
   *  more. Not called for a tap or a stroke that collapses to a single point. */
  onDrawCommit: (stroke: Segment) => void;
  /** Where the eraser is, once per touch sample — and the projection that
   *  position was read through, so the caller cuts the route against exactly
   *  the camera the finger was placed on rather than re-deriving a near-copy. */
  onErase: (cursor: LatLng, viewport: Viewport) => void;
  /** The eraser has been lifted: whatever was accumulated is now an edit. */
  onEraseCommit: () => void;
}

export function DrawingSurface({
  mode,
  getViewport,
  onDrawLive,
  onDrawCommit,
  onErase,
  onEraseCommit,
}: Props) {
  // Every prop, mirrored into a ref. The PanResponder below is built once and
  // must stay built: rebuilding it while a finger is down hands the gesture to
  // a new instance with no memory of where the stroke started, and the visible
  // result is a line that restarts halfway through. Reading the callbacks out
  // of refs is what lets the responder be stable while the props are not.
  //
  // Written from an EFFECT, not during render. A ref assigned mid-render is a
  // mutation React is allowed to throw away — a render that is discarded still
  // ran the assignment — and react-hooks/refs rejects it for that reason. An
  // effect with no dependency array runs after every commit, which is exactly
  // when these values become the ones the user is looking at, and no gesture
  // callback can fire before the view they belong to is on screen.
  const latest = useRef({
    mode,
    getViewport,
    onDrawLive,
    onDrawCommit,
    onErase,
    onEraseCommit,
  });
  useEffect(() => {
    latest.current = {
      mode,
      getViewport,
      onDrawLive,
      onDrawCommit,
      onErase,
      onEraseCommit,
    };
  });

  // Per-gesture state. Refs, not state: these change many times per frame and
  // nothing renders from them directly — the live line is pushed out through
  // onDrawLive instead, on a frame budget.
  const strokeRef = useRef<Segment | null>(null);
  const lastPxRef = useRef<{ x: number; y: number } | null>(null);
  // The camera frozen at the moment the gesture began. Frozen rather than read
  // per sample because a stroke has to be cut out of one map: if the camera
  // moved mid-drag, the earlier points were placed against the earlier view and
  // re-reading would kink the line at the moment it moved. The planner disables
  // the map's own one-finger pan while a tool is active precisely so this
  // cannot happen, and freezing makes that a guarantee rather than a hope.
  const viewportRef = useRef<Viewport | null>(null);
  const rafRef = useRef<number | null>(null);

  // react-hooks/refs is switched off for the responder, exactly as
  // apps/web/src/components/DrawingHandler.tsx switches it off around its
  // Leaflet handles, and for the same reason. Every function below is a touch
  // callback and so can only run after a commit — but the rule cannot see
  // that: `PanResponder.create` is an opaque function being handed closures
  // that read refs, and as far as the compiler knows it might call one of them
  // immediately, during render. Re-enabled on the far side of the responder.
  /* eslint-disable react-hooks/refs */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Claim single-finger touches only. A two-finger touch is a pinch or a
        // rotate, and declining here means the responder system never takes it
        // from the map underneath — so the user can still zoom and rotate with
        // a tool in hand, which on a phone is not a luxury: the eraser's reach
        // is measured in screen pixels, so zooming IS how its size is chosen.
        onStartShouldSetPanResponder: (evt) => touchCount(evt) === 1,
        onMoveShouldSetPanResponder: (evt) => touchCount(evt) === 1,
        // Once drawing, keep the gesture. Anything that asks for it — a parent
        // scroll view, the sheet — would take the finger off mid-line.
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (evt) => {
          const viewport = latest.current.getViewport();
          viewportRef.current = viewport;
          // No camera yet means the map has not reported one and has not been
          // laid out. Doing nothing is right: the alternative is placing the
          // point against a guessed view, which puts the line somewhere the
          // user did not touch and looks like a bug in the map.
          if (!viewport) return;
          const { x, y } = locationOf(evt);
          const ll = viewport.unproject(x, y);
          if (latest.current.mode === 'draw') {
            strokeRef.current = [ll];
            lastPxRef.current = { x, y };
            latest.current.onDrawLive([ll]);
          } else {
            latest.current.onErase(ll, viewport);
          }
        },

        onPanResponderMove: (evt) => {
          const viewport = viewportRef.current;
          if (!viewport) return;
          // A second finger arriving mid-stroke ends the stroke rather than
          // bending it: the two touches average into a point between them, and
          // what the user is doing is starting a pinch, not drawing. Committing
          // keeps the part they did draw. Same rule as the web's 3D view.
          if (touchCount(evt) > 1) {
            finish();
            return;
          }
          const { x, y } = locationOf(evt);

          if (latest.current.mode === 'erase') {
            latest.current.onErase(viewport.unproject(x, y), viewport);
            return;
          }

          const stroke = strokeRef.current;
          if (!stroke) return;
          const last = lastPxRef.current;
          if (last) {
            const dx = x - last.x;
            const dy = y - last.y;
            // Below the threshold the point carries no shape, only cost. See
            // MIN_DRAW_PX in core for what that cost turns into on a long drag.
            if (dx * dx + dy * dy < MIN_DRAW_PX2) return;
          }
          lastPxRef.current = { x, y };
          stroke.push(viewport.unproject(x, y));
          scheduleLive();
        },

        onPanResponderRelease: () => finish(),
        onPanResponderTerminate: () => finish(),
      }),
    // Built once for the life of the component. Every moving part it needs is
    // behind a ref, so there is nothing here to depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  /* eslint-enable react-hooks/refs */

  // Push the in-progress stroke out at most once per frame. Each call crosses
  // the bridge to replace a GeoJSON source, and touch samples arrive faster
  // than the map can redraw, so an unthrottled push spends the frame budget
  // sending frames that are already stale.
  function scheduleLive() {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const stroke = strokeRef.current;
      // A copy, because the array behind it keeps growing and React would see
      // the same reference and skip the update.
      if (stroke) latest.current.onDrawLive(stroke.slice());
    });
  }

  function cancelLive() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  function finish() {
    cancelLive();
    const stroke = strokeRef.current;
    strokeRef.current = null;
    lastPxRef.current = null;
    viewportRef.current = null;

    if (latest.current.mode === 'erase') {
      latest.current.onEraseCommit();
      return;
    }

    latest.current.onDrawLive(null);
    if (!stroke) return;
    // RDP at core's tolerance, which is the whole point of the phase: the same
    // drag has to become the same route here as it does in a browser.
    const simplified = simplify(stroke, RDP_EPSILON_M);
    // A tap, or a stroke that collapsed to one point, is not a route. Dropping
    // it here means the screen never has to think about zero-length segments.
    if (simplified.length >= 2) latest.current.onDrawCommit(simplified);
  }

  return (
    <View
      style={StyleSheet.absoluteFill}
      {...panResponder.panHandlers}
      // The surface is the whole reason the tool works, and it is invisible, so
      // it says what it is. Without this a screen reader finds a large unlabelled
      // element covering the map and nothing to explain it.
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** How many fingers are on the screen right now.
 *
 *  `touches` is the full list for the gesture; `changedTouches` is only the
 *  ones that moved. The count has to come from the former, or a two-finger
 *  pinch where one finger is still reads as a single touch. */
function touchCount(evt: GestureResponderEvent): number {
  return evt.nativeEvent.touches.length;
}

/** Where the touch is, in this view's own pixels.
 *
 *  locationX/locationY rather than pageX/pageY: page coordinates are measured
 *  from the top of the window, which on this screen is above the navigation
 *  header, and the map's projection starts at the top of the map. The surface
 *  is stretched over exactly the map, so its local coordinates and the map's
 *  are the same coordinates. */
function locationOf(evt: GestureResponderEvent): { x: number; y: number } {
  return { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY };
}
