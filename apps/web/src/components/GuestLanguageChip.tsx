import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import styles from './GuestLanguageChip.module.css';

/**
 * Language toggle for guests. Signed-in users reach the NO/EN switch from
 * the account chip's popover, which someone who chose "Continue as guest"
 * never sees — leaving them stuck in whatever language the app opened in.
 * This puts the switch in the same top-right corner as the account chip,
 * so the control lives in one place whether or not you have an account.
 */
export function GuestLanguageChip() {
  return (
    <div className={styles.root}>
      <LanguageSwitcher variant="surface" />
    </div>
  );
}
