import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Rectangle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeftIcon, DownloadIcon, TrashIcon } from './icons';
import { OfflineTileLayerComponent } from '../offline/OfflineTileLayerComponent';
import { OFFLINE_LAYER_LIST } from '../offline/layers';
import { removeRegion } from '../offline/download';
import { clearAllOffline } from '../offline/db';
import { useOfflineRegions } from '../offline/useOfflineRegions';
import styles from './OfflineMapsPage.module.css';

interface Props {
  /** Back to the account overview. */
  onBack: () => void;
}

const INITIAL_CENTER: [number, number] = [65, 13];
const INITIAL_ZOOM = 5;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
 * size and layers and lets the user remove them. Selecting a row frames that
 * area on the map.
 */
export function OfflineMapsPage({ onBack }: Props) {
  const { regions, supported, refresh } = useOfflineRegions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
  };

  return (
    <div className={styles.page}>
      <div className={styles.mapPane}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          <ArrowLeftIcon />
          Overview
        </button>
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
        ) : regions.length === 0 ? (
          <>
            <p className={styles.intro}>
              Areas you download for offline use will appear here, plotted on
              the map alongside their size and layers.
            </p>
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>
                <DownloadIcon />
              </span>
              <h2 className={styles.emptyTitle}>No areas downloaded yet</h2>
              <p className={styles.emptyText}>
                Open the map planner and use the download button to save an area
                for use with no connectivity.
              </p>
            </div>
          </>
        ) : (
          <>
            <p className={styles.intro}>
              Every area you have downloaded, shown on the map. Select one to
              frame it. <span className={styles.total}>{formatBytes(totalBytes)} total.</span>
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
                      z{r.minZoom}–{r.maxZoom} · {r.tileCount.toLocaleString()}{' '}
                      tiles · {formatBytes(r.bytes)}
                    </span>
                    <span className={styles.regionLayers}>
                      {r.layerIds
                        .map(
                          (id) =>
                            OFFLINE_LAYER_LIST.find((l) => l.id === id)?.label ??
                            id,
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
      </aside>
    </div>
  );
}
