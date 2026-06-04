import { useCallback, useEffect, useState } from 'react';
import { Map } from './components/Map';
import { ProfilePanel } from './components/ProfilePanel';
import { Toolbar } from './components/Toolbar';
import { useElevation } from './elevation/useElevation';
import { useSnow } from './snow/useSnow';
import type { Mode, Overlay, Route } from './types';

const todayIso = () => new Date().toISOString().slice(0, 10);

function App() {
  const [mode, setMode] = useState<Mode>('idle');
  const [route, setRoute] = useState<Route>([]);
  const [snowDate, setSnowDate] = useState<string>(todayIso);
  const [overlay, setOverlay] = useState<Overlay>('steepness');
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

  const handleClear = useCallback(() => {
    if (route.length === 0) return;
    if (window.confirm('Clear the route?')) {
      setRoute([]);
      setMode('idle');
    }
  }, [route.length]);

  // Auto-disable erase mode when the route becomes empty (e.g. after a clear
  // or after erasing the last segment).
  useEffect(() => {
    if (route.length === 0 && mode === 'erase') setMode('idle');
  }, [route.length, mode]);

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
      <ProfilePanel
        profile={elevation.profile}
        loading={elevation.loading}
        error={elevation.error}
        snow={snow.snow}
        snowLoading={snow.loading}
        snowError={snow.error}
        date={snowDate}
        onDateChange={setSnowDate}
      />
    </>
  );
}

export default App;
