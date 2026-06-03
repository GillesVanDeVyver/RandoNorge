import { useCallback, useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import {
  FullscreenIcon,
  LocateIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
} from './icons';
import styles from './MapControls.module.css';

export function MapControls() {
  const map = useMap();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const handleZoomIn = useCallback(() => map.zoomIn(), [map]);
  const handleZoomOut = useCallback(() => map.zoomOut(), [map]);

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

  return (
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
    </div>
  );
}
