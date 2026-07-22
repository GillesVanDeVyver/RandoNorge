import {
  DOWNLOADABLE_LAYER_LIST,
  effectiveDownloadZoom,
  type OfflineLayer,
  type OfflineLayerId,
} from '../offline/layers';
import type { DownloadProgress } from '../offline/download';
import { formatBytes, formatResolution } from '../offline/format';
import styles from './OfflineManager.module.css';

const MIN_DETAIL_ZOOM = 10;
const MAX_DETAIL_ZOOM = 18;
// Above this many tiles the estimate is flagged so people don't kick off a
// multi-hundred-megabyte download by accident.
const LARGE_TILE_WARNING = 6000;

interface Props {
  layerIds: OfflineLayerId[];
  toggleLayer: (id: OfflineLayerId) => void;
  maxZoom: number;
  setMaxZoom: (z: number) => void;
  name: string;
  setName: (s: string) => void;
  progress: DownloadProgress | null;
  downloading: boolean;
  error: string | null;
  estTiles: number;
  estBytes: number;
  canDownload: boolean;
  onDownload: () => void;
  onCancel: () => void;
}

/**
 * The download form for an offline area: layer checkboxes, a detail slider
 * (labelled as a ground resolution) with a size estimate, and the name +
 * Download button (or progress).
 * Purely presentational — all state lives in useOfflineDownload — so both the
 * planner's OfflineManager and the offline maps page render an identical form.
 */
export function OfflineDownloadFields({
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
  onDownload,
  onCancel,
}: Props) {
  // When the detail slider asks for finer tiles than a layer can be stored at
  // offline, say so plainly under that layer — otherwise "finest detail"
  // over-promises. Topo is capped by Kartverket licensing (z12+ Geovekst tiles
  // may be shown live but not copied to disk); the other layers are capped by
  // their own source resolution. Returns null when the slider is within range.
  const offlineCapNote = (layer: OfflineLayer): string | null => {
    const effZoom = effectiveDownloadZoom(layer, maxZoom);
    if (effZoom >= maxZoom) return null;
    return `Stored offline at ${formatResolution(effZoom)} max`;
  };

  return (
    <>
      <fieldset className={styles.group} disabled={downloading}>
        <legend className={styles.legend}>Layers</legend>
        {DOWNLOADABLE_LAYER_LIST.map((layer) => {
          const selected = layerIds.includes(layer.id);
          const capNote = selected ? offlineCapNote(layer) : null;
          return (
            <label key={layer.id} className={styles.checkRow}>
              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggleLayer(layer.id)}
              />
              <span className={styles.checkText}>
                <span className={styles.checkLabel}>{layer.label}</span>
                <span className={styles.checkDesc}>{layer.description}</span>
                {capNote && <span className={styles.checkCap}>{capNote}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className={styles.group}>
        <label className={styles.sliderRow}>
          <span>Finest detail: {formatResolution(maxZoom)}</span>
          <input
            type="range"
            min={MIN_DETAIL_ZOOM}
            max={MAX_DETAIL_ZOOM}
            value={maxZoom}
            disabled={downloading}
            aria-label="Finest map detail (more detail means a larger download)"
            onChange={(e) => setMaxZoom(Number(e.target.value))}
          />
        </label>
        <p className={styles.estimate}>
          ≈{formatBytes(estBytes)}
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
            onClick={onDownload}
            disabled={!canDownload}
          >
            Download on this device
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
              {progress && progress.total
                ? Math.round((progress.completed / progress.total) * 100)
                : 0}
              % · {formatBytes(progress?.bytes ?? 0)}
            </span>
            <button
              type="button"
              className={styles.secondary}
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </>
  );
}
