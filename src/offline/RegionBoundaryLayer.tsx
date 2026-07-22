// Draws the outline of every downloaded region on the map so it's always
// obvious where full-detail offline coverage actually is. Outside these
// rectangles the map either blanks out or (offline) degrades to upscaled
// overview tiles — see OfflineTileLayer's overzoom path — which otherwise
// leaves the user guessing how far their "good" map extends.
//
// Each region is drawn as a bright outline over a white casing (so it stays
// legible on any terrain) with a small label at the top-left corner stating
// the finest ground resolution that was downloaded. The vectors are
// non-interactive: they must never intercept the pointer, or they'd swallow
// the strokes the DrawingHandler needs to plan a route.

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { formatResolution } from './format';
import { useRegionsVisible } from './regionOverlayMode';
import { useOfflineRegions } from './useOfflineRegions';

// Poll cadence for picking up newly downloaded / deleted regions. Matches the
// dev offline simulator's cheap poll — no extra plumbing into the download
// flow, and a couple of seconds' lag on the outline is imperceptible.
const POLL_MS = 3000;

export function RegionBoundaryLayer() {
  const map = useMap();
  const { regions, refresh } = useOfflineRegions();
  const visible = useRegionsVisible();
  const groupRef = useRef<L.LayerGroup | null>(null);

  // Keep the list fresh after a download or deletion without wiring an event
  // through the whole offline stack.
  useEffect(() => {
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // One LayerGroup for the lifetime of the map; contents are swapped when the
  // region list changes.
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    return () => {
      group.remove();
      groupRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    if (!visible) return;

    for (const region of regions) {
      // bounds are stored as [south, west, north, east] (see RegionMeta).
      const [south, west, north, east] = region.bounds;
      const bounds: L.LatLngBoundsExpression = [
        [south, west],
        [north, east],
      ];

      // White casing underneath so the coloured outline reads against dark
      // forest, bright snow, or busy topo lines alike.
      const casing = L.rectangle(bounds, {
        color: '#ffffff',
        weight: 6,
        opacity: 0.7,
        fill: false,
        interactive: false,
      });
      const outline = L.rectangle(bounds, {
        color: '#f5a623',
        weight: 3,
        opacity: 1,
        dashArray: '10 6',
        fill: true,
        fillColor: '#f5a623',
        fillOpacity: 0.07,
        interactive: false,
      });
      group.addLayer(casing);
      group.addLayer(outline);

      // Resolution label pinned to the top-left (north-west) corner rather than
      // floating in the middle of the area. Reuses the same zoom→resolution
      // scale the download slider shows, so the on-map figure matches what the
      // user picked when caching the area.
      const label = L.tooltip({
        permanent: true,
        direction: 'right',
        // Nudge in from the corner so the chip sits just inside the rectangle.
        offset: [8, 10],
        className: 'offline-region-label',
        interactive: false,
      })
        .setLatLng([north, west])
        .setContent(`Detail to ${formatResolution(region.maxZoom)}`);
      group.addLayer(label);
    }
  }, [regions, visible]);

  return null;
}
