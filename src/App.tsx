import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Map } from './components/Map';
import { NavigationBar } from './components/NavigationBar';
import { ElevationPanel, SnowPanel } from './components/ProfilePanel';
import { SnowDateBar } from './components/SnowDateBar';
import { SummaryCard, SummaryPanel } from './components/SummaryPanel';
import { Toast } from './components/Toast';
import { Toolbar } from './components/Toolbar';
import { WeatherPanel } from './components/WeatherPanel';
import { AvalancheRisk } from './components/AvalancheRisk';
import { TermsDialog } from './components/TermsDialog';
import { SaveRouteDialog } from './components/SaveRouteDialog';
import {
  BookmarkPlusIcon,
  PencilIcon,
  PlayIcon,
  UploadIcon,
} from './components/icons';
import { useElevation } from './elevation/useElevation';
import { useSnow } from './snow/useSnow';
import { segmentLength } from './geometry';
import { createRoute, updateRoute, type SavedRoute } from './routes/api';
import { createTrack, type SavedTrack } from './tracking/api';
import { useTracking, type TrackingStatus } from './tracking/useTracking';
import {
  importRouteFile,
  RouteImportError,
  IMPORT_ACCEPT,
} from './routes/import';
import { formatAscent, formatDate, formatDistance } from './routes/format';
import { useIsMobile } from './useIsMobile';
import type { Mode, Overlay, Route } from './types';
import styles from './App.module.css';

// MapLibre GL is a large dependency only needed once the user switches to the
// 3D view, so load it (and its chunk) on demand rather than in the main bundle.
const Map3DView = lazy(() =>
  import('./components/Map3DView').then((m) => ({ default: m.Map3DView })),
);

type ViewMode = '2d' | '3d';

const todayIso = () => new Date().toISOString().slice(0, 10);

// ---- Planner draft persistence -----------------------------------------
// The planner unmounts whenever the user navigates to another view (library,
// overview, …), which used to discard the drawn route. The in-progress route
// (and the library identity it belongs to, so Save keeps updating the right
// route) is mirrored into sessionStorage and restored on remount — e.g. when
// the browser's back button returns to /planner. sessionStorage is per-tab,
// so a fresh visit still starts with a clean planner. Keyed per opened
// library route, matching the `key` Root gives each planner instance.

interface PlannerDraft {
  route: Route;
  savedMeta: { id: string; name: string; description: string | null } | null;
}

const draftKey = (routeId: string | null) =>
  `randonorge:planner-draft:${routeId ?? 'new'}`;

function loadDraft(routeId: string | null): PlannerDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(routeId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const draft = parsed as PlannerDraft;
    if (!Array.isArray(draft.route)) return null;
    return draft;
  } catch {
    // Storage unavailable or corrupted entry — fall back to a clean planner.
    return null;
  }
}

function storeDraft(routeId: string | null, draft: PlannerDraft): void {
  try {
    sessionStorage.setItem(draftKey(routeId), JSON.stringify(draft));
  } catch {
    // Storage unavailable/full — the draft just won't survive navigation.
  }
}

/** Drop the fresh-plan draft. Called when the user explicitly starts a new
 *  plan, so "Plan a new route" really is new — only back/return navigation
 *  restores a draft. */
export function clearNewPlanDraft(): void {
  try {
    sessionStorage.removeItem(draftKey(null));
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

// While recording, every accepted GPS fix would otherwise re-run the full
// elevation/snow pipeline on the growing track. Instead the copy fed to the
// pipeline refreshes at most once per THROTTLE_MS — and immediately when
// recording pauses or finishes, so the review state is exact.
const TRACK_STATS_THROTTLE_MS = 20000;

function useThrottledTrack(track: Route, status: TrackingStatus): Route {
  const [out, setOut] = useState<Route>([]);
  const lastFlushRef = useRef(0);
  useEffect(() => {
    // Everything runs through a (possibly zero-delay) timer so the effect
    // never sets state synchronously; the cleanup keeps only the latest
    // scheduled flush alive.
    if (status === 'idle') {
      lastFlushRef.current = 0;
      const id = window.setTimeout(
        () => setOut((prev) => (prev.length === 0 ? prev : [])),
        0,
      );
      return () => window.clearTimeout(id);
    }
    if (track.length === 0) return;
    const since = Date.now() - lastFlushRef.current;
    const delay =
      status !== 'recording'
        ? 0 // paused/finished: reflect the final track immediately
        : Math.max(0, TRACK_STATS_THROTTLE_MS - since);
    const id = window.setTimeout(() => {
      lastFlushRef.current = Date.now();
      setOut(track);
    }, delay);
    return () => window.clearTimeout(id);
  }, [track, status]);
  return out;
}

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
    /** Navigate to the completed-routes list (the activity-saved toast's
     *  "View completed routes"). */
    onGoToCompleted?: () => void;
    /** A navigation recording was saved — lets the activity log refresh. */
    onActivitySaved?: (track: SavedTrack) => void;
  };
}

function App({ saving }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  // Stable for the lifetime of this planner instance: Root remounts the
  // planner (via `key`) whenever a different library route is opened.
  const initialId = saving?.initial?.id ?? null;
  // A draft stashed by a previous planner instance in this tab (the user
  // navigated away and came back) wins over the pristine library route.
  const [route, setRoute] = useState<Route>(
    () => loadDraft(initialId)?.route ?? saving?.initial?.route ?? [],
  );
  // Identity of the library route currently being edited; Save updates it
  // instead of creating a duplicate, and its name/notes prefill the dialog.
  const [savedMeta, setSavedMeta] = useState<{
    id: string;
    name: string;
    description: string | null;
  } | null>(() => {
    const draft = loadDraft(initialId);
    if (draft) return draft.savedMeta;
    return saving?.initial
      ? {
          id: saving.initial.id,
          name: saving.initial.name,
          description: saving.initial.description,
        }
      : null;
  });
  // Mirror the in-progress route into sessionStorage so it survives the
  // planner unmounting (tab navigation) and reappears on return.
  useEffect(() => {
    storeDraft(initialId, { route, savedMeta });
  }, [initialId, route, savedMeta]);
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

  // ---- Navigation mode ("Start route") ----------------------------------
  // GPS recording of the actually-travelled route, komoot-style. `navLive`
  // is an active session (recording or paused); `navSession` additionally
  // covers the post-Finish review state where both routes stay plotted.
  const tracking = useTracking();
  const navLive = tracking.status === 'recording' || tracking.status === 'paused';
  const navSession = navLive || tracking.status === 'finished';
  // Which route the summary rail describes: the plan or the recording.
  const [statsView, setStatsView] = useState<'planned' | 'actual'>('planned');
  const [trackSaving, setTrackSaving] = useState(false);
  // Transient confirmation/error line for saving an activity.
  const [notice, setNotice] = useState<{
    message: string;
    action?: { label: string; onAction: () => void };
  } | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const showNotice = useCallback(
    (message: string, action?: { label: string; onAction: () => void }) => {
      setNotice({ message, action });
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => {
        setNotice(null);
        noticeTimer.current = null;
      }, 5000);
    },
    [],
  );

  // The actual route runs through the same elevation/snow pipeline as the
  // plan, so both stats views are directly comparable — but throttled while
  // recording so the pipeline isn't re-run on every GPS fix.
  const statsTrack = useThrottledTrack(tracking.track, tracking.status);
  const actualElevation = useElevation(statsTrack);
  const actualSnow = useSnow(actualElevation.profile, snowDate);

  // Live travelled distance for the recording bar (cheap client-side sum,
  // independent of the throttled pipeline).
  const trackDistanceM = useMemo(
    () => tracking.track.reduce((sum, seg) => sum + segmentLength(seg), 0),
    [tracking.track],
  );
  const trackHasLine = tracking.track.some((seg) => seg.length >= 2);

  const handleStartNavigation = useCallback(() => {
    setMode('idle');
    setView('2d'); // navigation renders on the 2D map
    setStatsView('actual');
    tracking.start();
  }, [tracking]);

  const handleFinishNavigation = useCallback(() => {
    tracking.finish();
    setStatsView('actual');
  }, [tracking]);

  const handleDiscardActivity = useCallback(() => {
    tracking.reset();
    setStatsView('planned');
  }, [tracking]);

  const handleSaveActivity = useCallback(async () => {
    if (!saving || !trackHasLine || tracking.startedAt === null) return;
    setTrackSaving(true);
    try {
      const profile = actualElevation.profile;
      const saved = await createTrack({
        name: savedMeta
          ? savedMeta.name
          : `Tour ${formatDate(tracking.startedAt)}`,
        routeId: savedMeta?.id ?? null,
        track: tracking.track,
        stats: {
          distanceM: trackDistanceM,
          ascentM: profile ? profile.stats.ascent : null,
          descentM: profile ? profile.stats.descent : null,
          durationS: tracking.elapsedMs / 1000,
        },
        startedAt: tracking.startedAt,
        finishedAt: tracking.finishedAt ?? new Date().toISOString(),
      });
      saving.onActivitySaved?.(saved);
      tracking.reset();
      setStatsView('planned');
      showNotice(
        'Activity saved to your completed routes',
        saving.onGoToCompleted
          ? {
              label: 'View completed routes',
              onAction: saving.onGoToCompleted,
            }
          : undefined,
      );
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Saving the activity failed.',
      );
    } finally {
      setTrackSaving(false);
    }
  }, [
    saving,
    trackHasLine,
    tracking,
    actualElevation.profile,
    savedMeta,
    trackDistanceM,
    showNotice,
  ]);

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
      // The plan is read-only while navigating it (or reviewing the
      // recording): editing mid-tour would silently change the comparison.
      if (next !== 'idle' && navSession) return;
      setMode(next);
    },
    [loading, navSession],
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
        const imported = await importRouteFile(file);
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
          err instanceof RouteImportError
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
    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
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
  const showHint = !hasRoute && !elevation.loading && !navSession;

  // Which dataset the summary rail shows. "Actual" is offered as soon as a
  // navigation session exists; before the first accepted GPS fix its panels
  // simply show their empty/loading states.
  const showActualStats = statsView === 'actual' && navSession;
  const activeElevation = showActualStats ? actualElevation : elevation;
  const activeSnow = showActualStats ? actualSnow : snow;

  // Mobile redesign: full-screen map with the summary rail as a bottom sheet,
  // a collapsible edit toolbar, and consolidated map controls.
  const isMobile = useIsMobile();

  // One-line summary for the sheet's collapsed grabber strip.
  const sheetPeek =
    showActualStats && !trackHasLine
      ? 'Waiting for GPS…'
      : activeElevation.profile
        ? `${formatDistance(activeElevation.profile.stats.distance)} · ` +
          `${formatAscent(activeElevation.profile.stats.ascent)} ascent`
        : activeElevation.loading
          ? 'Calculating route stats…'
          : 'Route details';

  return (
    <div
      className={`${styles.app} ${hasRoute || navSession ? styles.summary : ''}`}
    >
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
            track={tracking.track}
            position={tracking.position}
            positionAccuracy={tracking.accuracy}
            navigating={navLive}
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
        {!navSession && (
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
        )}
        <button
          type="button"
          className={styles.infoBtn}
          onClick={() => setTermsOpen(true)}
          aria-label="About and terms of service"
          title="About and terms of service"
        >
          ⓘ
        </button>
        {!navSession && (
          <Toolbar
            mode={mode}
            onModeChange={handleModeChange}
            onClear={handleClear}
            hasRoute={hasRoute}
            loading={loading}
            onImport={handleImportFile}
            collapsible={isMobile}
          />
        )}
        {navSession && tracking.status !== 'idle' && (
          <NavigationBar
            status={tracking.status as 'recording' | 'paused' | 'finished'}
            elapsedMs={tracking.elapsedMs}
            distanceM={trackDistanceM}
            error={tracking.error}
            canSave={Boolean(saving) && trackHasLine}
            cantSaveReason={
              !saving
                ? 'Sign in to save this activity to your completed routes.'
                : !trackHasLine
                  ? 'Not enough GPS data was recorded to save this activity.'
                  : undefined
            }
            saving={trackSaving}
            onPause={tracking.pause}
            onResume={tracking.resume}
            onFinish={handleFinishNavigation}
            onSave={handleSaveActivity}
            onDiscard={handleDiscardActivity}
          />
        )}
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
              accept={IMPORT_ACCEPT}
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
        {notice && !clearedRoute && !importError && (
          <Toast
            message={notice.message}
            actionLabel={notice.action?.label}
            actionIcon={null}
            onAction={
              notice.action
                ? () => {
                    if (noticeTimer.current !== null) {
                      window.clearTimeout(noticeTimer.current);
                      noticeTimer.current = null;
                    }
                    const run = notice.action?.onAction;
                    setNotice(null);
                    run?.();
                  }
                : undefined
            }
            onDismiss={() => {
              if (noticeTimer.current !== null) {
                window.clearTimeout(noticeTimer.current);
                noticeTimer.current = null;
              }
              setNotice(null);
            }}
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
      {(hasRoute || navSession) && (
        <SummaryPanel
          sheet={isMobile}
          peek={sheetPeek}
          action={
            <>
              {navSession && (
                <div
                  className={styles.statsToggle}
                  role="group"
                  aria-label="Statistics source"
                >
                  <button
                    type="button"
                    className={statsView === 'planned' ? styles.statsActive : ''}
                    onClick={() => setStatsView('planned')}
                    aria-pressed={statsView === 'planned'}
                  >
                    Planned route
                  </button>
                  <button
                    type="button"
                    className={statsView === 'actual' ? styles.statsActive : ''}
                    onClick={() => setStatsView('actual')}
                    aria-pressed={statsView === 'actual'}
                  >
                    Actual route
                  </button>
                </div>
              )}
              {hasRoute && tracking.status === 'idle' && view === '2d' && !navSession && (
                <button
                  type="button"
                  className={styles.startNavBtn}
                  onClick={handleStartNavigation}
                  title="Follow this route and record where you actually go"
                >
                  <PlayIcon />
                  <span>Start route</span>
                </button>
              )}
              {saving && !navSession && (
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
              )}
              {/* Guest mode: no `saving` prop, so there's no way to persist a
                  route. We still show the Save button (grayed out and inert)
                  so the feature is discoverable, and hang the tooltip off a
                  wrapping span — a disabled <button> swallows pointer events,
                  so its own `title` never appears on hover. */}
              {!saving && !navSession && (
                <span
                  className={styles.saveBtnLockWrap}
                  title="Create an account to save routes"
                >
                  <button
                    type="button"
                    className={`${styles.saveBtn} ${styles.saveBtnLocked}`}
                    disabled
                    aria-disabled="true"
                  >
                    <BookmarkPlusIcon />
                    <span>Save route</span>
                  </button>
                </span>
              )}
            </>
          }
        >
          <SummaryCard title="Elevation">
            {showActualStats && !trackHasLine ? (
              <p className={styles.statsEmpty}>
                Waiting for GPS — your actual route's stats appear here as
                you move.
              </p>
            ) : (
              <ElevationPanel
                profile={activeElevation.profile}
                loading={activeElevation.loading}
                error={activeElevation.error}
              />
            )}
          </SummaryCard>
          <SummaryCard title="Snow">
            <SnowPanel
              profile={activeElevation.profile}
              snow={activeSnow.snow}
              loading={activeSnow.loading}
              error={activeSnow.error}
              date={snowDate}
              onDateChange={setSnowDate}
            />
          </SummaryCard>
          {activeElevation.profile && (
            <SummaryCard title="Avalanche warnings">
              <AvalancheRisk profile={activeElevation.profile} />
            </SummaryCard>
          )}
          {activeElevation.profile && (
            <SummaryCard title="Weather forecast" padded={false}>
              <WeatherPanel profile={activeElevation.profile} />
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
