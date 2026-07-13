import { useEffect, useState } from 'react';
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

/**
 * Signed-in navigation. Kept as simple component state (no router):
 *  - overview  → account overview landing page (default after login)
 *  - planner   → the map / route-planning app
 *  - saved     → list of saved routes
 *  - completed → list of completed routes
 */
type SignedInView = 'overview' | 'planner' | 'saved' | 'completed';

// Placeholder route libraries until routes are persisted server-side.
// The overview counts and the list pages both derive from these, so the
// backend can be wired in at this single point later.
const SAVED_ROUTES: RouteListItem[] = [];
const COMPLETED_ROUTES: RouteListItem[] = [];

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

  // A fresh session always lands on the overview (not wherever the
  // previous account left off). Reset during render on the sign-out
  // transition — React's supported "adjust state when props change"
  // pattern — rather than in an effect.
  const signedIn = Boolean(session);
  const [wasSignedIn, setWasSignedIn] = useState(signedIn);
  if (signedIn !== wasSignedIn) {
    setWasSignedIn(signedIn);
    if (!signedIn) setView('overview');
  }

  if (isPending) return null;

  if (session) {
    const name = session.user.name || session.user.email;
    return (
      <>
        {view === 'overview' && (
          <AccountOverview
            name={name}
            savedCount={SAVED_ROUTES.length}
            completedCount={COMPLETED_ROUTES.length}
            onOpenSavedRoutes={() => setView('saved')}
            onOpenCompletedRoutes={() => setView('completed')}
            onPlanNewRoute={() => setView('planner')}
          />
        )}
        {view === 'planner' && <App />}
        {(view === 'saved' || view === 'completed') && (
          <RoutesListPage
            kind={view}
            routes={view === 'saved' ? SAVED_ROUTES : COMPLETED_ROUTES}
            onBack={() => setView('overview')}
            onPlanNewRoute={() => setView('planner')}
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
