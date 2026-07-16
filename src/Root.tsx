import { useCallback, useEffect, useState } from 'react';
import App, { clearNewPlanDraft } from './App.tsx';
import { authClient } from './auth/client.ts';
import { AccountChip } from './components/AccountChip.tsx';
import { AccountOverview } from './components/AccountOverview.tsx';
import {
  RoutesListPage,
  type RouteListItem,
} from './components/RoutesListPage.tsx';
import {
  LoginPage,
  PENDING_VERIFICATION_KEY,
} from './components/LoginPage.tsx';
import {
  deleteRoute,
  listRoutes,
  type SavedRoute,
} from './routes/api.ts';
import {
  deleteTrack,
  listTracks,
  type SavedTrack,
} from './tracking/api.ts';
import { formatAscent, formatDate, formatDistance } from './routes/format.ts';

/**
 * Signed-in navigation. Kept as simple component state (no router):
 *  - overview  → account overview landing page (default after login)
 *  - planner   → the map / route-planning app
 *  - saved     → list of saved routes
 *  - completed → list of completed routes
 *
 * Each view is mirrored to a URL path via the History API so the browser's
 * back/forward buttons work and views can be deep-linked/refreshed:
 *  - /           → overview (or login/guest gate when signed out)
 *  - /planner    → fresh plan
 *  - /planner/:id→ a saved route opened in the planner
 *  - /saved      → saved routes list
 *  - /completed  → completed routes list
 */
type SignedInView = 'overview' | 'planner' | 'saved' | 'completed';

type Nav = { view: SignedInView; routeId: string | null };

function navToPath({ view, routeId }: Nav): string {
  switch (view) {
    case 'planner':
      return routeId ? `/planner/${encodeURIComponent(routeId)}` : '/planner';
    case 'saved':
      return '/saved';
    case 'completed':
      return '/completed';
    default:
      return '/';
  }
}

function pathToNav(pathname: string): Nav {
  if (pathname === '/planner') return { view: 'planner', routeId: null };
  const opened = pathname.match(/^\/planner\/([^/]+)\/?$/);
  if (opened) {
    return { view: 'planner', routeId: decodeURIComponent(opened[1]) };
  }
  if (pathname === '/saved') return { view: 'saved', routeId: null };
  if (pathname === '/completed') return { view: 'completed', routeId: null };
  return { view: 'overview', routeId: null };
}

/** SavedTrack (API) → the preformatted strings the list rows render.
 *  Completed routes are the tracks recorded in navigation mode. */
function trackToListItem(track: SavedTrack): RouteListItem {
  return {
    id: track.id,
    name: track.name,
    distance: formatDistance(track.distanceM),
    ascent: formatAscent(track.ascentM),
    descent:
      track.descentM !== null ? formatAscent(track.descentM) : undefined,
    date: formatDate(track.finishedAt),
    // Recorded geometry for the row's mini-map preview.
    route: track.track,
  };
}

/** SavedRoute (API) → the preformatted strings the list rows render. */
function toListItem(route: SavedRoute): RouteListItem {
  return {
    id: route.id,
    name: route.name,
    distance: formatDistance(route.distanceM),
    ascent: formatAscent(route.ascentM),
    // Same meters formatting as ascent; routes saved before descent was
    // recorded have null here and simply omit it from the row.
    descent: route.descentM !== null ? formatAscent(route.descentM) : undefined,
    date: formatDate(route.updatedAt),
    description: route.description ?? undefined,
    // Geometry for the row's mini-map preview (steepness map, north-up).
    route: route.route,
  };
}

/**
 * Entry gate. Better Auth's session cookie is checked on load:
 *  - signed in            → the account overview, from which the user can
 *                           open their route lists or enter the planner;
 *                           a small account chip floats over every view
 *  - signed out           → the login page (log in / sign up / verify /
 *                           reset flows live there); "Continue as guest"
 *                           still enters the app without an account
 *  - session check pending → nothing yet (it's a fast same-origin call;
 *                           avoids flashing the login page at users who
 *                           are already signed in)
 */
export function Root() {
  const { data: session, isPending } = authClient.useSession();
  const [guest, setGuest] = useState(
    // A guest who refreshes (or deep-links) the planner stays in it rather
    // than being bounced to the login page; harmless if a session exists,
    // since the signed-in branch renders first.
    () => pathToNav(window.location.pathname).view === 'planner',
  );
  // Current view + opened-route id, initialised from the URL so refreshes
  // and deep links land on the right page. All in-app navigation goes
  // through navigate() below, which keeps the URL in sync.
  const [nav, setNav] = useState<Nav>(() =>
    pathToNav(window.location.pathname),
  );
  const { view, routeId: openRouteId } = nav;
  // The signed-in user's route library, loaded once per session and kept
  // in sync by the save/delete flows. Null while the first fetch is
  // pending so counts don't flash "0" for users who do have routes.
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[] | null>(null);
  // The user's recorded activities ("completed routes"), same lifecycle
  // as the saved-routes library above.
  const [completedTracks, setCompletedTracks] = useState<SavedTrack[] | null>(
    null,
  );
  // Library route currently opened in the planner (null = fresh plan).
  // Derived from the URL's route id; also used as the planner's key so
  // reopening resets its state. While the library is still loading a
  // deep-linked id resolves to null and the key change below remounts
  // the planner once the route arrives.
  const openRoute =
    (openRouteId && savedRoutes?.find((r) => r.id === openRouteId)) || null;

  // Navigate to a view: update state and push a matching history entry
  // (unless we're already there) so the browser's back button retraces
  // the user's steps.
  const navigate = useCallback(
    (view: SignedInView, routeId: string | null = null) => {
      const next: Nav = { view, routeId };
      const path = navToPath(next);
      if (window.location.pathname !== path) {
        window.history.pushState(null, '', path);
      }
      setNav(next);
    },
    [],
  );

  // Back/forward: re-derive the view from the URL the browser restored.
  // Whether the planner shows for a signed-out visitor is tied to the
  // same gesture, so backing out of a guest session lands on the login
  // page and "forward" re-enters it.
  useEffect(() => {
    const onPopState = () => {
      const restored = pathToNav(window.location.pathname);
      setNav(restored);
      setGuest(restored.view === 'planner');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Once signed in, the "sign-up succeeded — check your inbox" reminder
  // has done its job; drop it so a later logout shows the login form.
  useEffect(() => {
    if (session) {
      try {
        sessionStorage.removeItem(PENDING_VERIFICATION_KEY);
      } catch {
        // Storage unavailable — nothing to clear.
      }
    }
  }, [session]);

  // Load the route library when a session appears. (It's dropped on
  // sign-out by the render-time reset further down.)
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    listRoutes()
      .then((routes) => {
        if (!cancelled) setSavedRoutes(routes);
      })
      .catch(() => {
        // Fetch failed (offline, cold worker, …): show an empty library
        // rather than blocking the account pages. Saving still works and
        // repopulates the list through handleRouteSaved.
        if (!cancelled) setSavedRoutes([]);
      });
    listTracks()
      .then((tracks) => {
        if (!cancelled) setCompletedTracks(tracks);
      })
      .catch(() => {
        if (!cancelled) setCompletedTracks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // A saved route came back from the planner: merge it into the library
  // (replace on update, prepend on create — list is newest-first). The
  // planner's openRoute is derived from the library, so it updates too.
  const handleRouteSaved = useCallback((saved: SavedRoute) => {
    setSavedRoutes((prev) => {
      const rest = (prev ?? []).filter((r) => r.id !== saved.id);
      return [saved, ...rest];
    });
  }, []);

  const handleDeleteRoute = useCallback(async (id: string) => {
    await deleteRoute(id);
    setSavedRoutes((prev) => (prev ?? []).filter((r) => r.id !== id));
  }, []);

  // A recorded activity was saved from navigation mode: prepend it to the
  // completed list (newest-first, keyed by finish time).
  const handleActivitySaved = useCallback((track: SavedTrack) => {
    setCompletedTracks((prev) => {
      const rest = (prev ?? []).filter((t) => t.id !== track.id);
      return [track, ...rest];
    });
  }, []);

  const handleDeleteTrack = useCallback(async (id: string) => {
    await deleteTrack(id);
    setCompletedTracks((prev) => (prev ?? []).filter((t) => t.id !== id));
  }, []);

  const handleOpenRoute = useCallback(
    (id: string) => {
      const route = savedRoutes?.find((r) => r.id === id);
      if (!route) return;
      navigate('planner', id);
    },
    [savedRoutes, navigate],
  );

  const handlePlanNewRoute = useCallback(() => {
    // Explicitly starting a new plan discards any fresh-plan draft left by
    // a previous planner visit; only back/return navigation restores it.
    clearNewPlanDraft();
    navigate('planner');
  }, [navigate]);

  // A fresh session always lands on the overview (not wherever the
  // previous account left off). Reset during render on the sign-out
  // transition — React's supported "adjust state when props change"
  // pattern — rather than in an effect.
  const signedIn = Boolean(session);
  const [wasSignedIn, setWasSignedIn] = useState(signedIn);
  if (signedIn !== wasSignedIn) {
    setWasSignedIn(signedIn);
    if (!signedIn) {
      setNav({ view: 'overview', routeId: null });
      setGuest(false);
      setSavedRoutes(null);
      setCompletedTracks(null);
      // Replace (don't push) so back after logout doesn't step through
      // the previous account's pages.
      window.history.replaceState(null, '', '/');
    }
  }

  if (isPending) return null;

  if (session) {
    const name = session.user.name || session.user.email;
    const savedItems = (savedRoutes ?? []).map(toListItem);
    const completedItems = (completedTracks ?? []).map(trackToListItem);
    return (
      <>
        {view === 'overview' && (
          <AccountOverview
            name={name}
            savedCount={savedItems.length}
            completedCount={completedItems.length}
            onOpenSavedRoutes={() => navigate('saved')}
            onOpenCompletedRoutes={() => navigate('completed')}
            onPlanNewRoute={handlePlanNewRoute}
          />
        )}
        {view === 'planner' && (
          <App
            key={openRoute?.id ?? 'new'}
            saving={{
              initial: openRoute,
              onChanged: handleRouteSaved,
              onGoToLibrary: () => navigate('saved'),
              onGoToCompleted: () => navigate('completed'),
              onActivitySaved: handleActivitySaved,
            }}
          />
        )}
        {(view === 'saved' || view === 'completed') && (
          <RoutesListPage
            kind={view}
            routes={view === 'saved' ? savedItems : completedItems}
            onBack={() => navigate('overview')}
            onPlanNewRoute={handlePlanNewRoute}
            onOpenRoute={view === 'saved' ? handleOpenRoute : undefined}
            onDeleteRoute={
              view === 'saved' ? handleDeleteRoute : handleDeleteTrack
            }
          />
        )}
        <AccountChip
          name={session.user.name}
          email={session.user.email}
          onOverview={
            view === 'overview' ? undefined : () => navigate('overview')
          }
        />
      </>
    );
  }

  // Guests get the planner behind its own history entry, so the back
  // button returns to the login page (and forward re-enters the planner).
  return guest ? (
    <App />
  ) : (
    <LoginPage
      onContinueAsGuest={() => {
        navigate('planner');
        setGuest(true);
      }}
    />
  );
}
