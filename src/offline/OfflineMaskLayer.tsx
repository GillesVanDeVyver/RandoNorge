// Tints the map everywhere the user *can't* rely on it offline. When we lose
// connectivity (the dev simulator or a real dead zone — see
// isEffectivelyOffline), tiles outside a downloaded region either blank out or
// degrade to blurry upscaled overview tiles (OfflineTileLayer's overzoom path).
// That leaves the user guessing which part of the map is actually trustworthy.
// This layer makes it unmistakable by laying a translucent gray tint over
// everything *outside* downloaded coverage and leaving the downloaded areas
// untinted — the same read ut.no gives when you go offline outside a saved area.
//
// It works by tiling the area *outside* the downloaded rectangles with plain
// non-interactive <div>s, each a semi-transparent gray box, and leaving the
// downloaded rectangles as untinted gaps. The tint sits on top of the map
// without hiding anything.
//
// We deliberately do NOT punch holes into one big tinted div with clip-path.
// (Grayscale via backdrop-filter had a worse version of this: Chromium applies
// a backdrop filter to the element's whole box and ignores the clip path.) A
// plain background tint would clip fine, but tiling the outside with real
// rectangles (subtractRects) keeps the two maps' code paths identical and
// avoids any clip-path quirks — there is nothing to clip. The tiles live in
// their own pane between the tiles (z 200) and the vector overlays (z 400), so
// the planned route, the amber region boundaries, GPS markers, and the map
// controls all stay untinted above it.
//
// Online, this draws nothing: the effect only appears while offline, so the
// full-colour network map is never touched.

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useEffectiveOffline } from './networkMode';
import { useOfflineRegions } from './useOfflineRegions';
import { clamp, subtractRects, MASK_TINT, type Rect } from './maskGeometry';

// Poll cadence for picking up newly downloaded / deleted regions — matches
// RegionBoundaryLayer so the holes and the outlines refresh in lockstep.
const POLL_MS = 3000;

// Dedicated pane between the tile pane (z 200) and the overlay pane (z 400) so
// the tint covers the tiles but never the routes, boundaries, markers, or
// controls, which all render above it and stay untinted.
const MASK_PANE = 'offlineMask';
const MASK_PANE_Z = '350';

export function OfflineMaskLayer() {
  const map = useMap();
  const { regions, refresh } = useOfflineRegions();
  const offline = useEffectiveOffline();

  // A single wrapper positioned in layer space (so it scales with the map
  // during a zoom animation) holding a reused pool of gray-tint tile divs.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const poolRef = useRef<HTMLDivElement[]>([]);
  const updateRef = useRef<() => void>(() => {});
  // Latest offline state / region list for the map event handlers, which are
  // bound once and must read fresh values without rebinding. Synced in an
  // effect (never during render).
  const stateRef = useRef({ offline, regions });

  // Keep the region list fresh after a download or deletion without wiring an
  // event through the whole offline stack.
  useEffect(() => {
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Create the pane + overlay div once and wire it to the map's move/zoom
  // events so the tint tracks the viewport as the user pans.
  useEffect(() => {
    let pane = map.getPane(MASK_PANE);
    if (!pane) {
      pane = map.createPane(MASK_PANE);
      pane.style.zIndex = MASK_PANE_Z;
      // Never intercept clicks/drags meant for drawing the route.
      pane.style.pointerEvents = 'none';
    }

    const wrap = document.createElement('div');
    wrap.style.position = 'absolute';
    wrap.style.top = '0';
    wrap.style.left = '0';
    wrap.style.willChange = 'transform';
    pane.appendChild(wrap);
    wrapRef.current = wrap;

    // Grab (creating if needed) the i-th pooled gray-tint tile div.
    const tile = (i: number): HTMLDivElement => {
      let el = poolRef.current[i];
      if (!el) {
        el = document.createElement('div');
        el.style.position = 'absolute';
        el.style.background = MASK_TINT;
        wrap.appendChild(el);
        poolRef.current[i] = el;
      }
      return el;
    };

    // Rebuild the tiles from the current view.
    //
    // The wrapper is oversized by `pad` on every side and positioned `pad`
    // pixels above-left of the viewport in *layer* space. That matters during a
    // zoom animation: Leaflet scales the whole mapPane (and every child pane
    // with it, including ours) around the zoom origin, so a viewport-sized
    // overlay would expose untinted tiles at the edges as the pane scales
    // down. The padding keeps the tint covering the viewport throughout the
    // tween, and because the tiles ride along in the same scaled coordinate
    // space they track the downloaded regions without any per-frame work.
    const update = () => {
      const el = wrapRef.current;
      if (!el) return;
      const { offline: off, regions: regs } = stateRef.current;
      if (!off) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';

      const size = map.getSize();
      const pad = Math.round(0.7 * Math.max(size.x, size.y));
      L.DomUtil.setPosition(el, map.containerPointToLayerPoint([-pad, -pad]));
      const w = size.x + pad * 2;
      const h = size.y + pad * 2;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;

      // Downloaded regions as wrapper-local rectangles (container pixels shifted
      // by `pad`), clamped to the wrapper box — these are the untinted gaps.
      const holes: Rect[] = [];
      for (const region of regs) {
        // bounds are [south, west, north, east] (RegionMeta).
        const [south, west, north, east] = region.bounds;
        const a = map.latLngToContainerPoint([north, west]);
        const b = map.latLngToContainerPoint([south, east]);
        const x1 = clamp(Math.round(Math.min(a.x, b.x)) + pad, 0, w);
        const y1 = clamp(Math.round(Math.min(a.y, b.y)) + pad, 0, h);
        const x2 = clamp(Math.round(Math.max(a.x, b.x)) + pad, 0, w);
        const y2 = clamp(Math.round(Math.max(a.y, b.y)) + pad, 0, h);
        if (x2 > x1 && y2 > y1) holes.push([x1, y1, x2, y2]);
      }

      // Tile the box minus the gaps with gray-tint rectangles.
      const rects = subtractRects(w, h, holes);
      for (let i = 0; i < rects.length; i++) {
        const [rx1, ry1, rx2, ry2] = rects[i];
        const t = tile(i);
        t.style.display = '';
        t.style.left = `${rx1}px`;
        t.style.top = `${ry1}px`;
        t.style.width = `${rx2 - rx1}px`;
        t.style.height = `${ry2 - ry1}px`;
      }
      for (let i = rects.length; i < poolRef.current.length; i++) {
        poolRef.current[i].style.display = 'none';
      }
    };
    updateRef.current = update;

    // During the zoom animation Leaflet scales the mapPane (and our pane with
    // it), so the padded tiles scale in lockstep and keep tracking the regions
    // — no need to hide them (hiding caused the whole map to flash untinted
    // mid-zoom). We only skip the pixel recompute while the tween runs,
    // since latLngToContainerPoint returns pre-zoom pixels then, and recompute
    // once crisply on zoomend.
    let zooming = false;
    const onMove = () => {
      if (!zooming) update();
    };
    const onZoomStart = () => {
      zooming = true;
    };
    const onZoomEnd = () => {
      zooming = false;
      update();
    };

    map.on('move viewreset resize', onMove);
    map.on('zoomstart', onZoomStart);
    map.on('zoomend', onZoomEnd);
    update();

    return () => {
      map.off('move viewreset resize', onMove);
      map.off('zoomstart', onZoomStart);
      map.off('zoomend', onZoomEnd);
      wrap.remove();
      wrapRef.current = null;
      poolRef.current = [];
    };
  }, [map]);

  // Redraw when offline state flips or the downloaded regions change.
  useEffect(() => {
    stateRef.current = { offline, regions };
    updateRef.current();
  }, [offline, regions]);

  return null;
}
