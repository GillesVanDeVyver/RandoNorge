// Region-selection + download state for taking a rectangle of the map offline.
//
// This is the logic behind the "save this area for offline use" flow. It was
// extracted from OfflineManager so the exact same behaviour can be reused both
// in the planner's manager panel and on the standalone offline maps page. It
// must be called from inside a <MapContainer> (it reads the live Leaflet map to
// seed the selection rectangle).

import { useCallback, useMemo, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import type { OfflineLayerId } from './layers';
import {
  OVERVIEW_MIN_ZOOM,
  downloadRegion,
  estimateTiles,
  type DownloadPlan,
  type DownloadProgress,
} from './download';
import type { Bounds } from './tileMath';

// Rough average weight of one PNG map tile, used only for the pre-download size
// estimate shown to the user (actual stored bytes are measured as they arrive).
const AVG_TILE_BYTES = 26_000;

/** Central inset of the current view — a sensible starting rectangle. */
function initialBounds(map: LeafletMap): Bounds {
  const b = map.getBounds();
  const latPad = (b.getNorth() - b.getSouth()) * 0.2;
  const lngPad = (b.getEast() - b.getWest()) * 0.2;
  return [
    b.getSouth() + latPad,
    b.getWest() + lngPad,
    b.getNorth() - latPad,
    b.getEast() - lngPad,
  ];
}

interface Options {
  /** Active snow-depth date (YYYY-MM-DD) — cached when that layer is chosen. */
  snowDate: string;
  /** Existing region count, used only to name a new area ("Area 3"). */
  regionCount: number;
  /** Called after a successful download so callers can refresh their lists. */
  onDownloaded?: () => void;
}

export function useOfflineDownload({ snowDate, regionCount, onDownloaded }: Options) {
  const map = useMap();

  // Seed the selection rectangle from the current view on mount.
  const [bounds, setBounds] = useState<Bounds>(() => initialBounds(map));
  const [layerIds, setLayerIds] = useState<OfflineLayerId[]>(['topo']);
  const [maxZoom, setMaxZoom] = useState(14);
  const [name, setName] = useState('');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const downloading = progress !== null;

  const plan: DownloadPlan | null = useMemo(() => {
    if (layerIds.length === 0) return null;
    return {
      bounds,
      layerIds,
      maxZoom,
      minZoom: OVERVIEW_MIN_ZOOM,
      snowDate,
      name: name.trim() || `Area ${regionCount + 1}`,
    };
  }, [bounds, layerIds, maxZoom, snowDate, name, regionCount]);

  const estTiles = plan ? estimateTiles(plan) : 0;
  const estBytes = estTiles * AVG_TILE_BYTES;
  const canDownload = plan !== null && estTiles > 0;

  const toggleLayer = useCallback((id: OfflineLayerId) => {
    setLayerIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const handleDownload = useCallback(async () => {
    if (!plan) return;
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ completed: 0, total: estTiles, failed: 0, bytes: 0 });
    try {
      await downloadRegion(plan, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      onDownloaded?.();
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setError('Download failed. Check your connection and try again.');
      }
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  }, [plan, estTiles, onDownloaded]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    bounds,
    setBounds,
    layerIds,
    toggleLayer,
    maxZoom,
    setMaxZoom,
    name,
    setName,
    progress,
    downloading,
    error,
    estTiles,
    estBytes,
    canDownload,
    handleDownload,
    handleCancel,
  };
}
