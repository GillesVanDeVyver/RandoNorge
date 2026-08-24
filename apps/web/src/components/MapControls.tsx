import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import type { Overlay, Route } from '../types';
import {
  AreaIcon,
  FullscreenIcon,
  LayersIcon,
  LocateIcon,
  MapIcon,
  MinusIcon,
  MountainIcon,
  PlusIcon,
  RouteIcon,
  SearchIcon,
  SnowflakeIcon,
} from './icons';
import { searchPlace } from '../search/geocode';
import {
  toggleRegionsVisible,
  useRegionsVisible,
} from '../offline/regionOverlayMode';
import { useIsMobile } from '../useIsMobile';
import { useT } from '../i18n/index.ts';
import styles from './MapControls.module.css';

interface Props {
  overlay: Overlay;
  onOverlayChange: (overlay: Overlay) => void;
  route: Route;
  /** Whether the offline-maps panel is open. */
  offlineOpen: boolean;
  /** Toggle the offline-maps panel. */
  onToggleOffline: () => void;
}

export function MapControls({
  overlay,
  onOverlayChange,
  route,
  offlineOpen,
  onToggleOffline,
}: Props) {
  const t = useT();
  const map = useMap();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Mobile: the two labelled overlay buttons collapse into one "layers"
  // button with a small menu; zoom (pinch) and fullscreen (map is already
  // full screen) buttons disappear.
  const isMobile = useIsMobile();
  const [layersOpen, setLayersOpen] = useState(false);
  const regionsVisible = useRegionsVisible();

  const pickOverlay = useCallback(
    (next: Overlay) => {
      onOverlayChange(next);
      setLayersOpen(false);
    },
    [onOverlayChange],
  );

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
        const place = await searchPlace(q);
        if (place) {
          map.setView([place.lat, place.lon], 12);
          setSearchOpen(false);
          setQuery('');
        }
      } catch {
        // ignore network errors
      }
    },
    [map, query],
  );

  // Top button flips to the other thematic layer (and shows steepness when the
  // overlay is currently hidden). Bottom button hides the overlay entirely
  // while a layer is shown, and becomes a "Show snow depth" shortcut when
  // hidden — so in the hidden state the two buttons offer both layers directly.
  const handleToggleOverlay = useCallback(() => {
    onOverlayChange(overlay === 'steepness' ? 'snowdepth' : 'steepness');
  }, [overlay, onOverlayChange]);

  const handleToggleVisibility = useCallback(() => {
    onOverlayChange(overlay === 'none' ? 'snowdepth' : 'none');
  }, [overlay, onOverlayChange]);

  const overlayLabel =
    overlay === 'steepness'
      ? t('Vis snødybde', 'Show snow depth')
      : t('Vis bratthet', 'Show steepness');

  const visibilityLabel =
    overlay === 'none'
      ? t('Vis snødybde', 'Show snow depth')
      : t('Skjul kartlag', 'Hide overlay');

  return (
    <>
      {!isMobile && (
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
          <button
            type="button"
            className={`${styles.btn} ${styles.overlayToggle}`}
            onClick={handleToggleVisibility}
            title={visibilityLabel}
            aria-label={visibilityLabel}
          >
            {overlay === 'none' ? <SnowflakeIcon /> : <MapIcon />}
            <span className={styles.overlayLabel}>{visibilityLabel}</span>
          </button>
        </div>
      )}
      <div
        className={`${styles.controls} ${isMobile ? styles.controlsMobile : ''}`}
      >
        {isMobile && (
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className={`${styles.btn} ${overlay !== 'none' ? styles.active : ''}`}
              onClick={() => setLayersOpen((v) => !v)}
              title={t('Kartlag', 'Map layers')}
              aria-label={t('Kartlag', 'Map layers')}
              aria-expanded={layersOpen}
            >
              <LayersIcon />
            </button>
            {layersOpen && (
              <div className={styles.layersMenu} role="menu">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={overlay === 'steepness'}
                  className={`${styles.layersItem} ${overlay === 'steepness' ? styles.layersItemActive : ''}`}
                  onClick={() => pickOverlay('steepness')}
                >
                  <MountainIcon />
                  <span>{t('Bratthet', 'Steepness')}</span>
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={overlay === 'snowdepth'}
                  className={`${styles.layersItem} ${overlay === 'snowdepth' ? styles.layersItemActive : ''}`}
                  onClick={() => pickOverlay('snowdepth')}
                >
                  <SnowflakeIcon />
                  <span>{t('Snødybde', 'Snow depth')}</span>
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={overlay === 'none'}
                  className={`${styles.layersItem} ${overlay === 'none' ? styles.layersItemActive : ''}`}
                  onClick={() => pickOverlay('none')}
                >
                  <MapIcon />
                  <span>{t('Bare kart', 'Map only')}</span>
                </button>
              </div>
            )}
          </div>
        )}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => setSearchOpen((v) => !v)}
            title={t('Søk', 'Search')}
            aria-label={t('Søk', 'Search')}
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
                placeholder={t('Søk etter sted …', 'Search place...')}
              />
            </form>
          )}
        </div>
        <button
          type="button"
          className={`${styles.btn} ${offlineOpen ? styles.active : ''}`}
          onClick={onToggleOffline}
          title={t('Offline-kart', 'Offline maps')}
          aria-label={t('Offline-kart', 'Offline maps')}
          aria-pressed={offlineOpen}
        >
          <MapIcon />
        </button>
        <button
          type="button"
          className={`${styles.btn} ${regionsVisible ? styles.active : ''}`}
          onClick={toggleRegionsVisible}
          title={
            regionsVisible
              ? t('Skjul nedlastede områder', 'Hide downloaded areas')
              : t('Vis nedlastede områder', 'Show downloaded areas')
          }
          aria-label={
            regionsVisible
              ? t('Skjul nedlastede områder', 'Hide downloaded areas')
              : t('Vis nedlastede områder', 'Show downloaded areas')
          }
          aria-pressed={regionsVisible}
        >
          <AreaIcon />
        </button>
        <div className={styles.divider} />
        {!isMobile && (
          <button
            type="button"
            className={styles.btn}
            onClick={handleFullscreen}
            title={t('Fullskjerm', 'Fullscreen')}
            aria-label={t('Fullskjerm', 'Fullscreen')}
          >
            <FullscreenIcon />
          </button>
        )}
        <button
          type="button"
          className={styles.btn}
          onClick={handleLocate}
          title={t('Min posisjon', 'My location')}
          aria-label={t('Min posisjon', 'My location')}
        >
          <LocateIcon />
        </button>
        {!isMobile && (
          <>
            <div className={styles.divider} />
            <button
              type="button"
              className={styles.btn}
              onClick={handleZoomIn}
              title={t('Zoom inn', 'Zoom in')}
              aria-label={t('Zoom inn', 'Zoom in')}
            >
              <PlusIcon />
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={handleZoomOut}
              title={t('Zoom ut', 'Zoom out')}
              aria-label={t('Zoom ut', 'Zoom out')}
            >
              <MinusIcon />
            </button>
          </>
        )}
        {hasRoute && (
          <>
            <div className={styles.divider} />
            <button
              type="button"
              className={styles.btn}
              onClick={handleZoomToRoute}
              title={t('Zoom til rute', 'Zoom to route')}
              aria-label={t('Zoom til rute', 'Zoom to route')}
            >
              <RouteIcon />
            </button>
          </>
        )}
      </div>
    </>
  );
}
