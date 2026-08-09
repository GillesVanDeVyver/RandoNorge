import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import { RegionSelector } from './RegionSelector';
import { OfflineDownloadFields } from './OfflineDownloadFields';
import { ChevronRightIcon, CloseIcon } from './icons';
import { useOfflineDownload } from '../offline/useOfflineDownload';
import { useOfflineRegions } from '../offline/useOfflineRegions';
import { formatBytes } from '../offline/format';
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
  // summary on that link and to name a new download ("Area 3"); `refresh()`
  // keeps both current after one finishes.
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

  // What the panel says about everything already downloaded, now that it no
  // longer lists it: how many areas and how much disk they take. Enough to
  // answer "have I got this covered, and is it getting out of hand?" without
  // leaving the planner; the page behind the link answers everything else.
  const totalBytes = regions.reduce((sum, r) => sum + r.bytes, 0);
  const summary =
    regions.length === 0
      ? t('Ingen områder ennå', 'No areas yet')
      : `${regions.length} ${
          regions.length === 1
            ? t('område', 'area')
            : t('områder', 'areas')
        } · ${formatBytes(totalBytes)}`;

  const summaryText = (
    <span className={styles.summaryText}>
      <span className={styles.summaryLabel}>
        {t('Nedlastede kart', 'Downloaded maps')}
      </span>
      <span className={styles.summaryMeta}>{summary}</span>
    </span>
  );

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

            {/* Already-downloaded areas used to be listed here, one row each.
                Two screens showed the same list, and this one — squeezed
                beside the planner's map — could neither frame an area nor
                confirm a deletion. What's left is the part worth having
                while planning (how much is covered, and how big it's got),
                pointing at the page that does the rest.

                Guests can download areas too but have no account page to
                link to, so without the callback the same summary renders as
                plain text rather than vanishing. */}
            <div className={styles.divider} />

            {onOpenOfflineMaps ? (
              <button
                type="button"
                className={styles.summaryBtn}
                onClick={onOpenOfflineMaps}
              >
                {summaryText}
                <ChevronRightIcon />
              </button>
            ) : (
              <div className={styles.summaryRow}>{summaryText}</div>
            )}
          </>
        )}
      </div>
    </>
  );
}
