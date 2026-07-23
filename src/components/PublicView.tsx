import { useEffect, useState } from 'react';
import App from '../App';
import { PublicProfilePage } from './PublicProfilePage';
import { ArrowLeftIcon, MountainIcon, RouteIcon } from './icons';
import {
  getPublicProfile,
  getPublicRoute,
  getPublicTrack,
  NotFoundError,
  type PublicProfile,
  type PublicRoute,
  type PublicTrack,
} from '../public/api';
import { translate } from '../i18n/locale.ts';
import { useT } from '../i18n/index.ts';
import listStyles from './RoutesListPage.module.css';

/** Which public page the URL points at. Shared routes/tours carry the
 *  owner's handle as well as their slug so their URLs read
 *  /u/<username>/r/<slug> and link back to that profile. */
export type PublicNav =
  | { kind: 'profile'; username: string }
  | { kind: 'route'; username: string; slug: string }
  | { kind: 'track'; username: string; slug: string };

type Props = {
  nav: PublicNav;
  /** Whether a session exists (only affects the "leave" button label). */
  signedIn: boolean;
  /** Open another account's / this account's public profile. */
  onOpenProfile: (username: string) => void;
  /** Open one public planned route (owner handle + slug). */
  onOpenRoute: (username: string, slug: string) => void;
  /** Open one public completed tour (owner handle + slug). */
  onOpenTrack: (username: string, slug: string) => void;
  /** Leave the public section entirely (back to the app home / overview). */
  onExit: () => void;
};

type LoadState =
  | { status: 'loading' }
  | { status: 'notfound' }
  | { status: 'error'; message: string }
  | { status: 'profile'; data: PublicProfile }
  | { status: 'route'; data: PublicRoute }
  | { status: 'track'; data: PublicTrack };

/** Backdrop + top bar + glass panel, reused for the loading / not-found /
 *  error screens so they match the profile and route pages. */
function Shell({
  backLabel,
  onBack,
  children,
}: {
  backLabel: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={listStyles.page}>
      <div className={listStyles.scrim} aria-hidden="true" />
      <header className={listStyles.topBar}>
        <button type="button" className={listStyles.backBtn} onClick={onBack}>
          <ArrowLeftIcon />
          {backLabel}
        </button>
        <span className={listStyles.brand}>
          <span className={listStyles.brandIcon}>
            <MountainIcon />
          </span>
          <span className={listStyles.brandName}>Fjellrute</span>
        </span>
      </header>
      <main className={listStyles.content}>
        <div className={listStyles.panel}>{children}</div>
      </main>
    </div>
  );
}

/**
 * Loads and renders a public page (someone's profile, or a single shared
 * route/tour). Fetches the anonymous public API, then reuses the exact
 * owner-facing views: the profile lists in {@link PublicProfilePage} and the
 * planner/review chrome in {@link App} (via its read-only `publicView`).
 */
export function PublicView({
  nav,
  signedIn,
  onOpenProfile,
  onOpenRoute,
  onOpenTrack,
  onExit,
}: Props) {
  const t = useT();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  // Refetch whenever the target changes (slug/username). Keyed on the
  // concrete identifier so switching between two public pages reloads.
  const key = nav.kind === 'profile' ? nav.username : nav.slug;
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    const done = (next: LoadState) => {
      if (!cancelled) setState(next);
    };
    const fail = (err: unknown) => {
      if (err instanceof NotFoundError) return done({ status: 'notfound' });
      done({
        status: 'error',
        message:
          err instanceof Error
            ? err.message
            : translate('Noe gikk galt.', 'Something went wrong.'),
      });
    };

    if (nav.kind === 'profile') {
      getPublicProfile(nav.username)
        .then((data) => done({ status: 'profile', data }))
        .catch(fail);
    } else if (nav.kind === 'route') {
      getPublicRoute(nav.slug)
        .then((data) => done({ status: 'route', data }))
        .catch(fail);
    } else {
      getPublicTrack(nav.slug)
        .then((data) => done({ status: 'track', data }))
        .catch(fail);
    }
    return () => {
      cancelled = true;
    };
  }, [nav.kind, key]);

  const homeLabel = signedIn ? t('Oversikt', 'Overview') : t('Hjem', 'Home');

  if (state.status === 'loading') {
    return (
      <Shell backLabel={homeLabel} onBack={onExit}>
        <div className={listStyles.empty}>
          <span className={listStyles.emptyIcon}>
            <RouteIcon />
          </span>
          <h2 className={listStyles.emptyTitle}>{t('Laster …', 'Loading…')}</h2>
        </div>
      </Shell>
    );
  }

  if (state.status === 'notfound') {
    return (
      <Shell backLabel={homeLabel} onBack={onExit}>
        <div className={listStyles.empty}>
          <span className={listStyles.emptyIcon}>
            <RouteIcon />
          </span>
          <h2 className={listStyles.emptyTitle}>{t('Ikke funnet', 'Not found')}</h2>
          <p className={listStyles.emptyText}>
            {t(
              'Denne lenken er privat eller finnes ikke lenger.',
              'This link is private or no longer exists.',
            )}
          </p>
        </div>
      </Shell>
    );
  }

  if (state.status === 'error') {
    return (
      <Shell backLabel={homeLabel} onBack={onExit}>
        <div className={listStyles.empty}>
          <span className={listStyles.emptyIcon}>
            <RouteIcon />
          </span>
          <h2 className={listStyles.emptyTitle}>
            {t('Kunne ikke laste denne siden', 'Couldn’t load this page')}
          </h2>
          <p className={listStyles.emptyText}>{state.message}</p>
        </div>
      </Shell>
    );
  }

  if (state.status === 'profile') {
    // Rows belong to this profile's owner, so their public links carry that
    // handle. Fall back to the URL's username when the record omits one.
    const handle = state.data.owner.username ?? nav.username;
    return (
      <PublicProfilePage
        owner={state.data.owner}
        routes={state.data.routes}
        tracks={state.data.tracks}
        onOpenRoute={(slug) => onOpenRoute(handle, slug)}
        onOpenTrack={(slug) => onOpenTrack(handle, slug)}
        onBack={onExit}
        backLabel={homeLabel}
      />
    );
  }

  // A single shared route or tour: reuse the planner/review chrome. Its top
  // bar links back to the owner's profile when they have a handle, otherwise
  // straight home.
  const owner = state.data.owner;
  const back = owner.username
    ? () => onOpenProfile(owner.username as string)
    : onExit;

  if (state.status === 'route') {
    return (
      <App
        key={`r-${nav.kind === 'route' ? nav.slug : ''}`}
        publicView={{
          route: state.data.route,
          track: null,
          ownerName: owner.name,
          ownerUsername: owner.username,
          onBack: back,
        }}
      />
    );
  }

  // status === 'track'
  return (
    <App
      key={`t-${nav.kind === 'track' ? nav.slug : ''}`}
      publicView={{
        route: state.data.planned,
        track: state.data.track,
        ownerName: owner.name,
        ownerUsername: owner.username,
        onBack: back,
      }}
    />
  );
}
