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
import { SaveRouteDialog } from './components/SaveRouteDialog';
import { BookmarkPlusIcon, PencilIcon, UploadIcon } from './components/icons';
import { useElevation } from './elevation/useElevation';
import { useSnow } from './snow/useSnow';
import { createRoute, updateRoute, type SavedRoute } from './routes/api';
import { importGpxFile, GpxParseError } from './routes/gpx';
import { formatAscent, formatDistance } from './routes/format';
import type { Mode, Overlay, Route } from './types';
import styles from './App.module.css';

// MapLibre GL is a large dependency only needed once the user switches to the
// 3D view, so load it (and its chunk) on demand rather than in the main bundle.
const Map3DView = lazy(() =>
  import('./components/Map3DView').then((m) => ({ default: m.Map3DView })),
);

type ViewMode = '2d' | '3d';

const todayIso = () => new Date().toISOString().slice(0, 10);

interface Props {
  /**
   * Present when the planner runs inside a signed-in session: enables the
   * save button. `initial` is the library route being reopened (Save then
   * updates it in place) or null when planning from scratch; `onChanged`
   * fires after every successful create/update so the library refreshes.
   * Absent in guest mode — the save button doesn't render at all.
   */
  saving?: {
    initial: SavedRoute | null;
    onChanged: (saved: SavedRoute) => void;
    /** Navigate to the saved-routes library (the toast's "Go to library"). */
    onGoToLibrary: () => void;
  };
}

function App({ saving }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [route, setRoute] = useState<Route>(saving?.initial?.route ?? []);
  // Identity of the library route currently being edited; Save updates it
  // instead of creating a duplicate, and its name/notes prefill the dialog.
  const [savedMeta, setSavedMeta] = useState<{
    id: string;
    name: string;
    description: string | null;
  } | null>(
    saving?.initial
      ? {
          id: saving.initial.id,
          name: saving.initial.name,
          description: saving.initial.description,
        }
      : null,
  );
  const [saveOpen, setSaveOpen] = useState(false);
  // Transient "Route saved" confirmation, mirroring the clear-undo toast.
  const [savedToast, setSavedToast] = useState(false);
  const savedToastTimer = useRef<number | null>(null);
  const [snowDate, setSnowDate] = useState<string>(todayIso);
  const [overlay, setOverlay] = useState<Overlay>('steepness');
  const [view, setView] = useState<ViewMode>('2d');
  const [termsOpen, setTermsOpen] = useState(false);
  // Holds the route just cleared (or replaced by an import), so the undo
  // toast can restore it. Null hides the toast. `clearMessage` lets the same
  // toast read "Route cleared" or "Previous route replaced".
  const [clearedRoute, setClearedRoute] = useState<Route | null>(null);
  const [clearMessage, setClearMessage] = useState('Route cleared');
  const toastTimer = useRef<number | null>(null);
  // Transient error toast for a failed GPX import.
  const [importError, setImportError] = useState<string | null>(null);
  const importErrorTimer = useRef<number | null>(null);
  // Hidden file picker behind the onboarding "import a GPS file" balloon.
  const hintImportInputRef = useRef<HTMLInputElement>(null);
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
    setClearMessage('Route cleared');
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

  const dismissImportError = useCallback(() => {
    if (importErrorTimer.current !== null) {
      window.clearTimeout(importErrorTimer.current);
      importErrorTimer.current = null;
    }
    setImportError(null);
  }, []);

  // Import a GPX file: parse it to a route and load it onto the map. If a
  // route is already present it's replaced, but stashed into the undo toast
  // so the swap is reversible (mirrors clear). Parse failures surface as a
  // transient error toast. `initial` (a reopened library route) is left as
  // its own separate identity — an import always starts a new, unsaved route.
  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const imported = await importGpxFile(file);
        dismissImportError();
        if (route.length > 0) {
          setClearMessage('Previous route replaced');
          setClearedRoute(route);
          if (toastTimer.current !== null) {
            window.clearTimeout(toastTimer.current);
          }
          toastTimer.current = window.setTimeout(() => {
            setClearedRoute(null);
            toastTimer.current = null;
          }, 6000);
        }
        // An imported route is a fresh, unsaved one: forget any library
        // identity so Save creates a new route rather than overwriting the
        // one that was open.
        setSavedMeta(null);
        setMode('idle');
        setRoute(imported);
      } catch (err) {
        const message =
          err instanceof GpxParseError
            ? err.message
            : "This file couldn't be imported.";
        setImportError(message);
        if (importErrorTimer.current !== null) {
          window.clearTimeout(importErrorTimer.current);
        }
        importErrorTimer.current = window.setTimeout(() => {
          setImportError(null);
          importErrorTimer.current = null;
        }, 6000);
      }
    },
    [route, dismissImportError],
  );

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    if (savedToastTimer.current !== null) {
      window.clearTimeout(savedToastTimer.current);
    }
    if (importErrorTimer.current !== null) {
      window.clearTimeout(importErrorTimer.current);
    }
  }, []);

  // Save (create or update) the current route to the user's library. Runs
  // inside the dialog, which shows any thrown error inline and only closes
  // on success.
  const handleSaveRoute = useCallback(
    async (name: string, description: string) => {
      if (!saving) return;
      const stats = elevation.profile
        ? {
            distanceM: elevation.profile.stats.distance,
            ascentM: elevation.profile.stats.ascent,
            descentM: elevation.profile.stats.descent,
          }
        : null;
      const saved = savedMeta
        ? await updateRoute(savedMeta.id, { name, description, route, stats })
        : await createRoute({ name, description, route, stats });
      setSavedMeta({
        id: saved.id,
        name: saved.name,
        description: saved.description,
      });
      saving.onChanged(saved);
      setSaveOpen(false);
      setSavedToast(true);
      if (savedToastTimer.current !== null) {
        window.clearTimeout(savedToastTimer.current);
      }
      savedToastTimer.current = window.setTimeout(() => {
        setSavedToast(false);
        savedToastTimer.current = null;
      }, 4000);
    },
    [saving, savedMeta, route, elevation.profile],
  );

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
          onImport={handleImportFile}
        />
        {overlay === 'snowdepth' && (
          <SnowDateBar date={snowDate} onDateChange={setSnowDate} />
        )}
        {showHint && (
          <div className={styles.hintStack}>
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
            <button
              type="button"
              className={styles.hintImport}
              onClick={() => hintImportInputRef.current?.click()}
              aria-label="Import a GPS file"
            >
              <UploadIcon />
              <span>
                You can also <strong>import a GPS file</strong>
              </span>
            </button>
            <input
              ref={hintImportInputRef}
              type="file"
              accept=".gpx,application/gpx+xml,application/xml,text/xml"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Reset so choosing the same file again still fires onChange.
                e.target.value = '';
                if (file) handleImportFile(file);
              }}
              hidden
            />
          </div>
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
            message={clearMessage}
            actionLabel="Undo"
            onAction={handleUndo}
            onDismiss={dismissToast}
          />
        )}
        {importError && !clearedRoute && (
          <Toast
            message={importError}
            onDismiss={dismissImportError}
          />
        )}
        {savedToast && !clearedRoute && (
          <Toast
            message="Route saved to your library"
            actionLabel="Go to library"
            actionIcon={null}
            onAction={() => {
              if (savedToastTimer.current !== null) {
                window.clearTimeout(savedToastTimer.current);
                savedToastTimer.current = null;
              }
              setSavedToast(false);
              saving?.onGoToLibrary();
            }}
            onDismiss={() => {
              if (savedToastTimer.current !== null) {
                window.clearTimeout(savedToastTimer.current);
                savedToastTimer.current = null;
              }
              setSavedToast(false);
            }}
          />
        )}
      </div>
      {hasRoute && (
        <SummaryPanel
          action={
            saving && (
              <button
                type="button"
                className={styles.saveBtn}
                onClick={() => setSaveOpen(true)}
                disabled={loading}
                title={
                  loading
                    ? 'Loading route data…'
                    : savedMeta
                      ? 'Save your changes to this route'
                      : 'Save this route to your library'
                }
              >
                <BookmarkPlusIcon />
                <span>
                  {loading
                    ? 'Loading…'
                    : savedMeta
                      ? 'Save changes'
                      : 'Save route'}
                </span>
              </button>
            )
          }
        >
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
      {saveOpen && (
        <SaveRouteDialog
          initialName={savedMeta?.name}
          initialDescription={savedMeta?.description ?? ''}
          isUpdate={savedMeta !== null}
          statsLabel={
            elevation.profile
              ? `${formatDistance(elevation.profile.stats.distance)} · ` +
                `${formatAscent(elevation.profile.stats.ascent)} ascent`
              : null
          }
          onSave={handleSaveRoute}
          onClose={() => setSaveOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
