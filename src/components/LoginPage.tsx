import { useState } from 'react';
import { MountainIcon, RouteIcon, SnowflakeIcon } from './icons';
import styles from './LoginPage.module.css';

type Props = {
  /** Called when the user chooses to enter the app without an account. */
  onContinueAsGuest: () => void;
};

/**
 * Full-screen landing/login view shown before the app. A full-bleed
 * backcountry photo carries a large display headline and product chips,
 * with a compact glass login card beside them.
 *
 * Auth is not wired up yet: the form and the sign-up button are inert
 * placeholders. Only "Continue as guest" proceeds into the app.
 */
export function LoginPage({ onContinueAsGuest }: Props) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

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
            The mountain
            <br />
            is waiting<span className={styles.headlineDot}>.</span>
          </h1>
          <p className={styles.tagline}>
            Draw a line on the map - Fjellrute reads the terrain, the snow
            and the avalanche forecast so you can plan the up and dream
            the down.
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
          <h2 className={styles.cardTitle}>Log in</h2>

          <form
            className={styles.form}
            onSubmit={(e) => {
              // Authentication is not implemented yet.
              e.preventDefault();
            }}
          >
            <label className={styles.field}>
              <span className={styles.label}>Username or email</span>
              <input
                className={styles.input}
                type="text"
                name="identifier"
                autoComplete="username"
                placeholder="you@example.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Password</span>
              <input
                className={styles.input}
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            <button type="submit" className={styles.primaryBtn}>
              Log in
            </button>
          </form>

          <div className={styles.signupRow}>
            <span>No account yet?</span>
            <button type="button" className={styles.signupBtn}>
              Sign up
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
