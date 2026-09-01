// The signed-in chip, ported from apps/web/src/components/AccountChip.tsx.
//
// WHAT IT REPLACES. The hub used to open with a row containing the NO|EN
// switcher and a text "Sign out" — two controls, permanently on screen, in the
// place the web puts the brand mark and this chip. That row was invented for
// the phone because the phone had nowhere else to put account actions; it is
// not a thing the web has, and it was the first thing that read as "different
// app" above the fold. The controls are the same controls, they now live one
// tap in, behind the same circular initial the browser shows.
//
// WHAT THE WEB'S VERSION HAS THAT THIS DOES NOT:
//
//   - The name beside the avatar. The web hides it below 640px too
//     (AccountChip.module.css's last media query), so a phone showing the bare
//     circle IS the web at this width — this is parity, not a reduction.
//   - "Account overview". The web omits that item while already on the
//     overview, and this chip is only rendered by the overview.
//   - "View public profile" and the @handle. Both need the account's username,
//     which comes from a client that is not in packages/core, and inventing a
//     fetch here is the one thing docs/mobile-web-parity-plan.md forbids
//     outright. The row appears the day that client moves across.
//
// THE POPOVER IS A MODAL, where the web's is an absolutely-positioned div
// closed by a window-level pointerdown listener. React Native has no such
// listener — there is no capture phase over the whole app to attach to — and
// the platform's own answer to "a layer that dismisses when you tap outside
// it" is Modal with a full-screen pressable behind it. That backdrop is also
// what makes Android's hardware back button close the sheet rather than leave
// the screen, which the web gets from Escape.

import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useT } from '@fjellrute/core/i18n';
import { authClient } from '../auth/client';
import { LanguageSwitcher } from './LanguageSwitcher';
import {
  colors,
  fontSize,
  radius,
  shadow,
  space,
  TOUCH_TARGET,
} from './theme';

type Props = {
  /** Display name, or the email when the account has no name set. */
  name: string;
  /** The account's email address, shown in the popover. */
  email: string;
  /** Positioning from the screen that owns it — the chip does not place
   *  itself, because the web's is `position: fixed` against the viewport and
   *  the phone's sits inside the hub's own header row. */
  style?: StyleProp<ViewStyle>;
};

export function AccountChip({ name, email, style }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);

  // Same expression as the web's, including the `?` when neither string has a
  // usable first character: an empty circle looks like a rendering bug, and a
  // question mark looks like an account with no name, which is what it is.
  const initial = (name || email).trim().charAt(0).toUpperCase() || '?';

  return (
    <View style={style}>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        // The visible content is one letter, which announces as a letter. The
        // label is what the chip is FOR.
        accessibilityLabel={t('Konto', 'Account')}
        accessibilityHint={name || email}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        // Android's back button, and iOS's swipe-to-dismiss on a form sheet.
        onRequestClose={() => setOpen(false)}
      >
        {/* The backdrop is the outside-click handler. Deliberately barely
            tinted: the web's popover opens over a page that stays fully
            visible, and a heavy scrim here would make one tap feel like
            leaving the screen. */}
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel={t('Lukk', 'Close')}
        >
          {/* A non-dismissing island inside the dismissing backdrop: the
              popover's own Pressable swallows the tap so pressing the language
              buttons does not also close the sheet behind them. */}
          <Pressable style={styles.popover} onPress={() => {}}>
            <View style={styles.identity}>
              <Text style={styles.identityName}>{name}</Text>
              <Text style={styles.identityEmail}>{email}</Text>
            </View>

            <View style={styles.language}>
              <Text style={styles.languageLabel}>{t('Språk', 'Language')}</Text>
              <LanguageSwitcher />
            </View>

            <Pressable
              onPress={() => {
                setOpen(false);
                // The session gate in app/_layout.tsx reacts to the cleared
                // session and routes to /login — nothing to navigate here.
                void authClient.signOut();
              }}
              style={({ pressed }) => [
                styles.signOut,
                pressed && styles.signOutPressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.signOutText}>{t('Logg ut', 'Log out')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    // The web's chip is a pill with 5px of padding around a 26px avatar once
    // the name is hidden. That totals 36 — under the 44 a finger needs, so the
    // TAP TARGET is padded out to TOUCH_TARGET while the drawn circle stays
    // the web's size. Growing the circle instead would have made the phone's
    // chip visibly larger than the browser's.
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  chipPressed: { backgroundColor: colors.surfaceActive },
  avatar: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    // The chip sits on a photograph here, not on map chrome, so it carries the
    // same hairline the web's pill does — without it the teal circle floats
    // with nothing separating it from a bright patch of fog.
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    ...shadow.level1,
  },
  avatarText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.accentContrast,
  },

  backdrop: {
    flex: 1,
    // Top-right, under where the chip itself sits: the popover should appear
    // to come out of the thing that was tapped, which is what the web's
    // `top: calc(100% + space-2); right: 0` achieves by being a child of it.
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    paddingTop: space.s8 * 2,
    paddingHorizontal: space.s4,
    backgroundColor: colors.popoverBackdrop,
  },
  popover: {
    minWidth: 210,
    maxWidth: 320,
    padding: space.s4,
    gap: space.s3,
    backgroundColor: colors.glass,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    ...shadow.float,
  },

  identity: {
    gap: 2,
    paddingBottom: space.s3,
    borderBottomColor: colors.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  identityName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  identityEmail: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },

  language: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s2,
    paddingBottom: space.s3,
    borderBottomColor: colors.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  languageLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },

  signOut: {
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.hairlineStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
  },
  signOutPressed: { backgroundColor: colors.surfaceActive },
  signOutText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
});
