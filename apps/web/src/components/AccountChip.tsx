import { useEffect, useRef, useState } from 'react';
import { authClient } from '../auth/client';
import { useT } from '../i18n/index.ts';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import styles from './AccountChip.module.css';

type Props = {
  name: string;
  email: string;
  /** The account's public handle, shown as @handle in the popover. Null
   *  while still loading (or if the account has none). */
  username?: string | null;
  /**
   * When provided (and a handle exists), the popover shows a "View public
   * profile" item that opens /u/<handle>.
   */
  onViewProfile?: () => void;
  /**
   * When provided, the popover shows an "Account overview" item that
   * calls this (omitted while already on the overview itself).
   */
  onOverview?: () => void;
};

/**
 * Small signed-in indicator floating over the map (top-right, clear of the
 * toolbar on the left and the info button bottom-right). Click to open a
 * popover with the account details (name, handle, email), links back to the
 * account overview and the user's own public profile, and a log-out action.
 */
export function AccountChip({
  name,
  email,
  username,
  onViewProfile,
  onOverview,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const initial = (name || email).trim().charAt(0).toUpperCase() || '?';

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.chip}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={email}
      >
        <span className={styles.avatar}>{initial}</span>
        <span className={styles.name}>{name || email}</span>
      </button>
      {open && (
        <div className={styles.popover} role="menu">
          <div className={styles.identity}>
            <span className={styles.identityName}>{name}</span>
            {username && (
              <span className={styles.identityHandle}>@{username}</span>
            )}
            <span className={styles.identityEmail}>{email}</span>
          </div>
          {username && onViewProfile && (
            <button
              type="button"
              className={styles.linkBtn}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onViewProfile();
              }}
            >
              {t('Vis offentlig profil', 'View public profile')}
            </button>
          )}
          {onOverview && (
            <button
              type="button"
              className={styles.menuBtn}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOverview();
              }}
            >
              {t('Kontooversikt', 'Account overview')}
            </button>
          )}
          <div className={styles.language}>
            <span className={styles.languageLabel}>
              {t('Språk', 'Language')}
            </span>
            <LanguageSwitcher variant="light" />
          </div>
          <button
            type="button"
            className={styles.signOutBtn}
            role="menuitem"
            onClick={() => {
              // useSession in Root reacts to the cleared session and shows
              // the login page again.
              void authClient.signOut();
            }}
          >
            {t('Logg ut', 'Log out')}
          </button>
        </div>
      )}
    </div>
  );
}
