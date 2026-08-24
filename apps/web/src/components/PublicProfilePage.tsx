import type { SavedRoute } from '../routes/api';
import type { SavedTrack } from '../tracking/api';
import type { Owner } from '../public/api';
import { formatAscent, formatDate, formatDistance } from '../routes/format';
import {
  ArrowLeftIcon,
  BookmarkIcon,
  CircleCheckIcon,
  MountainIcon,
  RouteIcon,
} from './icons';
import { RouteThumbnail } from './RouteThumbnail';
import { translate } from '../i18n/locale.ts';
import { useT } from '../i18n/index.ts';
import listStyles from './RoutesListPage.module.css';
import styles from './PublicProfilePage.module.css';

type Props = {
  owner: Owner;
  /** The account's public planned routes (id = share slug). */
  routes: SavedRoute[];
  /** The account's public completed tours (id = share slug). */
  tracks: SavedTrack[];
  /** Open one public planned route (by its share slug). */
  onOpenRoute: (slug: string) => void;
  /** Open one public completed tour (by its share slug). */
  onOpenTrack: (slug: string) => void;
  /** Leave the profile (back to the app home / overview). */
  onBack: () => void;
  /** Label for the back button (e.g. "Overview" for the signed-in owner). */
  backLabel?: string;
};

/** A single read-only row: mini-map + name + stats. Reuses the route-library
 *  row styling; unlike the owner's list there are no delete/share controls. */
function Row({
  route,
  name,
  distanceM,
  ascentM,
  descentM,
  date,
  description,
  onOpen,
}: {
  route?: SavedRoute['route'];
  name: string;
  distanceM: number | null;
  ascentM: number | null;
  descentM: number | null;
  date: string;
  description?: string | null;
  onOpen: () => void;
}) {
  return (
    <li className={listStyles.item}>
      <button type="button" className={listStyles.row} onClick={onOpen}>
        <RouteThumbnail route={route} />
        <span className={listStyles.rowBody}>
          <span className={listStyles.rowName}>{name}</span>
          <span className={listStyles.rowMeta}>
            {distanceM !== null && (
              <span className="tnum">{formatDistance(distanceM)}</span>
            )}
            {ascentM !== null && (
              <>
                <span className={listStyles.rowDivider} aria-hidden="true">
                  ·
                </span>
                <span className="tnum">
                  {formatAscent(ascentM)} {translate('stigning', 'ascent')}
                </span>
              </>
            )}
            {descentM !== null && (
              <>
                <span className={listStyles.rowDivider} aria-hidden="true">
                  ·
                </span>
                <span className="tnum">
                  {formatAscent(descentM)} {translate('nedstigning', 'descent')}
                </span>
              </>
            )}
            <span className={listStyles.rowDivider} aria-hidden="true">
              ·
            </span>
            <span>{date}</span>
          </span>
          {description && (
            <span className={listStyles.rowNotes}>{description}</span>
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * Public account page reached from a /u/<handle> link. Shows the owner's
 * display name and handle, then their publicly shared planned routes and
 * completed tours. Every row opens the matching public route/tour page.
 * Works signed in or out — it never touches the viewer's own library.
 */
export function PublicProfilePage({
  owner,
  routes,
  tracks,
  onOpenRoute,
  onOpenTrack,
  onBack,
  backLabel,
}: Props) {
  const t = useT();
  const initial = (owner.name.trim()[0] || '?').toUpperCase();
  const total = routes.length + tracks.length;
  const back = backLabel ?? t('Tilbake', 'Back');

  return (
    <div className={listStyles.page}>
      <div className={listStyles.scrim} aria-hidden="true" />

      <header className={listStyles.topBar}>
        <button type="button" className={listStyles.backBtn} onClick={onBack}>
          <ArrowLeftIcon />
          {back}
        </button>
        <span className={listStyles.brand}>
          <span className={listStyles.brandIcon}>
            <MountainIcon />
          </span>
          <span className={listStyles.brandName}>Fjellrute</span>
        </span>
      </header>

      <main className={listStyles.content}>
        <div className={listStyles.panel}>
          <div className={styles.owner}>
            <span className={styles.avatar} aria-hidden="true">
              {initial}
            </span>
            <div className={styles.ownerText}>
              <h1 className={styles.ownerName}>{owner.name}</h1>
              {owner.username && (
                <span className={styles.ownerHandle}>@{owner.username}</span>
              )}
            </div>
          </div>

          {total === 0 ? (
            <div className={listStyles.empty}>
              <span className={listStyles.emptyIcon}>
                <RouteIcon />
              </span>
              <h2 className={listStyles.emptyTitle}>
                {t('Ingenting delt ennå', 'Nothing shared yet')}
              </h2>
              <p className={listStyles.emptyText}>
                {t(
                  `${owner.name} har ikke gjort noen ruter eller turer offentlige.`,
                  `${owner.name} hasn’t made any routes or tours public.`,
                )}
              </p>
            </div>
          ) : (
            <>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIcon}>
                    <BookmarkIcon />
                  </span>
                  <h2 className={styles.sectionTitle}>
                    {t('Lagrede ruter', 'Saved routes')}
                    <span className={`${styles.sectionCount} tnum`}>
                      {routes.length}
                    </span>
                  </h2>
                </div>
                {routes.length === 0 ? (
                  <p className={styles.sectionEmpty}>
                    {t('Ingen offentlige ruter.', 'No public routes.')}
                  </p>
                ) : (
                  <ul className={listStyles.list}>
                    {routes.map((r) => (
                      <Row
                        key={r.id}
                        route={r.route}
                        name={r.name}
                        distanceM={r.distanceM}
                        ascentM={r.ascentM}
                        descentM={r.descentM}
                        date={formatDate(r.updatedAt)}
                        description={r.description}
                        onOpen={() => onOpenRoute(r.id)}
                      />
                    ))}
                  </ul>
                )}
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIcon}>
                    <CircleCheckIcon />
                  </span>
                  <h2 className={styles.sectionTitle}>
                    {t('Fullførte ruter', 'Completed routes')}
                    <span className={`${styles.sectionCount} tnum`}>
                      {tracks.length}
                    </span>
                  </h2>
                </div>
                {tracks.length === 0 ? (
                  <p className={styles.sectionEmpty}>
                    {t('Ingen offentlige turer.', 'No public tours.')}
                  </p>
                ) : (
                  <ul className={listStyles.list}>
                    {tracks.map((tr) => (
                      <Row
                        key={tr.id}
                        route={tr.track}
                        name={tr.name}
                        distanceM={tr.distanceM}
                        ascentM={tr.ascentM}
                        descentM={tr.descentM}
                        date={formatDate(tr.finishedAt)}
                        onOpen={() => onOpenTrack(tr.id)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
