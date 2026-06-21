import { useCallback, useEffect, useRef, useState } from 'react';
import { Map } from './components/Map';
import { ProfilePanel } from './components/ProfilePanel';
import { SnowDateBar } from './components/SnowDateBar';
import { Toast } from './components/Toast';
import { Toolbar } from './components/Toolbar';
import { PencilIcon } from './components/icons';
import { useElevation } from './elevation/useElevation';
import { useSnow } from './snow/useSnow';
import { useWeather } from './weather/useWeather';
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
  const weather = useWeather(elevation.profile);

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

  const showHint = route.length === 0 && !elevation.loading;

  return (
    <>
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
        hasRoute={route.length > 0}
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
      <ProfilePanel
        profile={elevation.profile}
        loading={elevation.loading}
        error={elevation.error}
        snow={snow.snow}
        snowLoading={snow.loading}
        snowError={snow.error}
        date={snowDate}
        onDateChange={setSnowDate}
        weather={weather.hours}
        weatherLoading={weather.loading}
        weatherError={weather.error}
      />
      {clearedRoute && (
        <Toast
          message="Route cleared"
          actionLabel="Undo"
          onAction={handleUndo}
          onDismiss={dismissToast}
        />
      )}
    </>
  );
}

export default App;
