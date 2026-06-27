import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import type { Overlay, Route } from '../types';
import {
  FullscreenIcon,
  LocateIcon,
  MinusIcon,
  MountainIcon,
  PlusIcon,
  RouteIcon,
  SearchIcon,
  SnowflakeIcon,
} from './icons';
import styles from './MapControls.module.css';

interface Props {
  overlay: Overlay;
  onOverlayChange: (overlay: Overlay) => void;
  route: Route;
}

export function MapControls({ overlay, onOverlayChange, route }: Props) {
  const map = useMap();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const handleZoomIn = useCallback(() => map.zoomIn(), [map]);
  const handleZoomOut = useCallback(() => map.zoomOut(), [map]);

  const hasRoute = route.length > 0;

  // Re-frame the map around the drawn route, mirroring the automatic
  // FitToRoute behaviour (25% padding on each side) so the manual button
  // lands the route in the same central position.
  const handleZoomToRoute = useCallback(() => {
    const pts: L.LatLngTuple[] = [];
    for (const seg of route) for (const p of seg) pts.push([p[0], p[1]]);
    if (pts.length < 2) return;
    const bounds = L.latLngBounds(pts);
    map.invalidateSize();
    const size = map.getSize();
    const padX = Math.max(0, Math.round(size.x * 0.25));
    const padY = Math.max(0, Math.round(size.y * 0.25));
    map.fitBounds(bounds, { padding: [padX, padY], animate: true });
  }, [map, route]);

  const handleLocate = useCallback(() => {
    map.locate({ setView: true, maxZoom: 14, enableHighAccuracy: true });
  }, [map]);

  const handleFullscreen = useCallback(() => {
    const el = map.getContainer();
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen?.();
    }
  }, [map]);

  const handleSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const q = query.trim();
      if (!q) return;
      try {
        const url =
          'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=no&q=' +
          encodeURIComponent(q);
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
        });
        const data: Array<{ lat: string; lon: string }> = await res.json();
        if (data.length > 0) {
          const lat = parseFloat(data[0].lat);
          const lon = parseFloat(data[0].lon);
          map.setView([lat, lon], 12);
          setSearchOpen(false);
          setQuery('');
        }
      } catch {
        // ignore network errors
      }
    },
    [map, query],
  );

  const handleToggleOverlay = useCallback(() => {
    onOverlayChange(overlay === 'steepness' ? 'snowdepth' : 'steepness');
  }, [overlay, onOverlayChange]);

  const overlayLabel =
    overlay === 'steepness' ? 'Show snow depth' : 'Show steepness';

  return (
    <>
      <div className={styles.overlayPanel}>
        <button
          type="button"
          className={`${styles.btn} ${styles.overlayToggle}`}
          onClick={handleToggleOverlay}
          title={overlayLabel}
          aria-label={overlayLabel}
        >
          {overlay === 'steepness' ? <SnowflakeIcon /> : <MountainIcon />}
          <span className={styles.overlayLabel}>{overlayLabel}</span>
        </button>
      </div>
      <div className={styles.controls}>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => setSearchOpen((v) => !v)}
            title="Search"
            aria-label="Search"
          >
            <SearchIcon />
          </button>
          {searchOpen && (
            <form className={styles.searchBox} onSubmit={handleSearch}>
              <input
                ref={inputRef}
                type="text"
                className={styles.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchOpen(false);
                }}
                placeholder="Search place..."
              />
            </form>
          )}
        </div>
        <div className={styles.divider} />
        <button
          type="button"
          className={styles.btn}
          onClick={handleFullscreen}
          title="Fullscreen"
          aria-label="Fullscreen"
        >
          <FullscreenIcon />
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={handleLocate}
          title="My location"
          aria-label="My location"
        >
          <LocateIcon />
        </button>
        <div className={styles.divider} />
        <button
          type="button"
          className={styles.btn}
          onClick={handleZoomIn}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={handleZoomOut}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <MinusIcon />
        </button>
        {hasRoute && (
          <>
            <div className={styles.divider} />
            <button
              type="button"
              className={styles.btn}
              onClick={handleZoomToRoute}
              title="Zoom to route"
              aria-label="Zoom to route"
            >
              <RouteIcon />
            </button>
          </>
        )}
      </div>
    </>
  );
}
