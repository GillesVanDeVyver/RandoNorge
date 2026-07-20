import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { RegionSelector } from './RegionSelector';
import { CloseIcon, TrashIcon } from './icons';
import {
  OFFLINE_LAYER_LIST,
  type OfflineLayerId,
} from '../offline/layers';
import {
  OVERVIEW_MIN_ZOOM,
  downloadRegion,
  estimateTiles,
  removeRegion,
  type DownloadPlan,
  type DownloadProgress,
} from '../offline/download';
import { clearAllOffline } from '../offline/db';
import { useOfflineRegions } from '../offline/useOfflineRegions';
import type { Bounds } from '../offline/tileMath';
import styles from './OfflineManager.module.css';

interface Props {
  onClose: () => void;
  /** Active snow-depth date (YYYY-MM-DD) — cached when that layer is chosen. */
  snowDate: string;
  /** Called after a download or deletion so cached layers can redraw. */
  onCacheChange?: () => void;
}

// Rough average weight of one PNG map tile, used only for the pre-download size
// estimate shown to the user (actual stored bytes are measured as they arrive).
const AVG_TILE_BYTES = 26_000;
const MIN_DETAIL_ZOOM = 10;
const MAX_DETAIL_ZOOM = 16;
// Above this many tiles the estimate is flagged so people don't kick off a
// multi-hundred-megabyte download by accident.
const LARGE_TILE_WARNING = 6000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Central inset of the current view — a sensible starting rectangle. */
function initialBounds(map: L.Map): Bounds {
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

export function OfflineManager({ onClose, snowDate, onCacheChange }: Props) {
  const map = useMap();
  const { regions, supported, refresh } = useOfflineRegions();

  // Seed the selection rectangle from the current view on mount (the component
  // is only mounted while the panel is open, so this runs once per open).
  const [bounds, setBounds] = useState<Bounds>(() => initialBounds(map));
  const [layerIds, setLayerIds] = useState<OfflineLayerId[]>(['topo']);
  const [maxZoom, setMaxZoom] = useState(14);
  const [name, setName] = useState('');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Keep panel clicks/scrolls from leaking into the map behind it.
  useEffect(() => {
    const el = panelRef.current;
    if (el) {
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
    }
  }, []);

  const downloading = progress !== null;

  const plan: DownloadPlan | null = useMemo(() => {
    if (layerIds.length === 0) return null;
    return {
      bounds,
      layerIds,
      maxZoom,
      minZoom: OVERVIEW_MIN_ZOOM,
      snowDate,
      name: name.trim() || `Area ${regions.length + 1}`,
    };
  }, [bounds, layerIds, maxZoom, snowDate, name, regions.length]);

  const estTiles = plan ? estimateTiles(plan) : 0;
  const estBytes = estTiles * AVG_TILE_BYTES;

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
      await refresh();
      onCacheChange?.();
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setError('Download failed. Check your connection and try again.');
      }
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  }, [plan, estTiles, refresh, onCacheChange]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      await removeRegion(id);
      await refresh();
      onCacheChange?.();
    },
    [refresh, onCacheChange],
  );

  const handleClearAll = useCallback(async () => {
    await clearAllOffline();
    await refresh();
    onCacheChange?.();
  }, [refresh, onCacheChange]);

  const totalBytes = regions.reduce((sum, r) => sum + r.bytes, 0);

  return (
    <>
      <RegionSelector bounds={bounds} onChange={setBounds} />
      <div className={styles.panel} ref={panelRef} role="dialog" aria-label="Offline maps">
        <div className={styles.header}>
          <h2 className={styles.title}>Offline maps</h2>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close offline maps"
          >
            <CloseIcon />
          </button>
        </div>

        {supported === false ? (
          <p className={styles.note}>
            Offline storage isn’t available in this browser (it may be in
            private mode). Downloaded maps need IndexedDB.
          </p>
        ) : (
          <>
            <p className={styles.hint}>
              Drag the rectangle on the map to cover the area you want available
              offline, then pick the layers and detail below.
            </p>

            <fieldset className={styles.group} disabled={downloading}>
              <legend className={styles.legend}>Layers</legend>
              {OFFLINE_LAYER_LIST.map((layer) => (
                <label key={layer.id} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={layerIds.includes(layer.id)}
                    onChange={() => toggleLayer(layer.id)}
                  />
                  <span className={styles.checkText}>
                    <span className={styles.checkLabel}>{layer.label}</span>
                    <span className={styles.checkDesc}>{layer.description}</span>
                  </span>
                </label>
              ))}
              {layerIds.includes('snowdepth') && (
                <p className={styles.subnote}>Snow depth cached for {snowDate}.</p>
              )}
            </fieldset>

            <div className={styles.group}>
              <label className={styles.sliderRow}>
                <span>Detail (max zoom): {maxZoom}</span>
                <input
                  type="range"
                  min={MIN_DETAIL_ZOOM}
                  max={MAX_DETAIL_ZOOM}
                  value={maxZoom}
                  disabled={downloading}
                  onChange={(e) => setMaxZoom(Number(e.target.value))}
                />
              </label>
              <p className={styles.estimate}>
                ~{estTiles.toLocaleString()} tiles · ≈{formatBytes(estBytes)}
                {estTiles > LARGE_TILE_WARNING && (
                  <span className={styles.warn}> — large download</span>
                )}
              </p>
            </div>

            {!downloading ? (
              <div className={styles.actions}>
                <input
                  type="text"
                  className={styles.nameInput}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Area name (optional)"
                  maxLength={60}
                />
                <button
                  type="button"
                  className={styles.primary}
                  onClick={handleDownload}
                  disabled={!plan || estTiles === 0}
                >
                  Download
                </button>
              </div>
            ) : (
              <div className={styles.progressWrap}>
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{
                      width: `${
                        progress && progress.total
                          ? Math.round((progress.completed / progress.total) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <div className={styles.progressRow}>
                  <span>
                    {progress?.completed.toLocaleString()} /{' '}
                    {progress?.total.toLocaleString()} tiles ·{' '}
                    {formatBytes(progress?.bytes ?? 0)}
                  </span>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={handleCancel}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.divider} />

            <div className={styles.savedHeader}>
              <h3 className={styles.subtitle}>Downloaded areas</h3>
              {regions.length > 0 && (
                <span className={styles.total}>{formatBytes(totalBytes)}</span>
              )}
            </div>

            {regions.length === 0 ? (
              <p className={styles.note}>No areas downloaded yet.</p>
            ) : (
              <ul className={styles.regionList}>
                {regions.map((r) => (
                  <li key={r.id} className={styles.regionItem}>
                    <div className={styles.regionInfo}>
                      <span className={styles.regionName}>{r.name}</span>
                      <span className={styles.regionMeta}>
                        z{r.minZoom}–{r.maxZoom} · {r.tileCount.toLocaleString()}{' '}
                        tiles · {formatBytes(r.bytes)}
                      </span>
                      <span className={styles.regionMeta}>
                        {r.layerIds
                          .map(
                            (id) =>
                              OFFLINE_LAYER_LIST.find((l) => l.id === id)?.label ??
                              id,
                          )
                          .join(', ')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => handleDelete(r.id)}
                      aria-label={`Delete ${r.name}`}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {regions.length > 1 && (
              <button
                type="button"
                className={styles.clearAll}
                onClick={handleClearAll}
              >
                Remove all offline maps
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}
