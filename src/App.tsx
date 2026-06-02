import { useCallback, useEffect, useState } from 'react';
import { Map } from './components/Map';
import { ProfilePanel } from './components/ProfilePanel';
import { Toolbar } from './components/Toolbar';
import { useElevation } from './elevation/useElevation';
import type { Mode, Route } from './types';

function App() {
  const [mode, setMode] = useState<Mode>('idle');
  const [route, setRoute] = useState<Route>([]);
  const elevation = useElevation(route);

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
      <Map mode={mode} route={route} onRouteChange={setRoute} />
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
      />
    </>
  );
}

export default App;
