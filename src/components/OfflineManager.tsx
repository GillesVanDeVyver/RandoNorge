import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import { RegionSelector } from './RegionSelector';
import { OfflineDownloadFields } from './OfflineDownloadFields';
import { ChevronRightIcon, CloseIcon } from './icons';
import { useOfflineDownload } from '../offline/useOfflineDownload';
import { useOfflineRegions } from '../offline/useOfflineRegions';
import { useT } from '../i18n/index.ts';
import styles from './OfflineManager.module.css';

interface Props {
  onClose: () => void;
  /** Active snow-depth date (YYYY-MM-DD) — cached when that layer is chosen. */
  snowDate: string;
  /** Called after a download or deletion so cached layers can redraw. */
  onCacheChange?: () => void;
  /**
   * Navigate to the downloaded offline maps page (/alpha/offline), where
   * saved areas are reviewed, framed on the map and removed. Absent in guest
   * mode — that page lives behind a sign-in — and the link then isn't shown.
   */
  onOpenOfflineMaps?: () => void;
}

export function OfflineManager({
  onClose,
  snowDate,
  onCacheChange,
  onOpenOfflineMaps,
}: Props) {
  const t = useT();
  // The saved areas are no longer listed here — that belongs to the offline
  // maps page, linked at the bottom of this panel. They're still read for the
  // count, which names a new download ("Area 3"), and `refresh()` keeps that
  // count right after one finishes.
  const { regions, supported, refresh } = useOfflineRegions();

  const onDownloaded = useCallback(async () => {
    await refresh();
    onCacheChange?.();
  }, [refresh, onCacheChange]);

  const dl = useOfflineDownload({
    snowDate,
    regionCount: regions.length,
    onDownloaded,
  });

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
        aria-label={t('Offline-kart', 'Offline maps')}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{t('Offline-kart', 'Offline maps')}</h2>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label={t('Lukk offline-kart', 'Close offline maps')}
          >
            <CloseIcon />
          </button>
        </div>

        {supported === false ? (
          <p className={styles.note}>
            {t(
              'Offline-lagring er ikke tilgjengelig i denne nettleseren (den kan være i privat modus). Nedlastede kart trenger IndexedDB.',
              'Offline storage isn’t available in this browser (it may be in private mode). Downloaded maps need IndexedDB.',
            )}
          </p>
        ) : (
          <>
            <p className={styles.hint}>
              {t(
                'Dra rektangelet på kartet slik at det dekker området du vil ha tilgjengelig offline, og velg deretter lag og detaljnivå nedenfor.',
                'Drag the rectangle on the map to cover the area you want available offline, then pick the layers and detail below.',
              )}
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

            {/* Already-downloaded areas used to be listed here. Two screens
                showed the same list, and this one — squeezed beside the
                planner's map — could neither frame an area nor confirm a
                deletion. It now points at the page that does both. */}
            {onOpenOfflineMaps && (
              <>
                <div className={styles.divider} />
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={onOpenOfflineMaps}
                >
                  <span>{t('Nedlastede kart', 'Downloaded maps')}</span>
                  <ChevronRightIcon />
                </button>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
