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
import { useT } from '../i18n/index.ts';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import styles from './AccountOverview.module.css';

type Props = {
  /** Display name of the signed-in user (falls back to email in Root). */
  name: string;
  /** Number of routes in the user's library, or null while the first
   *  fetch is still pending (renders a "loading" label instead of "0"). */
  savedCount: number | null;
  /** Number of finished tours, or null while still loading (same as
   *  savedCount — avoids flashing "0" for users who do have tours). */
  completedCount: number | null;
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
  const t = useT();
  const firstName = name.trim() || name;

  // Downloaded offline areas live in IndexedDB (client-side), so the count is
  // read here directly rather than passed in like the server-backed route
  // counts. The component remounts on each visit to the overview, so this
  // stays current after areas are added or removed.
  const { regions: offlineRegions, loading: offlineLoading } =
    useOfflineRegions();
  // Null while IndexedDB is still being read, so the card shows a
  // "loading" label rather than momentarily flashing "0 offline maps".
  const offlineCount = offlineLoading ? null : offlineRegions.length;

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
        <LanguageSwitcher className={styles.language} />
      </header>

      <main className={styles.content}>
        <p className={styles.eyebrow}>{t('Kontooversikt', 'Account overview')}</p>
        <h1 className={styles.greeting}>
          {t('Velkommen tilbake', 'Welcome back')}, {firstName}
          <span className={styles.greetingDot}>.</span>
        </h1>
        <p className={styles.subtitle}>
          {t('Hvor går turen nå?', 'Where to next?')}
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
              <span className={styles.cardTitle}>
                {t('Planlegg ny rute', 'Plan new route')}
              </span>
              <span className={styles.cardText}>
                {t(
                  'Tegn en tur og utforsk terreng, snø- og skredinformasjon langs ruta.',
                  'Draw a tour and explore the terrain, snow and avalanche information along your route.',
                )}
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
              {savedCount === null ? (
                <span className={styles.cardTitle}>
                  {t('Laster lagrede ruter …', 'Loading your saved routes…')}
                </span>
              ) : (
                <span className={styles.cardStat}>
                  <span className={`${styles.cardCount} tnum`}>
                    {savedCount}
                  </span>
                  <span className={styles.cardTitle}>
                    {t(
                      savedCount === 1 ? 'Lagret rute' : 'Lagrede ruter',
                      savedCount === 1 ? 'Saved route' : 'Saved routes',
                    )}
                  </span>
                </span>
              )}
              <span className={styles.cardText}>
                {t(
                  'Rutebiblioteket ditt — se igjen, gjennomgå og finjustér planlagte turer.',
                  'Your route library — revisit, review and refine planned tours.',
                )}
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
              {completedCount === null ? (
                <span className={styles.cardTitle}>
                  {t(
                    'Laster fullførte ruter …',
                    'Loading your completed routes…',
                  )}
                </span>
              ) : (
                <span className={styles.cardStat}>
                  <span className={`${styles.cardCount} tnum`}>
                    {completedCount}
                  </span>
                  <span className={styles.cardTitle}>
                    {t(
                      completedCount === 1 ? 'Fullført rute' : 'Fullførte ruter',
                      completedCount === 1 ? 'Completed route' : 'Completed routes',
                    )}
                  </span>
                </span>
              )}
              <span className={styles.cardText}>
                {t(
                  'Turer du har fullført — din personlige toppbok.',
                  'Tours you have completed — your personal summit log.',
                )}
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
              {offlineCount === null ? (
                <span className={styles.cardTitle}>
                  {t(
                    'Laster lagrede offline-kart …',
                    'Loading your saved offline maps…',
                  )}
                </span>
              ) : (
                <span className={styles.cardStat}>
                  <span className={`${styles.cardCount} tnum`}>
                    {offlineCount}
                  </span>
                  <span className={styles.cardTitle}>
                    {t(
                      offlineCount === 1
                        ? 'Offline-kart på denne enheten'
                        : 'Offline-kart på denne enheten',
                      offlineCount === 1
                        ? 'Offline map on this device'
                        : 'Offline maps on this device',
                    )}
                  </span>
                </span>
              )}
              <span className={styles.cardText}>
                {t(
                  'Områder som er lastet ned og lagret på denne enheten. Disse kan brukes når du ikke har dekning.',
                  'Areas downloaded and saved on this device. These can be used when you do not have connectivity.',
                )}
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
        {t('Foto', 'Photo')}: {photo.credit}
      </a>
    </div>
  );
}
