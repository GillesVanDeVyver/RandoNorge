import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { RegionSelector } from './RegionSelector';
import { OfflineDownloadFields } from './OfflineDownloadFields';
import { CloseIcon } from './icons';
import { useOfflineDownload } from '../offline/useOfflineDownload';
import styles from './OfflineManager.module.css';

interface Props {
  /** Active snow-depth date (YYYY-MM-DD) — cached when that layer is chosen. */
  snowDate: string;
  /** Existing region count, used only to name a new area ("Area 3"). */
  regionCount: number;
  /** Close the download panel. */
  onClose: () => void;
  /** Called after a successful download so the caller can refresh its list. */
  onDownloaded?: () => void;
}

/**
 * Standalone "download an area for offline use" panel: the draggable selection
 * rectangle on the map plus the download form, floating over the map. This is
 * the same flow used when saving a route (OfflineManager), reused here so the
 * offline maps page can add new areas. Must be rendered inside a <MapContainer>.
 */
export function OfflineDownloadPanel({
  snowDate,
  regionCount,
  onClose,
  onDownloaded,
}: Props) {
  const dl = useOfflineDownload({ snowDate, regionCount, onDownloaded });
  const panelRef = useRef<HTMLDivElement>(null);

  // Keep panel clicks/scrolls from leaking into the map behind it.
  useEffect(() => {
    const el = panelRef.current;
    if (el) {
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
    }
  }, []);

  return (
    <>
      <RegionSelector bounds={dl.bounds} onChange={dl.setBounds} />
      <div
        className={styles.panel}
        ref={panelRef}
        role="dialog"
        aria-label="Download offline area"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Download area</h2>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close download panel"
          >
            <CloseIcon />
          </button>
        </div>

        <p className={styles.hint}>
          Drag the rectangle on the map to cover the area you want available
          offline, then pick the layers and detail below.
        </p>

        <OfflineDownloadFields
          layerIds={dl.layerIds}
          toggleLayer={dl.toggleLayer}
          maxZoom={dl.maxZoom}
          setMaxZoom={dl.setMaxZoom}
          name={dl.name}
          setName={dl.setName}
          progress={dl.progress}
          downloading={dl.downloading}
          error={dl.error}
          estTiles={dl.estTiles}
          estBytes={dl.estBytes}
          canDownload={dl.canDownload}
          onDownload={dl.handleDownload}
          onCancel={dl.handleCancel}
        />
      </div>
    </>
  );
}
