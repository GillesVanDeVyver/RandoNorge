import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import { RegionSelector } from './RegionSelector';
import { OfflineDownloadFields } from './OfflineDownloadFields';
import { CloseIcon, TrashIcon } from './icons';
import { OFFLINE_LAYER_LIST } from '../offline/layers';
import { removeRegion } from '../offline/download';
import { useOfflineDownload } from '../offline/useOfflineDownload';
import { useOfflineRegions } from '../offline/useOfflineRegions';
import { formatBytes, formatResolution } from '../offline/format';
import { useT } from '../i18n/index.ts';
import styles from './OfflineManager.module.css';

interface Props {
  onClose: () => void;
  /** Active snow-depth date (YYYY-MM-DD) — cached when that layer is chosen. */
  snowDate: string;
  /** Called after a download or deletion so cached layers can redraw. */
  onCacheChange?: () => void;
}

export function OfflineManager({ onClose, snowDate, onCacheChange }: Props) {
  const t = useT();
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

  const handleDelete = useCallback(
    async (id: string) => {
      await removeRegion(id);
      await refresh();
      onCacheChange?.();
    },
    [refresh, onCacheChange],
  );

  const totalBytes = regions.reduce((sum, r) => sum + r.bytes, 0);

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

            <div className={styles.divider} />

            <div className={styles.savedHeader}>
              <h3 className={styles.subtitle}>
                {t('Nedlastede områder', 'Downloaded areas')}
              </h3>
              {regions.length > 0 && (
                <span className={styles.total}>{formatBytes(totalBytes)}</span>
              )}
            </div>

            {regions.length === 0 ? (
              <p className={styles.note}>
                {t('Ingen områder lastet ned ennå.', 'No areas downloaded yet.')}
              </p>
            ) : (
              <ul className={styles.regionList}>
                {regions.map((r) => (
                  <li key={r.id} className={styles.regionItem}>
                    <div className={styles.regionInfo}>
                      <span className={styles.regionName}>{r.name}</span>
                      <span className={styles.regionMeta}>
                        {formatResolution(r.maxZoom)} · {formatBytes(r.bytes)}
                      </span>
                      <span className={styles.regionMeta}>
                        {r.layerIds
                          .map(
                            (id) =>
                              OFFLINE_LAYER_LIST.find((l) => l.id === id)?.label() ??
                              id,
                          )
                          .join(', ')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => handleDelete(r.id)}
                      aria-label={t(`Slett ${r.name}`, `Delete ${r.name}`)}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
}
