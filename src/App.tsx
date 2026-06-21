import { useCallback, useEffect, useRef, useState } from 'react';
import { Map } from './components/Map';
import { ElevationPanel, SnowPanel } from './components/ProfilePanel';
import { SnowDateBar } from './components/SnowDateBar';
import { SummaryCard, SummaryPanel } from './components/SummaryPanel';
import { Toast } from './components/Toast';
import { Toolbar } from './components/Toolbar';
import { WeatherPanel } from './components/WeatherPanel';
import { PencilIcon } from './components/icons';
import { useElevation } from './elevation/useElevation';
import { useSnow } from './snow/useSnow';
import type { Mode, Overlay, Route } from './types';
import styles from './App.module.css';

const todayIso = () => new Date().toISOString().slice(0, 10);

function App() {
  const [mode, setMode] = useState<Mode>('idle');
  const [route, setRoute] = useState<Route>([]);
  const [snowDate, setSnowDate] = useState<string>(todayIso);
  const [overlay, setOverlay] = useState<Overlay>('steepness');
  // Holds the route just cleared, so the undo toast can restore it. Null
  // hides the toast.
  const [clearedRoute, setClearedRoute] = useState<Route | null>(null);
  const toastTimer = useRef<number | null>(null);
  const elevation = useElevation(route);
  const snow = useSnow(elevation.profile, snowDate);

  // Esc exits the current mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('idle');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    setClearedRoute(null);
  }, []);

  // Non-destructive clear: wipe the route immediately and offer an undo
  // toast for a few seconds instead of a blocking confirm() dialog.
  const handleClear = useCallback(() => {
    if (route.length === 0) return;
    setClearedRoute(route);
    setRoute([]);
    setMode('idle');
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setClearedRoute(null);
      toastTimer.current = null;
    }, 6000);
  }, [route]);

  const handleUndo = useCallback(() => {
    if (clearedRoute) setRoute(clearedRoute);
    dismissToast();
  }, [clearedRoute, dismissToast]);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  // Auto-disable erase mode when the route becomes empty (e.g. after a clear
  // or after erasing the last segment).
  useEffect(() => {
    if (route.length === 0 && mode === 'erase') setMode('idle');
  }, [route.length, mode]);

  const hasRoute = route.length > 0;
  const showHint = !hasRoute && !elevation.loading;

  return (
    <div className={`${styles.app} ${hasRoute ? styles.summary : ''}`}>
      <div className={styles.mapPane}>
        <Map
          mode={mode}
          route={route}
          onRouteChange={setRoute}
          overlay={overlay}
          onOverlayChange={setOverlay}
          snowDate={snowDate}
        />
        <Toolbar
          mode={mode}
          onModeChange={setMode}
          onClear={handleClear}
          hasRoute={hasRoute}
        />
        {overlay === 'snowdepth' && (
          <SnowDateBar date={snowDate} onDateChange={setSnowDate} />
        )}
        {showHint && (
          <div className={styles.hint}>
            <PencilIcon />
            <span>
              <strong>Draw a route</strong> to see its elevation &amp; snow profile
            </span>
          </div>
        )}
        {clearedRoute && (
          <Toast
            message="Route cleared"
            actionLabel="Undo"
            onAction={handleUndo}
            onDismiss={dismissToast}
          />
        )}
      </div>
      {hasRoute && (
        <SummaryPanel>
          <SummaryCard title="Elevation">
            <ElevationPanel
              profile={elevation.profile}
              loading={elevation.loading}
              error={elevation.error}
            />
          </SummaryCard>
          <SummaryCard title="Snow">
            <SnowPanel
              profile={elevation.profile}
              snow={snow.snow}
              loading={snow.loading}
              error={snow.error}
              date={snowDate}
              onDateChange={setSnowDate}
            />
          </SummaryCard>
          {elevation.profile && (
            <SummaryCard title="Weather forecast" padded={false}>
              <WeatherPanel profile={elevation.profile} />
            </SummaryCard>
          )}
        </SummaryPanel>
      )}
    </div>
  );
}

export default App;
