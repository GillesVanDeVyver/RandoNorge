import { useEffect, useState } from 'react';
import App from './App.tsx';
import { authClient } from './auth/client.ts';
import { AccountChip } from './components/AccountChip.tsx';
import {
  LoginPage,
  PENDING_VERIFICATION_KEY,
} from './components/LoginPage.tsx';

/**
 * Entry gate. Better Auth's session cookie is checked on load:
 *  - signed in            → the app, with a small account chip overlay
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

  if (isPending) return null;

  if (session) {
    return (
      <>
        <App />
        <AccountChip name={session.user.name} email={session.user.email} />
      </>
    );
  }

  return guest ? (
    <App />
  ) : (
    <LoginPage onContinueAsGuest={() => setGuest(true)} />
  );
}
