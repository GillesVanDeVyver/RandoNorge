import {
  ArrowRightIcon,
  BookmarkIcon,
  CircleCheckIcon,
  MountainIcon,
  RouteIcon,
} from './icons';
import styles from './AccountOverview.module.css';

type Props = {
  /** Display name of the signed-in user (falls back to email in Root). */
  name: string;
  /** Number of routes in the user's library. Placeholder until wired up. */
  savedCount: number;
  /** Number of finished tours. Placeholder until wired up. */
  completedCount: number;
  /** Open the list of saved routes. */
  onOpenSavedRoutes: () => void;
  /** Open the list of completed routes. */
  onOpenCompletedRoutes: () => void;
  /** Jump straight into the map / route planner. */
  onPlanNewRoute: () => void;
};

/**
 * Signed-in landing page ("account overview"). A calm hub between the
 * login page and the planner: the user's route library at a glance and a
 * single prominent action to start planning a new tour. Shares the
 * full-bleed photo + "Alpine Glass" language with the login page.
 */
export function AccountOverview({
  name,
  savedCount,
  completedCount,
  onOpenSavedRoutes,
  onOpenCompletedRoutes,
  onPlanNewRoute,
}: Props) {
  const firstName = name.trim().split(/\s+/)[0] || name;

  return (
    <div className={styles.page}>
      <div className={styles.scrim} aria-hidden="true" />

      <header className={styles.brand}>
        <span className={styles.brandIcon}>
          <MountainIcon />
        </span>
        <span className={styles.brandName}>Fjellrute</span>
      </header>

      <main className={styles.content}>
        <p className={styles.eyebrow}>Account overview</p>
        <h1 className={styles.greeting}>
          Welcome back, {firstName}
          <span className={styles.greetingDot}>.</span>
        </h1>
        <p className={styles.subtitle}>
          Where to next?
        </p>

        <div className={styles.grid}>
          {/* Primary action: plan a new route. */}
          <button
            type="button"
            className={`${styles.card} ${styles.cardPrimary}`}
            onClick={onPlanNewRoute}
          >
            <span className={`${styles.cardIcon} ${styles.cardIconPrimary}`}>
              <RouteIcon />
            </span>
            <span className={styles.cardBody}>
              <span className={styles.cardTitle}>Plan new route</span>
              <span className={styles.cardText}>
                Draw a tour and read the terrain, snow and avalanche
                forecast for every metre.
              </span>
            </span>
            <span className={styles.cardArrow} aria-hidden="true">
              <ArrowRightIcon />
            </span>
          </button>

          <button
            type="button"
            className={styles.card}
            onClick={onOpenSavedRoutes}
          >
            <span className={styles.cardIcon}>
              <BookmarkIcon />
            </span>
            <span className={styles.cardBody}>
              <span className={styles.cardStat}>
                <span className={`${styles.cardCount} tnum`}>
                  {savedCount}
                </span>
                <span className={styles.cardTitle}>
                  Saved {savedCount === 1 ? 'route' : 'routes'}
                </span>
              </span>
              <span className={styles.cardText}>
                Your route library — revisit, review and refine planned
                tours.
              </span>
            </span>
            <span className={styles.cardArrow} aria-hidden="true">
              <ArrowRightIcon />
            </span>
          </button>

          <button
            type="button"
            className={styles.card}
            onClick={onOpenCompletedRoutes}
          >
            <span className={styles.cardIcon}>
              <CircleCheckIcon />
            </span>
            <span className={styles.cardBody}>
              <span className={styles.cardStat}>
                <span className={`${styles.cardCount} tnum`}>
                  {completedCount}
                </span>
                <span className={styles.cardTitle}>
                  Completed {completedCount === 1 ? 'route' : 'routes'}
                </span>
              </span>
              <span className={styles.cardText}>
                Tours you have completed — your personal summit log.
              </span>
            </span>
            <span className={styles.cardArrow} aria-hidden="true">
              <ArrowRightIcon />
            </span>
          </button>
        </div>
      </main>

      {/* Photo licensed under the Pexels license (free for commercial
          use, no attribution required): https://www.pexels.com/license/ */}
      <a
        className={styles.credit}
        href="https://www.pexels.com/photo/landscape-photography-of-mountains-covered-in-snow-691668/"
        target="_blank"
        rel="noreferrer"
      >
        Photo: eberhard grossgasteiger
      </a>
    </div>
  );
}
