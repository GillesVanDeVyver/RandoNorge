import { useState } from 'react';
import App from './App.tsx';
import { LoginPage } from './components/LoginPage.tsx';

/**
 * Entry gate: the login page is shown on every load for now. Real
 * authentication (and remembering the session) comes later; only
 * "Continue as guest" currently proceeds into the app.
 */
export function Root() {
  const [entered, setEntered] = useState(false);
  return entered ? (
    <App />
  ) : (
    <LoginPage onContinueAsGuest={() => setEntered(true)} />
  );
}
