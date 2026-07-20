import {
  ArrowRightIcon,
  BookmarkIcon,
  CircleCheckIcon,
  MapIcon,
  MountainIcon,
  RouteIcon,
} from './icons';
import type { CSSProperties } from 'react';
import { getSeason, OVERVIEW_PHOTOS } from '../theme/season';
import { useOfflineRegions } from '../offline/useOfflineRegions';
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
  /** Open the downloaded offline maps page. */
  onOpenOfflineMaps: () => void;
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
  onOpenOfflineMaps,
  onPlanNewRoute,
}: Props) {
  const firstName = name.trim().split(/\s+/)[0] || name;

  // Downloaded offline areas live in IndexedDB (client-side), so the count is
  // read here directly rather than passed in like the server-backed route
  // counts. The component remounts on each visit to the overview, so this
  // stays current after areas are added or removed.
  const { regions: offlineRegions } = useOfflineRegions();
  const offlineCount = offlineRegions.length;

  // Season-dependent background photo: follows the calendar, or the
  // sticky "/summer"-style URL override (src/theme/season.ts).
  const photo = OVERVIEW_PHOTOS[getSeason()];

  return (
    <div
      className={styles.page}
      style={{ '--season-photo': `url('${photo.src}')` } as CSSProperties}
    >
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
                Draw a tour and explore the terrain, snow and avalanche
                information along your route.
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

          <button
            type="button"
            className={styles.card}
            onClick={onOpenOfflineMaps}
          >
            <span className={styles.cardIcon}>
              <MapIcon />
            </span>
            <span className={styles.cardBody}>
              <span className={styles.cardStat}>
                <span className={`${styles.cardCount} tnum`}>
                  {offlineCount}
                </span>
                <span className={styles.cardTitle}>
                  Offline {offlineCount === 1 ? 'map' : 'maps'}
                </span>
              </span>
              <span className={styles.cardText}>
                Areas you have downloaded for use with no connectivity.
              </span>
            </span>
            <span className={styles.cardArrow} aria-hidden="true">
              <ArrowRightIcon />
            </span>
          </button>
        </div>
      </main>

      {/* Photos licensed under the Pexels license (free for commercial
          use, no attribution required): https://www.pexels.com/license/ */}
      <a
        className={styles.credit}
        href={photo.href}
        target="_blank"
        rel="noreferrer"
      >
        Photo: {photo.credit}
      </a>
    </div>
  );
}
