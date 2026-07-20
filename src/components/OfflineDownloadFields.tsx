import { OFFLINE_LAYER_LIST, type OfflineLayerId } from '../offline/layers';
import type { DownloadProgress } from '../offline/download';
import { formatBytes } from '../offline/format';
import styles from './OfflineManager.module.css';

const MIN_DETAIL_ZOOM = 10;
const MAX_DETAIL_ZOOM = 16;
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
  snowDate: string;
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
 * The download form for an offline area: layer checkboxes, a detail (max-zoom)
 * slider with a size estimate, and the name + Download button (or progress).
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
  snowDate,
  progress,
  downloading,
  error,
  estTiles,
  estBytes,
  canDownload,
  onDownload,
  onCancel,
}: Props) {
  return (
    <>
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
            onClick={onDownload}
            disabled={!canDownload}
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
