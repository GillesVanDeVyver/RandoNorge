import { useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { authClient } from '../auth/client';
import { checkPassword, MIN_PASSWORD_LENGTH } from '../auth/passwordPolicy';
import {
  GoogleIcon,
  MountainIcon,
  RouteIcon,
  SnowflakeIcon,
} from './icons';
import { TermsPage } from './TermsPage';
import { getSeason, LOGIN_PHOTOS } from '../theme/season';
import styles from './LoginPage.module.css';

type Props = {
  /** Called when the user chooses to enter the app without an account. */
  onContinueAsGuest: () => void;
};

/**
 * Which face the auth card is showing.
 *  - login / signup: the two credential forms
 *  - verify: "check your inbox" screen after sign-up (or after trying to
 *    log in with an unverified address)
 *  - forgot: request a password-reset email
 *  - reset: choose a new password (arrived via the emailed reset link,
 *    which carries ?token=... back to this page)
 */
type CardMode = 'login' | 'signup' | 'verify' | 'forgot' | 'reset';

/**
 * Sign-up path waiting behind the terms-of-use gate. Set when the user
 * submits the sign-up form or picks "Sign up with Google"; the full-screen
 * TermsPage is shown and the action only runs after Accept. Nothing is
 * persisted — sign-up simply cannot complete without accepting. (The guest
 * gate lives in Root so planner deep links are covered too.)
 */
type PendingAction = 'signup' | 'google-signup';

/** Reads one-shot query params left by emailed links, then cleans the URL. */
function consumeAuthParams() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const error = params.get('error');
  if (token || error) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  return { token, error };
}

// Consumed once at module load (before any render), so arrivals from
// emailed links — a password-reset token, or an error from an expired
// verification link — seed the initial state below.
const authLink = consumeAuthParams();

/**
 * Remembers a just-completed sign-up across remounts of this component.
 * Root unmounts the login page while `useSession` refetches after sign-up,
 * so without this the "check your inbox" confirmation would be lost and
 * the user would silently land back on the login form.
 * Cleared by Root once a session exists, and when leaving the verify view.
 */
export const PENDING_VERIFICATION_KEY = 'fjellrute:pending-verification-email';

const SIGNUP_SUCCESS_NOTICE =
  'Account created! An activation link is on its way to your inbox.';

/** How long (seconds) the "Resend email" button stays locked after a send. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * When the resend button unlocks again, stored as an epoch-ms timestamp so
 * the cooldown survives page reloads (and new tabs) instead of resetting.
 */
const RESEND_DEADLINE_KEY = 'fjellrute:resend-available-at';

/**
 * Seconds left on the persisted resend cooldown, or `null` when storage is
 * unavailable (private browsing, disabled storage) so callers can fall back
 * to an in-memory countdown.
 */
function readResendCooldown(): number | null {
  try {
    const raw = localStorage.getItem(RESEND_DEADLINE_KEY);
    if (!raw) return 0;
    const remaining = Math.ceil((Number(raw) - Date.now()) / 1000);
    // Clamp so a corrupted/far-future value can't lock the button forever.
    return Math.min(Math.max(remaining, 0), RESEND_COOLDOWN_SECONDS);
  } catch {
    return null;
  }
}

function persistResendDeadline() {
  try {
    localStorage.setItem(
      RESEND_DEADLINE_KEY,
      String(Date.now() + RESEND_COOLDOWN_SECONDS * 1000),
    );
  } catch {
    // Storage unavailable — the in-memory countdown still applies.
  }
}

function readPendingVerificationEmail(): string | null {
  try {
    return sessionStorage.getItem(PENDING_VERIFICATION_KEY);
  } catch {
    return null;
  }
}

const linkErrorMessage = (code: string) =>
  code === 'invalid_token' || code === 'token_expired'
    ? 'That link has expired or was already used. Log in to receive a new one.'
    : code === 'account_not_linked'
      ? 'An account with this email already exists but its address was ' +
        'never confirmed, so it can\u2019t be linked to Google yet. Log in ' +
        'with your password to receive a new confirmation email, then try ' +
        'Google again.'
      : 'Something went wrong with that link. Please try again.';

export function LoginPage({ onContinueAsGuest }: Props) {
  // Read inside initializers (not at module load) so a remount right after
  // sign-up restores the "check your inbox" confirmation.
  const [mode, setMode] = useState<CardMode>(() =>
    authLink.token
      ? 'reset'
      : readPendingVerificationEmail()
        ? 'verify'
        : 'login',
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState(
    () => readPendingVerificationEmail() ?? '',
  );
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [resetToken] = useState<string | null>(authLink.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    authLink.error ? linkErrorMessage(authLink.error) : null,
  );
  const [notice, setNotice] = useState<string | null>(() =>
    !authLink.token && readPendingVerificationEmail()
      ? SIGNUP_SUCCESS_NOTICE
      : null,
  );
  // True after a failed login where the account exists but the password
  // didn't match — shows the inline "reset password" button.
  const [wrongPassword, setWrongPassword] = useState(false);
  // True after a sign-up attempt with an already-registered email —
  // shows the inline "Go to login" button.
  const [emailTaken, setEmailTaken] = useState(false);
  // Seconds left before the verification email may be re-sent again.
  // Seeded from the persisted deadline so reloading doesn't skip the wait.
  const [resendCooldown, setResendCooldown] = useState(
    () => readResendCooldown() ?? 0,
  );
  // Non-null while the terms-of-use page is blocking a sign-up or guest
  // entry; holds the action to run once the user accepts.
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );

  // Ticks the resend cooldown down once per second while it is active.
  // Recomputes from the persisted deadline (rather than decrementing) so the
  // countdown stays wall-clock accurate even if the tab is throttled; falls
  // back to a plain decrement when storage is unavailable.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(
      () => setResendCooldown((s) => readResendCooldown() ?? s - 1),
      1000,
    );
    return () => clearTimeout(id);
  }, [resendCooldown]);

  const strength =
    mode === 'signup' || mode === 'reset'
      ? password
        ? checkPassword(password)
        : null
      : null;

  const switchMode = (next: CardMode) => {
    // Leaving (or re-entering) any view by hand means the one-shot
    // sign-up confirmation has served its purpose.
    try {
      sessionStorage.removeItem(PENDING_VERIFICATION_KEY);
    } catch {
      // Storage unavailable — nothing to clear.
    }
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword('');
    setConfirm('');
    setWrongPassword(false);
    setEmailTaken(false);
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setWrongPassword(false);
    setBusy(true);
    const { error: err } = await authClient.signIn.email({ email, password });
    if (!err) {
      setBusy(false);
      return; // useSession in Root picks up the new session.
    }
    if (err.status === 403) {
      // Unverified address: the server has just re-sent the verification
      // email as part of rejecting this sign-in.
      setBusy(false);
      setNotice(null);
      setMode('verify');
      return;
    }
    if (err.status === 401) {
      // Better Auth returns the same 401 whether the account is missing or
      // the password is wrong; ask the worker which one it was.
      let exists = true;
      try {
        const res = await fetch('/api/account-exists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (res.ok) {
          exists = Boolean((await res.json()).exists);
        }
      } catch {
        // Lookup failed — fall back to assuming the account exists so the
        // user still gets an actionable message and the reset button.
      }
      setBusy(false);
      if (exists) {
        setError('Wrong password.');
        setWrongPassword(true);
      } else {
        setError('No account found for this email address.');
      }
      return;
    }
    setBusy(false);
    setError(err.message ?? 'Could not log in. Please try again.');
  };

  // OAuth with Google. On success the browser is redirected to Google and
  // back to callbackURL, so `busy` only ever needs to be cleared on error.
  // Google accounts arrive with a verified email, so there is no
  // "check your inbox" step on this path.
  const handleGoogle = async () => {
    setError(null);
    setWrongPassword(false);
    setBusy(true);
    const { error: err } = await authClient.signIn.social({
      provider: 'google',
      callbackURL: '/',
      // On OAuth failure, return to this page with ?error=<code> (handled
      // by consumeAuthParams above) instead of Better Auth's raw error page.
      errorCallbackURL: '/',
    });
    if (err) {
      setBusy(false);
      setError(err.message ?? 'Could not sign in with Google. Please try again.');
    }
  };

  // Form submit on the sign-up card: validate locally, then hold the
  // actual account creation behind the terms-of-use gate. performSignup
  // below only runs after the user accepts on the TermsPage.
  const handleSignup = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setEmailTaken(false);
    const check = checkPassword(password);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setPendingAction('signup');
  };

  const performSignup = async () => {
    setBusy(true);
    // Better Auth deliberately answers duplicate sign-ups with a fake
    // success (anti-enumeration when email verification is required), so
    // no error would ever come back for a taken address. Ask the worker's
    // existing /api/account-exists endpoint first — the same one the
    // login form uses — and point the user at the login instead.
    try {
      const res = await fetch('/api/account-exists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok && Boolean((await res.json()).exists)) {
        setBusy(false);
        setError('An account for this email already exists.');
        setEmailTaken(true);
        return;
      }
    } catch {
      // Lookup failed — fall through to the normal sign-up attempt.
    }
    const { error: err } = await authClient.signUp.email({
      // The form asks for a first name only; keep just the first word in
      // case someone types more, and fall back to the email's local part.
      name: name.trim().split(/\s+/)[0] || email.split('@')[0],
      email,
      password,
      callbackURL: '/',
    });
    setBusy(false);
    if (err) {
      setError(
        err.status === 422
          ? 'An account with this email already exists. Try logging in.'
          : (err.message ?? 'Could not create the account. Please try again.'),
      );
    } else {
      // Survive the remount Root triggers while the session refetches:
      // the fresh instance reads this key and shows the confirmation.
      try {
        sessionStorage.setItem(PENDING_VERIFICATION_KEY, email);
      } catch {
        // Storage unavailable — the in-memory state below still covers
        // the case where the component stays mounted.
      }
      setNotice(SIGNUP_SUCCESS_NOTICE);
      setMode('verify');
    }
  };

  // The user accepted the terms: run whichever sign-up path was waiting
  // behind the gate. Declining just returns to the login page unchanged.
  const handleTermsAccept = () => {
    const action = pendingAction;
    setPendingAction(null);
    if (action === 'signup') void performSignup();
    else if (action === 'google-signup') void handleGoogle();
  };

  const handleResend = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.sendVerificationEmail({
      email,
      callbackURL: '/',
    });
    setBusy(false);
    if (err) {
      setError(err.message ?? 'Could not resend the email.');
    } else {
      setNotice(
        'Verification email sent again. Check your inbox (and your spam folder).',
      );
      persistResendDeadline();
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    }
  };

  // One-click reset from the "Wrong password." error state: sends the
  // reset email straight to the address already typed into the form.
  const handleQuickReset = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.requestPasswordReset({
      email,
      redirectTo: '/',
    });
    setBusy(false);
    setWrongPassword(false);
    if (err) {
      setError(err.message ?? 'Could not send the reset email.');
    } else {
      setNotice(
        'Password reset link sent. Check your inbox (and your spam folder).',
      );
    }
  };

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.requestPasswordReset({
      email,
      redirectTo: '/',
    });
    setBusy(false);
    if (err) {
      setError(err.message ?? 'Could not send the reset email.');
    } else {
      setNotice(
        'If an account exists for that address, a reset link is on its way. Check your inbox and your spam folder.',
      );
    }
  };

  const handleReset = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const check = checkPassword(password);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    if (!resetToken) return;
    setBusy(true);
    const { error: err } = await authClient.resetPassword({
      newPassword: password,
      token: resetToken,
    });
    setBusy(false);
    if (err) {
      setError(
        err.message ??
          'Could not reset the password. The link may have expired.',
      );
    } else {
      switchMode('login');
      setNotice('Password updated. Log in with your new password.');
    }
  };

  // Terms-of-use gate: replaces the whole page while a sign-up or guest
  // entry is waiting for acceptance.
  if (pendingAction) {
    return (
      <TermsPage
        onAccept={handleTermsAccept}
        onDecline={() => setPendingAction(null)}
      />
    );
  }

  // Season-dependent background photo: follows the calendar, or the
  // sticky "/summer"-style URL override (src/theme/season.ts).
  const photo = LOGIN_PHOTOS[getSeason()];

  return (
    <div
      className={styles.page}
      style={{ '--season-photo': `url('${photo.src}')` } as CSSProperties}
    >
      {/* Decorative background is on .page via CSS; scrim improves contrast. */}
      <div className={styles.scrim} aria-hidden="true" />

      <header className={styles.brand}>
        <span className={styles.brandIcon}>
          <MountainIcon />
        </span>
        <span className={styles.brandName}>Fjellrute</span>
      </header>

      <div className={styles.content}>
        <section className={styles.hero}>
          <h1 className={styles.headline}>
            Read
            <br />
            the mountain<span className={styles.headlineDot}>.</span>
          </h1>
          <p className={styles.tagline}>
            Everything you need to plan your tour: terrain, snow and
            avalanche information in one place.
          </p>
          <ul className={styles.chips}>
            <li className={styles.chip}>
              <RouteIcon />
              Route drawing
            </li>
            <li className={styles.chip}>
              <SnowflakeIcon />
              Snow depth
            </li>
            <li className={styles.chip}>
              <MountainIcon />
              Steepness &amp; avalanche risk
            </li>
          </ul>
        </section>

        <div className={styles.card}>
          {mode === 'verify' ? (
            <>
              <h2 className={styles.cardTitle}>Check your inbox</h2>
              <p className={styles.cardText}>
                We sent a confirmation link to{' '}
                <strong>{email || 'your email address'}</strong>. Click it
                to activate your account. If you can&apos;t find it, check
                your spam folder.
              </p>
              {notice && <p className={styles.notice}>{notice}</p>}
              {error && <p className={styles.error}>{error}</p>}
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={handleResend}
                disabled={busy || !email || resendCooldown > 0}
              >
                {busy ? (
                  'Sending…'
                ) : resendCooldown > 0 ? (
                  <>
                    Resend available in{' '}
                    <span className={styles.cooldownDigits}>
                      {resendCooldown}
                    </span>
                    s
                  </>
                ) : (
                  'Resend email'
                )}
              </button>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => switchMode('login')}
              >
                Back to log in
              </button>
            </>
          ) : mode === 'forgot' ? (
            <>
              <h2 className={styles.cardTitle}>Reset password</h2>
              <form className={styles.form} onSubmit={handleForgot}>
                <label className={styles.field}>
                  <span className={styles.label}>Email</span>
                  <input
                    className={styles.input}
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                {notice && <p className={styles.notice}>{notice}</p>}
                {error && <p className={styles.error}>{error}</p>}
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={busy}
                >
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => switchMode('login')}
              >
                Back to log in
              </button>
            </>
          ) : mode === 'reset' ? (
            <>
              <h2 className={styles.cardTitle}>Choose a new password</h2>
              <form className={styles.form} onSubmit={handleReset}>
                <label className={styles.field}>
                  <span className={styles.label}>New password</span>
                  <input
                    className={styles.input}
                    type="password"
                    name="new-password"
                    autoComplete="new-password"
                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                {strength?.ok && (
                  <p className={styles.strength} data-level={strength.strength}>
                    Password strength: {strength.strength}
                  </p>
                )}
                <label className={styles.field}>
                  <span className={styles.label}>Repeat password</span>
                  <input
                    className={styles.input}
                    type="password"
                    name="confirm-password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </label>
                {error && <p className={styles.error}>{error}</p>}
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={busy}
                >
                  {busy ? 'Saving…' : 'Save new password'}
                </button>
              </form>
            </>
          ) : (
            <>
              {/* No title on the login face — the primary button already
                  says "Log in", so a heading would just repeat it. Sign-up
                  keeps its title as a clear signal the mode switched. */}
              {mode === 'signup' && (
                <h2 className={styles.cardTitle}>Create account</h2>
              )}

              <button
                type="button"
                className={styles.googleBtn}
                onClick={
                  // Creating an account via Google also goes through the
                  // terms gate; existing users logging in do not.
                  mode === 'signup'
                    ? () => setPendingAction('google-signup')
                    : handleGoogle
                }
                disabled={busy}
              >
                <GoogleIcon className={styles.googleIcon} />
                {mode === 'signup'
                  ? 'Sign up with Google'
                  : 'Continue with Google'}
              </button>

              <div className={styles.divider}>
                <span>or</span>
              </div>

              <form
                className={styles.form}
                onSubmit={mode === 'signup' ? handleSignup : handleLogin}
              >
                {mode === 'signup' && (
                  <label className={styles.field}>
                    <span className={styles.label}>First name</span>
                    <input
                      className={styles.input}
                      type="text"
                      name="first-name"
                      autoComplete="given-name"
                      placeholder="Your first name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                )}

                <label className={styles.field}>
                  <span className={styles.label}>Email</span>
                  <input
                    className={styles.input}
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.label}>Password</span>
                  <input
                    className={styles.input}
                    type="password"
                    name="password"
                    autoComplete={
                      mode === 'signup' ? 'new-password' : 'current-password'
                    }
                    placeholder={
                      mode === 'signup'
                        ? `At least ${MIN_PASSWORD_LENGTH} characters`
                        : '••••••••'
                    }
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>

                {mode === 'signup' && strength?.ok && (
                  <p className={styles.strength} data-level={strength.strength}>
                    Password strength: {strength.strength}
                  </p>
                )}

                {mode === 'signup' && (
                  <label className={styles.field}>
                    <span className={styles.label}>Repeat password</span>
                    <input
                      className={styles.input}
                      type="password"
                      name="confirm-password"
                      autoComplete="new-password"
                      placeholder="••••••••"
                      required
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </label>
                )}

                {notice && <p className={styles.notice}>{notice}</p>}
                {error && (
                  <p className={styles.error}>
                    {error}
                    {mode === 'signup' && emailTaken && (
                      <>
                        {' '}
                        <button
                          type="button"
                          className={styles.errorLink}
                          onClick={() => switchMode('login')}
                        >
                          Go to login
                        </button>
                      </>
                    )}
                  </p>
                )}

                {mode === 'login' && wrongPassword && (
                  <button
                    type="button"
                    className={styles.guestBtn}
                    onClick={handleQuickReset}
                    disabled={busy}
                  >
                    {busy ? 'Sending…' : 'Reset password'}
                  </button>
                )}

                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={busy}
                >
                  {busy
                    ? 'One moment…'
                    : mode === 'signup'
                      ? 'Create account'
                      : 'Log in'}
                </button>

                {mode === 'login' && (
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => switchMode('forgot')}
                  >
                    Forgot password?
                  </button>
                )}
              </form>

              <div className={styles.signupRow}>
                <span>
                  {mode === 'signup'
                    ? 'Already have an account?'
                    : 'No account yet?'}
                </span>
                <button
                  type="button"
                  className={styles.signupBtn}
                  onClick={() =>
                    switchMode(mode === 'signup' ? 'login' : 'signup')
                  }
                >
                  {mode === 'signup' ? 'Log in' : 'Sign up'}
                </button>
              </div>

              <div className={styles.divider}>
                <span>or</span>
              </div>

              <button
                type="button"
                className={styles.guestBtn}
                // The terms gate for guests lives in Root (so deep links
                // straight into the planner are covered too); this just
                // hands over.
                onClick={onContinueAsGuest}
              >
                Continue as guest
              </button>
            </>
          )}
        </div>
      </div>

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
