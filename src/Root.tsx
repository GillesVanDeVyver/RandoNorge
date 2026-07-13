import { useCallback, useEffect, useState } from 'react';
import App from './App.tsx';
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
import { formatAscent, formatDate, formatDistance } from './routes/format.ts';

/**
 * Signed-in navigation. Kept as simple component state (no router):
 *  - overview  → account overview landing page (default after login)
 *  - planner   → the map / route-planning app
 *  - saved     → list of saved routes
 *  - completed → list of completed routes
 */
type SignedInView = 'overview' | 'planner' | 'saved' | 'completed';

// Completed routes are not persisted yet (saved routes now are); the
// overview count and the list page still derive from this single spot.
const COMPLETED_ROUTES: RouteListItem[] = [];

/** SavedRoute (API) → the preformatted strings the list rows render. */
function toListItem(route: SavedRoute): RouteListItem {
  return {
    id: route.id,
    name: route.name,
    distance: formatDistance(route.distanceM),
    ascent: formatAscent(route.ascentM),
    date: formatDate(route.updatedAt),
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
  const [guest, setGuest] = useState(false);
  const [view, setView] = useState<SignedInView>('overview');
  // The signed-in user's route library, loaded once per session and kept
  // in sync by the save/delete flows. Null while the first fetch is
  // pending so counts don't flash "0" for users who do have routes.
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[] | null>(null);
  // Library route currently opened in the planner (null = fresh plan).
  // Also used as the planner's key so reopening resets its state.
  const [openRoute, setOpenRoute] = useState<SavedRoute | null>(null);

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
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // A saved route came back from the planner: merge it into the library
  // (replace on update, prepend on create — list is newest-first).
  const handleRouteSaved = useCallback((saved: SavedRoute) => {
    setSavedRoutes((prev) => {
      const rest = (prev ?? []).filter((r) => r.id !== saved.id);
      return [saved, ...rest];
    });
    setOpenRoute((prev) => (prev && prev.id === saved.id ? saved : prev));
  }, []);

  const handleDeleteRoute = useCallback(async (id: string) => {
    await deleteRoute(id);
    setSavedRoutes((prev) => (prev ?? []).filter((r) => r.id !== id));
    setOpenRoute((prev) => (prev && prev.id === id ? null : prev));
  }, []);

  const handleOpenRoute = useCallback(
    (id: string) => {
      const route = savedRoutes?.find((r) => r.id === id);
      if (!route) return;
      setOpenRoute(route);
      setView('planner');
    },
    [savedRoutes],
  );

  const handlePlanNewRoute = useCallback(() => {
    setOpenRoute(null);
    setView('planner');
  }, []);

  // A fresh session always lands on the overview (not wherever the
  // previous account left off). Reset during render on the sign-out
  // transition — React's supported "adjust state when props change"
  // pattern — rather than in an effect.
  const signedIn = Boolean(session);
  const [wasSignedIn, setWasSignedIn] = useState(signedIn);
  if (signedIn !== wasSignedIn) {
    setWasSignedIn(signedIn);
    if (!signedIn) {
      setView('overview');
      setOpenRoute(null);
      setSavedRoutes(null);
    }
  }

  if (isPending) return null;

  if (session) {
    const name = session.user.name || session.user.email;
    const savedItems = (savedRoutes ?? []).map(toListItem);
    return (
      <>
        {view === 'overview' && (
          <AccountOverview
            name={name}
            savedCount={savedItems.length}
            completedCount={COMPLETED_ROUTES.length}
            onOpenSavedRoutes={() => setView('saved')}
            onOpenCompletedRoutes={() => setView('completed')}
            onPlanNewRoute={handlePlanNewRoute}
          />
        )}
        {view === 'planner' && (
          <App
            key={openRoute?.id ?? 'new'}
            saving={{ initial: openRoute, onChanged: handleRouteSaved }}
          />
        )}
        {(view === 'saved' || view === 'completed') && (
          <RoutesListPage
            kind={view}
            routes={view === 'saved' ? savedItems : COMPLETED_ROUTES}
            onBack={() => setView('overview')}
            onPlanNewRoute={handlePlanNewRoute}
            onOpenRoute={view === 'saved' ? handleOpenRoute : undefined}
            onDeleteRoute={view === 'saved' ? handleDeleteRoute : undefined}
          />
        )}
        <AccountChip
          name={session.user.name}
          email={session.user.email}
          onOverview={
            view === 'overview' ? undefined : () => setView('overview')
          }
        />
      </>
    );
  }

  return guest ? (
    <App />
  ) : (
    <LoginPage onContinueAsGuest={() => setGuest(true)} />
  );
}
