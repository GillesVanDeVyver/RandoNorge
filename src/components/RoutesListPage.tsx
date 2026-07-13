import { useState } from 'react';
import {
  ArrowLeftIcon,
  BookmarkIcon,
  CircleCheckIcon,
  MountainIcon,
  RouteIcon,
  TrashIcon,
} from './icons';
import styles from './RoutesListPage.module.css';

/** One row in the route library (preformatted display strings). */
export type RouteListItem = {
  id: string;
  name: string;
  /** e.g. "12.4 km". */
  distance: string;
  /** e.g. "1 240 m". */
  ascent: string;
  /** e.g. "12 Mar 2026". */
  date: string;
};

type Props = {
  /** Which library this page shows; adjusts titles and empty states. */
  kind: 'saved' | 'completed';
  routes: RouteListItem[];
  /** Back to the account overview. */
  onBack: () => void;
  /** Jump into the planner (empty-state call to action). */
  onPlanNewRoute: () => void;
  /** Open a route in the planner. Rows are inert when absent. */
  onOpenRoute?: (id: string) => void;
  /** Delete a route (rejects on failure). Hides the trash button when absent. */
  onDeleteRoute?: (id: string) => Promise<void>;
};

const COPY = {
  saved: {
    title: 'Saved routes',
    intro: 'Your route library. Open a tour to review or refine it.',
    emptyTitle: 'No saved routes yet',
    emptyText:
      'Routes you plan and save will appear here, ready to revisit before heading out.',
  },
  completed: {
    title: 'Completed routes',
    intro: 'Your personal summit log — every tour you have finished.',
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
  onBack,
  onPlanNewRoute,
  onOpenRoute,
  onDeleteRoute,
}: Props) {
  const copy = COPY[kind];
  // Two-step delete: the trash button arms a per-row inline confirmation
  // instead of a blocking confirm() dialog (same philosophy as the
  // planner's undo toast). Any error is shown above the list.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
                <span className={`${styles.countPill} tnum`}>
                  {routes.length}
                </span>
              </h1>
              <p className={styles.intro}>{copy.intro}</p>
            </div>
          </header>

          {routes.length === 0 ? (
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
                    <button
                      type="button"
                      className={styles.row}
                      onClick={
                        onOpenRoute ? () => onOpenRoute(route.id) : undefined
                      }
                    >
                      <span className={styles.rowIcon}>
                        <RouteIcon />
                      </span>
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
                          <span
                            className={styles.rowDivider}
                            aria-hidden="true"
                          >
                            ·
                          </span>
                          <span>{route.date}</span>
                        </span>
                      </span>
                    </button>
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
