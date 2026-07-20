import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Rectangle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeftIcon, DownloadIcon, TrashIcon } from './icons';
import { OfflineTileLayerComponent } from '../offline/OfflineTileLayerComponent';
import { OfflineDownloadPanel } from './OfflineDownloadPanel';
import { OFFLINE_LAYER_LIST } from '../offline/layers';
import { removeRegion } from '../offline/download';
import { clearAllOffline } from '../offline/db';
import { useOfflineRegions } from '../offline/useOfflineRegions';
import { formatBytes } from '../offline/format';
import styles from './OfflineMapsPage.module.css';

interface Props {
  /** Back to the account overview. */
  onBack: () => void;
}

const INITIAL_CENTER: [number, number] = [65, 13];
const INITIAL_ZOOM = 5;

// Leaflet only re-measures on its own resize events; when the surrounding
// flex layout reshapes (e.g. the mobile stacked layout) the map keeps drawing
// for the old size until invalidated. A ResizeObserver covers every change.
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

// Re-frames the map on the given bounds whenever they change: the union of
// all downloaded areas on load, or a single area once its row is selected.
function FitToBounds({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds || !bounds.isValid()) return;
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 12, animate: true });
  }, [bounds, map]);
  return null;
}

/**
 * Downloaded offline maps, reached from the account overview. The map on the
 * left plots every downloaded area as a highlighted rectangle over an
 * otherwise plain base map; the panel on the right lists each area with its
 * size and layers and lets the user remove them or download a new area.
 * Selecting a row frames that area on the map.
 */
export function OfflineMapsPage({ onBack }: Props) {
  const { regions, supported, refresh } = useOfflineRegions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Two-step "remove all" so a single tap can't wipe every download.
  const [clearArmed, setClearArmed] = useState(false);
  // Whether the download-a-new-area panel is open over the map.
  const [downloadOpen, setDownloadOpen] = useState(false);

  // No active date selection on this page, so snapshot the snow-depth layer
  // (if chosen) for today — the same default the planner would start from.
  const snowDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Union of every downloaded area — the default framing on load. Memoised so
  // its identity only changes when the region list does (keeps the fit effect
  // from re-running on every render).
  const allBounds = useMemo(() => {
    if (regions.length === 0) return null;
    const b = L.latLngBounds([]);
    for (const r of regions) {
      b.extend([r.bounds[0], r.bounds[1]]);
      b.extend([r.bounds[2], r.bounds[3]]);
    }
    return b;
  }, [regions]);

  const selectedBounds = useMemo(() => {
    const r = regions.find((x) => x.id === selectedId);
    if (!r) return null;
    return L.latLngBounds(
      [r.bounds[0], r.bounds[1]],
      [r.bounds[2], r.bounds[3]],
    );
  }, [regions, selectedId]);

  const fitBounds = selectedBounds ?? allBounds;
  const totalBytes = regions.reduce((sum, r) => sum + r.bytes, 0);

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      await removeRegion(id);
      await refresh();
      setConfirmId(null);
      setSelectedId((s) => (s === id ? null : s));
    } finally {
      setBusyId(null);
    }
  };

  const handleClearAll = async () => {
    await clearAllOffline();
    await refresh();
    setSelectedId(null);
    setConfirmId(null);
    setClearArmed(false);
  };

  return (
    <div className={styles.page}>
      <div className={styles.mapPane}>
        {!downloadOpen && (
          <button type="button" className={styles.backBtn} onClick={onBack}>
            <ArrowLeftIcon />
            Overview
          </button>
        )}
        <MapContainer
          center={INITIAL_CENTER}
          zoom={INITIAL_ZOOM}
          minZoom={3}
          maxZoom={18}
          zoomControl={false}
          attributionControl={false}
          className={styles.map}
        >
          <OfflineTileLayerComponent layerId="topo" maxNativeZoom={16} />
          {regions.map((r) => {
            const active = r.id === selectedId;
            return (
              <Rectangle
                key={r.id}
                bounds={[
                  [r.bounds[0], r.bounds[1]],
                  [r.bounds[2], r.bounds[3]],
                ]}
                pathOptions={{
                  color: '#2dd4bf',
                  weight: active ? 3 : 2,
                  fillColor: '#2dd4bf',
                  fillOpacity: active ? 0.3 : 0.12,
                }}
                eventHandlers={{ click: () => setSelectedId(r.id) }}
              />
            );
          })}
          <FitToBounds bounds={fitBounds} />
          <InvalidateOnResize />
          {downloadOpen && supported !== false && (
            <OfflineDownloadPanel
              snowDate={snowDate}
              regionCount={regions.length}
              onClose={() => setDownloadOpen(false)}
              onDownloaded={refresh}
            />
          )}
        </MapContainer>
      </div>

      <aside className={styles.panel}>
        <header className={styles.header}>
          <span className={styles.headerIcon}>
            <DownloadIcon />
          </span>
          <h1 className={styles.title}>
            Offline maps
            <span className={`${styles.countPill} tnum`}>{regions.length}</span>
          </h1>
        </header>

        {supported === false ? (
          <p className={styles.intro}>
            Offline storage isn’t available in this browser (it may be in
            private mode). Downloaded maps need IndexedDB.
          </p>
        ) : (
          <>
            <button
              type="button"
              className={styles.downloadBtn}
              onClick={() => setDownloadOpen(true)}
              disabled={downloadOpen}
            >
              Select new area to download
            </button>

            {regions.length === 0 ? (
              <div className={styles.empty}>
                <span className={styles.emptyIcon}>
                  <DownloadIcon />
                </span>
                <h2 className={styles.emptyTitle}>No areas downloaded yet</h2>
                <p className={styles.emptyText}>
                  Use “Select new area to download” to save part of the map for
                  use with no connectivity. It works just like saving an area
                  while planning a route.
                </p>
              </div>
            ) : (
              <>
                <p className={styles.intro}>
                  {regions.length} {regions.length === 1 ? 'map' : 'maps'},{' '}
                  <span className={styles.total}>
                    {formatBytes(totalBytes)} total.
                  </span>
                </p>

                <ul className={styles.list}>
                  {regions.map((r) => (
                    <li key={r.id} className={styles.item}>
                      <button
                        type="button"
                        className={`${styles.row} ${
                          r.id === selectedId ? styles.rowSelected : ''
                        }`}
                        onClick={() => setSelectedId(r.id)}
                      >
                        <span className={styles.regionName}>{r.name}</span>
                        <span className={`${styles.regionMeta} tnum`}>
                          z{r.minZoom}–{r.maxZoom} ·{' '}
                          {r.tileCount.toLocaleString()} tiles ·{' '}
                          {formatBytes(r.bytes)}
                        </span>
                        <span className={styles.regionLayers}>
                          {r.layerIds
                            .map(
                              (id) =>
                                OFFLINE_LAYER_LIST.find((l) => l.id === id)
                                  ?.label ?? id,
                            )
                            .join(', ')}
                        </span>
                      </button>
                      {confirmId === r.id ? (
                        <span className={styles.confirm}>
                          <button
                            type="button"
                            className={styles.confirmDelete}
                            onClick={() => handleDelete(r.id)}
                            disabled={busyId === r.id}
                          >
                            {busyId === r.id ? 'Deleting…' : 'Delete'}
                          </button>
                          <button
                            type="button"
                            className={styles.confirmCancel}
                            onClick={() => setConfirmId(null)}
                            disabled={busyId === r.id}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={styles.deleteBtn}
                          onClick={() => setConfirmId(r.id)}
                          title={`Delete ${r.name}`}
                          aria-label={`Delete ${r.name}`}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                {regions.length > 1 &&
                  (clearArmed ? (
                    <div className={styles.clearConfirm}>
                      <span className={styles.clearConfirmText}>
                        Remove all {regions.length} offline maps? This can’t be
                        undone.
                      </span>
                      <div className={styles.clearConfirmActions}>
                        <button
                          type="button"
                          className={styles.confirmDelete}
                          onClick={handleClearAll}
                        >
                          Remove all
                        </button>
                        <button
                          type="button"
                          className={styles.confirmCancel}
                          onClick={() => setClearArmed(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.clearAll}
                      onClick={() => setClearArmed(true)}
                    >
                      Remove all offline maps
                    </button>
                  ))}
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
