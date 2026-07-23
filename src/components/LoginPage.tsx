import { useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { authClient } from '../auth/client';
import { checkPassword, MIN_PASSWORD_LENGTH } from '../auth/passwordPolicy';
import { checkUsername } from '../auth/usernamePolicy';
import {
  GoogleIcon,
  MountainIcon,
  RouteIcon,
  SnowflakeIcon,
} from './icons';
import { TermsPage } from './TermsPage';
import { getSeason, LOGIN_PHOTOS } from '../theme/season';
import { useT } from '../i18n/index.ts';
import { translate } from '../i18n/locale.ts';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';
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

/**
 * Which sign-up input a validation problem belongs to, so the message can
 * sit directly under that field instead of only in the shared error box.
 */
type SignupField = 'username' | 'email' | 'password' | 'confirm';

type FieldErrors = Partial<Record<SignupField, string>>;

/** Localised label for a password-strength level. */
function passwordStrengthLabel(
  strength: 'fair' | 'good' | 'strong',
  t: (no: string, en: string) => string,
): string {
  switch (strength) {
    case 'strong':
      return t('sterkt', 'strong');
    case 'good':
      return t('godt', 'good');
    default:
      return t('greit', 'fair');
  }
}

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

const signupSuccessNotice = () =>
  translate(
    'Konto opprettet! En aktiveringslenke er på vei til innboksen din.',
    'Account created! An activation link is on its way to your inbox.',
  );

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
    ? translate(
        'Lenken er utløpt eller allerede brukt. Logg inn for å få en ny.',
        'That link has expired or was already used. Log in to receive a new one.',
      )
    : code === 'account_not_linked'
      ? translate(
          'Det finnes allerede en konto med denne e-posten, men adressen ' +
            'ble aldri bekreftet, så den kan ikke kobles til Google ennå. ' +
            'Logg inn med passordet ditt for å få en ny bekreftelses-e-post, ' +
            'og prøv Google igjen.',
          'An account with this email already exists but its address was ' +
            'never confirmed, so it can\u2019t be linked to Google yet. Log in ' +
            'with your password to receive a new confirmation email, then try ' +
            'Google again.',
        )
      : translate(
          'Noe gikk galt med lenken. Prøv igjen.',
          'Something went wrong with that link. Please try again.',
        );

export function LoginPage({ onContinueAsGuest }: Props) {
  const t = useT();
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
  // Public handle chosen at sign-up; becomes the /u/<username> profile URL.
  const [username, setUsername] = useState('');
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
      ? signupSuccessNotice()
      : null,
  );
  // True after a failed login where the account exists but the password
  // didn't match — shows the inline "reset password" button.
  const [wrongPassword, setWrongPassword] = useState(false);
  // True after a sign-up attempt with an already-registered email —
  // shows the inline "Go to login" button.
  const [emailTaken, setEmailTaken] = useState(false);
  // Validation problems tied to a specific sign-up field, rendered beneath
  // that input. The shared `error` box above is kept for messages that
  // can't be pinned to one field (e.g. ambiguous server responses).
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
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
    setUsername('');
    setWrongPassword(false);
    setEmailTaken(false);
    setFieldErrors({});
  };

  // Clears the inline error on a field as soon as the user edits it, so a
  // stale message doesn't linger under an input they're actively fixing.
  const clearFieldError = (field: SignupField) =>
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

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
        setError(translate('Feil passord.', 'Wrong password.'));
        setWrongPassword(true);
      } else {
        setError(
          translate(
            'Fant ingen konto for denne e-postadressen.',
            'No account found for this email address.',
          ),
        );
      }
      return;
    }
    setBusy(false);
    setError(
      err.message ??
        translate(
          'Kunne ikke logge inn. Prøv igjen.',
          'Could not log in. Please try again.',
        ),
    );
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
      setError(
        err.message ??
          translate(
            'Kunne ikke logge inn med Google. Prøv igjen.',
            'Could not sign in with Google. Please try again.',
          ),
      );
    }
  };

  // Form submit on the sign-up card: validate locally, then hold the
  // actual account creation behind the terms-of-use gate. performSignup
  // below only runs after the user accepts on the TermsPage.
  const handleSignup = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setEmailTaken(false);
    // Collect every problem in one pass so all bad fields are flagged at
    // once, rather than making the user fix and resubmit one at a time.
    const next: FieldErrors = {};
    const handle = checkUsername(username);
    if (!handle.ok) next.username = handle.error;
    const check = checkPassword(password);
    if (!check.ok) next.password = check.error;
    if (password !== confirm)
      next.confirm = translate(
        'Passordene er ikke like.',
        'The passwords do not match.',
      );
    setFieldErrors(next);
    if (Object.keys(next).length > 0) return;
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
        setFieldErrors({
          email: translate(
            'Det finnes allerede en konto for denne e-posten.',
            'An account for this email already exists.',
          ),
        });
        setEmailTaken(true);
        return;
      }
    } catch {
      // Lookup failed — fall through to the normal sign-up attempt.
    }
    const { error: err } = await authClient.signUp.email({
      // The form asks for a first name; keep it in full (compound first
      // names like "Anne Marie" are common) and fall back to the email's
      // local part when nothing is entered.
      name: name.trim() || email.split('@')[0],
      email,
      password,
      // The chosen public handle (normalized); the worker validates it and
      // guarantees uniqueness before the account row is written.
      username: username.trim().toLowerCase(),
      callbackURL: '/',
    } as Parameters<typeof authClient.signUp.email>[0] & { username: string });
    setBusy(false);
    if (err) {
      // 422 covers both a duplicate email and a taken/invalid handle; the
      // worker's message (e.g. "that username is taken") is the specific one.
      setError(
        err.message ??
          (err.status === 422
            ? translate(
                'Det finnes allerede en konto med denne e-posten. Prøv å logge inn.',
                'An account with this email already exists. Try logging in.',
              )
            : translate(
                'Kunne ikke opprette kontoen. Prøv igjen.',
                'Could not create the account. Please try again.',
              )),
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
      setNotice(signupSuccessNotice());
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
      setError(
        err.message ??
          translate(
            'Kunne ikke sende e-posten på nytt.',
            'Could not resend the email.',
          ),
      );
    } else {
      setNotice(
        translate(
          'Bekreftelses-e-post sendt på nytt. Sjekk innboksen (og søppelpost-mappen).',
          'Verification email sent again. Check your inbox (and your spam folder).',
        ),
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
      setError(
        err.message ??
          translate(
            'Kunne ikke sende e-post for tilbakestilling.',
            'Could not send the reset email.',
          ),
      );
    } else {
      setNotice(
        translate(
          'Lenke for tilbakestilling av passord sendt. Sjekk innboksen (og søppelpost-mappen).',
          'Password reset link sent. Check your inbox (and your spam folder).',
        ),
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
      setError(
        err.message ??
          translate(
            'Kunne ikke sende e-post for tilbakestilling.',
            'Could not send the reset email.',
          ),
      );
    } else {
      setNotice(
        translate(
          'Hvis det finnes en konto for adressen, er en lenke for tilbakestilling på vei. Sjekk innboksen og søppelpost-mappen.',
          'If an account exists for that address, a reset link is on its way. Check your inbox and your spam folder.',
        ),
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
      setError(
        translate('Passordene er ikke like.', 'The passwords do not match.'),
      );
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
          translate(
            'Kunne ikke tilbakestille passordet. Lenken kan ha utløpt.',
            'Could not reset the password. The link may have expired.',
          ),
      );
    } else {
      switchMode('login');
      setNotice(
        translate(
          'Passordet er oppdatert. Logg inn med det nye passordet.',
          'Password updated. Log in with your new password.',
        ),
      );
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
        <LanguageSwitcher className={styles.language} />
      </header>

      <div className={styles.content}>
        <section className={styles.hero}>
          <h1 className={styles.headline}>
            {t('Les', 'Read')}
            <br />
            {t('fjellet', 'the mountain')}
            <span className={styles.headlineDot}>.</span>
          </h1>
          <p className={styles.tagline}>
            {t(
              'Alt du trenger for å planlegge turen: terreng, snø- og skredinformasjon på ett sted.',
              'Everything you need to plan your tour: terrain, snow and avalanche information in one place.',
            )}
          </p>
          <ul className={styles.chips}>
            <li className={styles.chip}>
              <RouteIcon />
              {t('Rutetegning', 'Route drawing')}
            </li>
            <li className={styles.chip}>
              <SnowflakeIcon />
              {t('Snødybde', 'Snow depth')}
            </li>
            <li className={styles.chip}>
              <MountainIcon />
              {t('Bratthet og skredfare', 'Steepness & avalanche risk')}
            </li>
          </ul>
        </section>

        <div className={styles.card}>
          {mode === 'verify' ? (
            <>
              <h2 className={styles.cardTitle}>
                {t('Sjekk innboksen din', 'Check your inbox')}
              </h2>
              <p className={styles.cardText}>
                {t('Vi sendte en bekreftelseslenke til', 'We sent a confirmation link to')}{' '}
                <strong>{email || t('e-postadressen din', 'your email address')}</strong>
                {t(
                  '. Klikk på den for å aktivere kontoen din. Finner du den ikke, sjekk søppelpost-mappen.',
                  '. Click it to activate your account. If you can\u2019t find it, check your spam folder.',
                )}
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
                  t('Sender …', 'Sending…')
                ) : resendCooldown > 0 ? (
                  <>
                    {t('Kan sendes på nytt om', 'Resend available in')}{' '}
                    <span className={styles.cooldownDigits}>
                      {resendCooldown}
                    </span>
                    s
                  </>
                ) : (
                  t('Send e-post på nytt', 'Resend email')
                )}
              </button>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => switchMode('login')}
              >
                {t('Tilbake til innlogging', 'Back to log in')}
              </button>
            </>
          ) : mode === 'forgot' ? (
            <>
              <h2 className={styles.cardTitle}>
                {t('Tilbakestill passord', 'Reset password')}
              </h2>
              <form className={styles.form} onSubmit={handleForgot}>
                <label className={styles.field}>
                  <span className={styles.label}>{t('E-post', 'Email')}</span>
                  <input
                    className={styles.input}
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder={t('deg@eksempel.no', 'you@example.com')}
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
                  {busy
                    ? t('Sender …', 'Sending…')
                    : t('Send lenke for tilbakestilling', 'Send reset link')}
                </button>
              </form>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => switchMode('login')}
              >
                {t('Tilbake til innlogging', 'Back to log in')}
              </button>
            </>
          ) : mode === 'reset' ? (
            <>
              <h2 className={styles.cardTitle}>
                {t('Velg et nytt passord', 'Choose a new password')}
              </h2>
              <form className={styles.form} onSubmit={handleReset}>
                <label className={styles.field}>
                  <span className={styles.label}>
                    {t('Nytt passord', 'New password')}
                  </span>
                  <input
                    className={styles.input}
                    type="password"
                    name="new-password"
                    autoComplete="new-password"
                    placeholder={t(
                      `Minst ${MIN_PASSWORD_LENGTH} tegn`,
                      `At least ${MIN_PASSWORD_LENGTH} characters`,
                    )}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                {strength?.ok && (
                  <p className={styles.strength} data-level={strength.strength}>
                    {t('Passordstyrke', 'Password strength')}:{' '}
                    {passwordStrengthLabel(strength.strength, t)}
                  </p>
                )}
                <label className={styles.field}>
                  <span className={styles.label}>
                    {t('Gjenta passord', 'Repeat password')}
                  </span>
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
                  {busy
                    ? t('Lagrer …', 'Saving…')
                    : t('Lagre nytt passord', 'Save new password')}
                </button>
              </form>
            </>
          ) : (
            <>
              {/* No title on the login face — the primary button already
                  says "Log in", so a heading would just repeat it. Sign-up
                  keeps its title as a clear signal the mode switched. */}
              {mode === 'signup' && (
                <h2 className={styles.cardTitle}>
                  {t('Opprett konto', 'Create account')}
                </h2>
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
                  ? t('Registrer deg med Google', 'Sign up with Google')
                  : t('Fortsett med Google', 'Continue with Google')}
              </button>

              <div className={styles.divider}>
                <span>{t('eller', 'or')}</span>
              </div>

              <form
                className={styles.form}
                onSubmit={mode === 'signup' ? handleSignup : handleLogin}
              >
                {mode === 'signup' && (
                  <label className={styles.field}>
                    <span className={styles.label}>
                      {t('Fornavn', 'First name')}
                    </span>
                    <input
                      className={styles.input}
                      type="text"
                      name="first-name"
                      autoComplete="given-name"
                      placeholder={t('Fornavnet ditt', 'Your first name')}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                )}

                {mode === 'signup' && (
                  <label className={styles.field}>
                    <span className={styles.label}>
                      {t('Brukernavn', 'Username')}
                    </span>
                    <input
                      className={styles.input}
                      type="text"
                      name="username"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder={t('ditt offentlige brukernavn', 'your public handle')}
                      required
                      aria-invalid={fieldErrors.username ? true : undefined}
                      aria-describedby={
                        fieldErrors.username ? 'signup-username-error' : undefined
                      }
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        clearFieldError('username');
                      }}
                    />
                    {fieldErrors.username ? (
                      <span
                        id="signup-username-error"
                        className={styles.fieldError}
                      >
                        {fieldErrors.username}
                      </span>
                    ) : (
                      <span className={styles.hint}>
                        {t(
                          'Din offentlige profil finnes på',
                          'Your public profile lives at',
                        )}{' '}
                        /u/{username.trim().toLowerCase() || 'username'}
                      </span>
                    )}
                  </label>
                )}

                <label className={styles.field}>
                  <span className={styles.label}>{t('E-post', 'Email')}</span>
                  <input
                    className={styles.input}
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder={t('deg@eksempel.no', 'you@example.com')}
                    required
                    aria-invalid={
                      mode === 'signup' && fieldErrors.email ? true : undefined
                    }
                    aria-describedby={
                      mode === 'signup' && fieldErrors.email
                        ? 'signup-email-error'
                        : undefined
                    }
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      clearFieldError('email');
                    }}
                  />
                  {mode === 'signup' && fieldErrors.email && (
                    <span id="signup-email-error" className={styles.fieldError}>
                      {fieldErrors.email}
                      {emailTaken && (
                        <>
                          {' '}
                          <button
                            type="button"
                            className={styles.errorLink}
                            onClick={() => switchMode('login')}
                          >
                            {t('Gå til innlogging', 'Go to login')}
                          </button>
                        </>
                      )}
                    </span>
                  )}
                </label>

                <label className={styles.field}>
                  <span className={styles.label}>{t('Passord', 'Password')}</span>
                  <input
                    className={styles.input}
                    type="password"
                    name="password"
                    autoComplete={
                      mode === 'signup' ? 'new-password' : 'current-password'
                    }
                    placeholder={
                      mode === 'signup'
                        ? t(
                            `Minst ${MIN_PASSWORD_LENGTH} tegn`,
                            `At least ${MIN_PASSWORD_LENGTH} characters`,
                          )
                        : '••••••••'
                    }
                    required
                    aria-invalid={
                      mode === 'signup' && fieldErrors.password
                        ? true
                        : undefined
                    }
                    aria-describedby={
                      mode === 'signup' && fieldErrors.password
                        ? 'signup-password-error'
                        : undefined
                    }
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      clearFieldError('password');
                    }}
                  />
                  {mode === 'signup' && fieldErrors.password && (
                    <span
                      id="signup-password-error"
                      className={styles.fieldError}
                    >
                      {fieldErrors.password}
                    </span>
                  )}
                </label>

                {mode === 'signup' && strength?.ok && (
                  <p className={styles.strength} data-level={strength.strength}>
                    {t('Passordstyrke', 'Password strength')}:{' '}
                    {passwordStrengthLabel(strength.strength, t)}
                  </p>
                )}

                {mode === 'signup' && (
                  <label className={styles.field}>
                    <span className={styles.label}>
                      {t('Gjenta passord', 'Repeat password')}
                    </span>
                    <input
                      className={styles.input}
                      type="password"
                      name="confirm-password"
                      autoComplete="new-password"
                      placeholder="••••••••"
                      required
                      aria-invalid={fieldErrors.confirm ? true : undefined}
                      aria-describedby={
                        fieldErrors.confirm ? 'signup-confirm-error' : undefined
                      }
                      value={confirm}
                      onChange={(e) => {
                        setConfirm(e.target.value);
                        clearFieldError('confirm');
                      }}
                    />
                    {fieldErrors.confirm && (
                      <span
                        id="signup-confirm-error"
                        className={styles.fieldError}
                      >
                        {fieldErrors.confirm}
                      </span>
                    )}
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
                    {busy
                      ? t('Sender …', 'Sending…')
                      : t('Tilbakestill passord', 'Reset password')}
                  </button>
                )}

                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={busy}
                >
                  {busy
                    ? t('Et øyeblikk …', 'One moment…')
                    : mode === 'signup'
                      ? t('Opprett konto', 'Create account')
                      : t('Logg inn', 'Log in')}
                </button>

                {mode === 'login' && (
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => switchMode('forgot')}
                  >
                    {t('Glemt passord?', 'Forgot password?')}
                  </button>
                )}
              </form>

              <div className={styles.signupRow}>
                <span>
                  {mode === 'signup'
                    ? t('Har du allerede en konto?', 'Already have an account?')
                    : t('Ingen konto ennå?', 'No account yet?')}
                </span>
                <button
                  type="button"
                  className={styles.signupBtn}
                  onClick={() =>
                    switchMode(mode === 'signup' ? 'login' : 'signup')
                  }
                >
                  {mode === 'signup'
                    ? t('Logg inn', 'Log in')
                    : t('Registrer deg', 'Sign up')}
                </button>
              </div>

              <div className={styles.divider}>
                <span>{t('eller', 'or')}</span>
              </div>

              <button
                type="button"
                className={styles.guestBtn}
                // The terms gate for guests lives in Root (so deep links
                // straight into the planner are covered too); this just
                // hands over.
                onClick={onContinueAsGuest}
              >
                {t('Fortsett som gjest', 'Continue as guest')}
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
        {t('Foto', 'Photo')}: {photo.credit}
      </a>
    </div>
  );
}
