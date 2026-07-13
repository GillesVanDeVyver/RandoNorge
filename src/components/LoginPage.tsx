import { useState } from 'react';
import type { FormEvent } from 'react';
import { authClient } from '../auth/client';
import { checkPassword, MIN_PASSWORD_LENGTH } from '../auth/passwordPolicy';
import { MountainIcon, RouteIcon, SnowflakeIcon } from './icons';
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

const linkErrorMessage = (code: string) =>
  code === 'invalid_token' || code === 'token_expired'
    ? 'That link has expired or was already used. Log in to receive a new one.'
    : 'Something went wrong with that link. Please try again.';

export function LoginPage({ onContinueAsGuest }: Props) {
  const [mode, setMode] = useState<CardMode>(
    authLink.token ? 'reset' : 'login',
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [resetToken] = useState<string | null>(authLink.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    authLink.error ? linkErrorMessage(authLink.error) : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  // True after a failed login where the account exists but the password
  // didn't match — shows the inline "reset password" button.
  const [wrongPassword, setWrongPassword] = useState(false);

  const strength =
    mode === 'signup' || mode === 'reset'
      ? password
        ? checkPassword(password)
        : null
      : null;

  const switchMode = (next: CardMode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword('');
    setConfirm('');
    setWrongPassword(false);
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

  const handleSignup = async (e: FormEvent) => {
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
    setBusy(true);
    const { error: err } = await authClient.signUp.email({
      name: name.trim() || email.split('@')[0],
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
      setMode('verify');
    }
  };

  const handleResend = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.sendVerificationEmail({
      email,
      callbackURL: '/',
    });
    setBusy(false);
    if (err) setError(err.message ?? 'Could not resend the email.');
    else
      setNotice(
        'Verification email sent again — check your inbox (and your spam folder).',
      );
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
        'Password reset link sent — check your inbox (and your spam folder).',
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
        'If an account exists for that address, a reset link is on its way — check your inbox and your spam folder.',
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
          'Could not reset the password — the link may have expired.',
      );
    } else {
      switchMode('login');
      setNotice('Password updated. Log in with your new password.');
    }
  };

  return (
    <div className={styles.page}>
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
            From trailhead to summit and back - Fjellrute reads the
            terrain, the snow and the avalanche forecast for every metre
            of your tour.
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
                disabled={busy || !email}
              >
                {busy ? 'Sending…' : 'Resend email'}
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
              <h2 className={styles.cardTitle}>
                {mode === 'signup' ? 'Create account' : 'Log in'}
              </h2>

              <form
                className={styles.form}
                onSubmit={mode === 'signup' ? handleSignup : handleLogin}
              >
                {mode === 'signup' && (
                  <label className={styles.field}>
                    <span className={styles.label}>Name</span>
                    <input
                      className={styles.input}
                      type="text"
                      name="name"
                      autoComplete="name"
                      placeholder="Your name"
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
                {error && <p className={styles.error}>{error}</p>}

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
                onClick={onContinueAsGuest}
              >
                Continue as guest
              </button>
            </>
          )}
        </div>
      </div>

      {/* Photo licensed under the Pexels license (free for commercial
          use, no attribution required): https://www.pexels.com/license/ */}
      <a
        className={styles.credit}
        href="https://www.pexels.com/photo/person-carrying-backpack-while-ski-touring-6575864/"
        target="_blank"
        rel="noreferrer"
      >
        Photo: Alois Lackner / Pexels
      </a>
    </div>
  );
}
