import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Map } from './components/Map';
import { ElevationPanel, SnowPanel } from './components/ProfilePanel';
import { SnowDateBar } from './components/SnowDateBar';
import { SummaryCard, SummaryPanel } from './components/SummaryPanel';
import { Toast } from './components/Toast';
import { Toolbar } from './components/Toolbar';
import { WeatherPanel } from './components/WeatherPanel';
import { AvalancheRisk } from './components/AvalancheRisk';
import { TermsDialog } from './components/TermsDialog';
import { PencilIcon } from './components/icons';
import { useElevation } from './elevation/useElevation';
import { useSnow } from './snow/useSnow';
import type { Mode, Overlay, Route } from './types';
import styles from './App.module.css';

// MapLibre GL is a large dependency only needed once the user switches to the
// 3D view, so load it (and its chunk) on demand rather than in the main bundle.
const Map3DView = lazy(() =>
  import('./components/Map3DView').then((m) => ({ default: m.Map3DView })),
);

type ViewMode = '2d' | '3d';

const todayIso = () => new Date().toISOString().slice(0, 10);

function App() {
  const [mode, setMode] = useState<Mode>('idle');
  const [route, setRoute] = useState<Route>([]);
  const [snowDate, setSnowDate] = useState<string>(todayIso);
  const [overlay, setOverlay] = useState<Overlay>('steepness');
  const [view, setView] = useState<ViewMode>('2d');
  const [termsOpen, setTermsOpen] = useState(false);
  // Holds the route just cleared, so the undo toast can restore it. Null
  // hides the toast.
  const [clearedRoute, setClearedRoute] = useState<Route | null>(null);
  const toastTimer = useRef<number | null>(null);
  const elevation = useElevation(route);
  const snow = useSnow(elevation.profile, snowDate);
  // While the elevation worker (and the follow-up snow lookup) is still
  // crunching, drawing must be locked out: re-running the pipeline on a
  // half-finished route is wasted work and was the source of the previous
  // "unresponsive page" behavior.
  const loading = elevation.loading || snow.loading;

  // The route just got extended (a draw stroke committed) or replaced — drop
  // back to navigation mode so the map shows the grab cursor and the user
  // can pan/zoom while the worker is busy. Erase strokes also flow through
  // onRouteChange, so leave erase mode alone: erase commits on every
  // mouseup and we don't want to kick the user out mid-edit.
  const handleRouteChange = useCallback((next: Route) => {
    setRoute(next);
    setMode((m) => (m === 'draw' ? 'idle' : m));
  }, []);

  // Block transitions into draw mode while loading. Direct setMode calls
  // from the toolbar are already gated by a disabled button, but the
  // pencil hint button and any future entry points go through this guard.
  const handleModeChange = useCallback(
    (next: Mode) => {
      if (next === 'draw' && loading) return;
      setMode(next);
    },
    [loading],
  );

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
      <div className={styles.frame}>
      <div className={styles.mapPane}>
        {view === '2d' ? (
          <Map
            mode={mode}
            route={route}
            onRouteChange={handleRouteChange}
            overlay={overlay}
            onOverlayChange={setOverlay}
            snowDate={snowDate}
          />
        ) : (
          <Suspense fallback={null}>
            <Map3DView
              mode={mode}
              route={route}
              onRouteChange={handleRouteChange}
              overlay={overlay}
              onOverlayChange={setOverlay}
              snowDate={snowDate}
            />
          </Suspense>
        )}
        <div className={styles.viewToggle} role="group" aria-label="Map view">
          <button
            type="button"
            className={view === '2d' ? styles.viewActive : ''}
            onClick={() => setView('2d')}
            aria-pressed={view === '2d'}
          >
            2D
          </button>
          <button
            type="button"
            className={view === '3d' ? styles.viewActive : ''}
            onClick={() => setView('3d')}
            aria-pressed={view === '3d'}
          >
            3D
          </button>
        </div>
        <button
          type="button"
          className={styles.infoBtn}
          onClick={() => setTermsOpen(true)}
          aria-label="About and terms of service"
          title="About and terms of service"
        >
          ⓘ
        </button>
        <Toolbar
          mode={mode}
          onModeChange={handleModeChange}
          onClear={handleClear}
          hasRoute={hasRoute}
          loading={loading}
        />
        {overlay === 'snowdepth' && (
          <SnowDateBar date={snowDate} onDateChange={setSnowDate} />
        )}
        {showHint && (
          <button
            type="button"
            className={styles.hint}
            onClick={() => handleModeChange('draw')}
            aria-label="Start drawing a route"
          >
            <PencilIcon />
            <span>
              <strong>Draw a route</strong> to start
            </span>
          </button>
        )}
        {showHint && view === '3d' && (
          <div className={styles.hintControls}>
            Left-click + drag to move
            <br />
            Right-click + drag to rotate & tilt
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
            <SummaryCard title="Avalanche warnings">
              <AvalancheRisk profile={elevation.profile} />
            </SummaryCard>
          )}
          {elevation.profile && (
            <SummaryCard title="Weather forecast" padded={false}>
              <WeatherPanel profile={elevation.profile} />
            </SummaryCard>
          )}
        </SummaryPanel>
      )}
      </div>
      {termsOpen && <TermsDialog onClose={() => setTermsOpen(false)} />}
    </div>
  );
}

export default App;
