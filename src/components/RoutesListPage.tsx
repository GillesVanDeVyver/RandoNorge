import { useState } from 'react';
import type { Route } from '../types';
import {
  ArrowLeftIcon,
  BookmarkIcon,
  CircleCheckIcon,
  DownloadIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  MountainIcon,
  RouteIcon,
  TrashIcon,
} from './icons';
import { RouteThumbnail } from './RouteThumbnail';
import styles from './RoutesListPage.module.css';

/** One row in the route library (preformatted display strings). */
export type RouteListItem = {
  id: string;
  name: string;
  /** e.g. "12.4 km". */
  distance: string;
  /** e.g. "1 240 m". */
  ascent: string;
  /** e.g. "980 m". Absent for routes saved before descent was recorded. */
  descent?: string;
  /** e.g. "12 Mar 2026". */
  date: string;
  /** Optional notes entered when saving the route. */
  description?: string;
  /**
   * Drawn geometry, used to render the row's mini-map preview (route on
   * the steepness map, north-up). Absent → generic route icon.
   */
  route?: Route;
  /** Whether this route/tour is publicly shared. */
  isShared?: boolean;
  /** Absolute public link to this item, when shared (for the copy button). */
  shareUrl?: string;
};

type Props = {
  /** Which library this page shows; adjusts titles and empty states. */
  kind: 'saved' | 'completed';
  routes: RouteListItem[];
  /**
   * True while the library's first fetch is still pending. Shows a
   * "loading" state instead of the empty state, so a user who does have
   * routes never sees "No saved routes yet" flash before their list
   * arrives (mirrors the account overview's loading labels).
   */
  loading?: boolean;
  /** Back to the account overview. */
  onBack: () => void;
  /** Jump into the planner (empty-state call to action). */
  onPlanNewRoute: () => void;
  /** Open a route in the planner. Rows are inert when absent. */
  onOpenRoute?: (id: string) => void;
  /** Delete a route (rejects on failure). Hides the trash button when absent. */
  onDeleteRoute?: (id: string) => Promise<void>;
  /** Export a route as GPX. Hides the export button when absent. */
  onExportRoute?: (id: string) => void;
  /**
   * Toggle a route's public/private state (rejects on failure). When
   * present, each row shows a visibility toggle and — once public — a
   * copy-link button. Absent → no sharing controls at all.
   */
  onToggleShare?: (id: string, share: boolean) => Promise<void>;
};

const COPY = {
  saved: {
    title: 'Saved routes',
    intro: 'Your route library. Open a tour to review or refine it.',
    loadingText: 'Loading your saved routes…',
    emptyTitle: 'No saved routes yet',
    emptyText:
      'Routes you plan and save will appear here, ready to revisit before heading out.',
  },
  completed: {
    title: 'Completed routes',
    intro: 'Your personal summit log — every tour you have finished.',
    loadingText: 'Loading your completed routes…',
    emptyTitle: 'No completed routes yet',
    emptyText:
      'Once you mark a tour as completed it will show up here, building your season history.',
  },
} as const;

/**
 * Full-page list of the user's routes (saved or completed), reached from
 * the account overview. Same photo backdrop + glass panel language as the
 * login and overview pages. Rows are buttons so opening a route can be
 * wired up later without markup changes.
 */
export function RoutesListPage({
  kind,
  routes,
  loading = false,
  onBack,
  onPlanNewRoute,
  onOpenRoute,
  onDeleteRoute,
  onExportRoute,
  onToggleShare,
}: Props) {
  const copy = COPY[kind];
  // Two-step delete: the trash button arms a per-row inline confirmation
  // instead of a blocking confirm() dialog (same philosophy as the
  // planner's undo toast). Any error is shown above the list.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which row's share toggle is mid-request, and which row just had its
  // public link copied (so the button can flash a check).
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!onDeleteRoute) return;
    setDeletingId(id);
    setError(null);
    try {
      await onDeleteRoute(id);
      setConfirmId(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not delete the route',
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleShare = async (id: string, share: boolean) => {
    if (!onToggleShare) return;
    setSharingId(id);
    setError(null);
    try {
      await onToggleShare(id, share);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not update sharing',
      );
    } finally {
      setSharingId(null);
    }
  };

  const handleCopyLink = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      window.setTimeout(
        () => setCopiedId((c) => (c === id ? null : c)),
        1800,
      );
    } catch {
      // Clipboard blocked (insecure context / permissions): surface the
      // link so the user can copy it by hand.
      setError(`Copy failed — the link is ${url}`);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.scrim} aria-hidden="true" />

      <header className={styles.topBar}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          <ArrowLeftIcon />
          Overview
        </button>
        <span className={styles.brand}>
          <span className={styles.brandIcon}>
            <MountainIcon />
          </span>
          <span className={styles.brandName}>Fjellrute</span>
        </span>
      </header>

      <main className={styles.content}>
        <div className={styles.panel}>
          <header className={styles.panelHeader}>
            <span className={styles.panelIcon}>
              {kind === 'saved' ? <BookmarkIcon /> : <CircleCheckIcon />}
            </span>
            <div className={styles.panelHeading}>
              <h1 className={styles.title}>
                {copy.title}
                <span
                  className={`${styles.countPill} tnum`}
                  aria-hidden={loading}
                >
                  {loading ? '…' : routes.length}
                </span>
              </h1>
              <p className={styles.intro}>{copy.intro}</p>
            </div>
          </header>

          {loading ? (
            <div className={styles.empty}>
              <span className={styles.spinner} aria-hidden="true" />
              <h2 className={styles.emptyTitle}>{copy.loadingText}</h2>
            </div>
          ) : routes.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>
                <RouteIcon />
              </span>
              <h2 className={styles.emptyTitle}>{copy.emptyTitle}</h2>
              <p className={styles.emptyText}>{copy.emptyText}</p>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={onPlanNewRoute}
              >
                Plan a new route
              </button>
            </div>
          ) : (
            <>
              {error && (
                <p className={styles.listError} role="alert">
                  {error}
                </p>
              )}
              <ul className={styles.list}>
                {routes.map((route) => (
                  <li key={route.id} className={styles.item}>
                    <div className={styles.routeCard}>
                      {onToggleShare && (
                        <div className={styles.shareRow}>
                          <button
                            type="button"
                            className={`${styles.visToggle} ${
                              route.isShared ? styles.visTogglePublic : ''
                            }`}
                            onClick={() =>
                              handleToggleShare(route.id, !route.isShared)
                            }
                            disabled={sharingId === route.id}
                            aria-pressed={route.isShared}
                            aria-label={
                              route.isShared
                                ? `${route.name} is public; make private`
                                : `${route.name} is private; make public`
                            }
                          >
                            <span className={styles.visIcon}>
                              {route.isShared ? <GlobeIcon /> : <LockIcon />}
                            </span>
                            <span className={styles.visLabel}>
                              {route.isShared ? 'Public' : 'Private'}
                            </span>
                            <span className={styles.visHint}>
                              {sharingId === route.id
                                ? 'Updating…'
                                : route.isShared
                                  ? 'Anyone with the link can view — click to make private'
                                  : 'Only you can see this — click to make public'}
                            </span>
                          </button>
                          {route.isShared && route.shareUrl && (
                            <button
                              type="button"
                              className={`${styles.copyLinkBtn} ${
                                copiedId === route.id
                                  ? styles.copyLinkBtnCopied
                                  : ''
                              }`}
                              onClick={() =>
                                handleCopyLink(route.id, route.shareUrl!)
                              }
                              aria-label={`Copy public link to ${route.name}`}
                            >
                              {copiedId === route.id ? (
                                <CircleCheckIcon />
                              ) : (
                                <LinkIcon />
                              )}
                              <span>
                                {copiedId === route.id ? 'Copied' : 'Copy link'}
                              </span>
                            </button>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        className={`${styles.row} ${styles.rowAttached}`}
                        onClick={
                          onOpenRoute ? () => onOpenRoute(route.id) : undefined
                        }
                      >
                        <RouteThumbnail route={route.route} />
                        <span className={styles.rowBody}>
                          <span className={styles.rowName}>{route.name}</span>
                          <span className={styles.rowMeta}>
                            <span className="tnum">{route.distance}</span>
                            <span
                              className={styles.rowDivider}
                              aria-hidden="true"
                            >
                              ·
                            </span>
                            <span className="tnum">{route.ascent} ascent</span>
                            {route.descent && (
                              <>
                                <span
                                  className={styles.rowDivider}
                                  aria-hidden="true"
                                >
                                  ·
                                </span>
                                <span className="tnum">
                                  {route.descent} descent
                                </span>
                              </>
                            )}
                            <span
                              className={styles.rowDivider}
                              aria-hidden="true"
                            >
                              ·
                            </span>
                            <span>{route.date}</span>
                          </span>
                          {route.description && (
                            <span className={styles.rowNotes}>
                              {route.description}
                            </span>
                          )}
                        </span>
                      </button>
                    </div>
                    {onExportRoute && (
                      <button
                        type="button"
                        className={styles.exportBtn}
                        onClick={() => onExportRoute(route.id)}
                        title="Export route as GPX"
                        aria-label={`Export ${route.name} as GPX`}
                      >
                        <DownloadIcon />
                      </button>
                    )}
                    {onDeleteRoute &&
                      (confirmId === route.id ? (
                          <span className={styles.confirm}>
                            <button
                              type="button"
                              className={styles.confirmDelete}
                              onClick={() => handleDelete(route.id)}
                              disabled={deletingId === route.id}
                            >
                              {deletingId === route.id ? 'Deleting…' : 'Delete'}
                            </button>
                            <button
                              type="button"
                              className={styles.confirmCancel}
                              onClick={() => setConfirmId(null)}
                              disabled={deletingId === route.id}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={styles.deleteBtn}
                            onClick={() => setConfirmId(route.id)}
                            title="Delete route"
                            aria-label={`Delete ${route.name}`}
                          >
                            <TrashIcon />
                          </button>
                        ))}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
