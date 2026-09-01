// In-app feedback form, opened from the account overview's feedback card —
// the React Native half of apps/web/src/components/FeedbackDialog.tsx.
//
// The web file's own reasoning applies unchanged and is not repeated: it
// replaces a mailto: link, so nothing about sending feedback should require
// leaving the app; a message the server accepted but could not email is still
// a success; and a failure to reach the server keeps the dialog open with the
// typed text intact, because losing what someone just wrote is the one outcome
// worth avoiding. Both clients call the same `sendFeedback` in
// @fjellrute/core/feedback/api, so all of that is one implementation and this
// file is only the form around it.
//
// WHAT THE PLATFORM CHANGES:
//
//   - Escape becomes Modal's `onRequestClose`, which is Android's hardware back
//     button. Same gesture, same handler, no window-level keydown listener
//     because React Native has no window to attach one to.
//   - The backdrop click test (`e.target === e.currentTarget`) becomes a
//     dismissing Pressable with a non-dismissing Pressable island inside it,
//     the same shape AccountChip uses — see the note there.
//   - `autoFocus` on the textarea becomes TextInput's `autoFocus`. The dialog
//     exists to be typed in, and on a phone that also means raising the
//     keyboard, which is the more consequential half.
//   - `maxLength` is on the input on both, but the counter here counts the
//     TRIMMED length exactly as the web's does, so it can read below the number
//     of characters visibly typed when they are spaces. That is deliberate on
//     the web and copied rather than "fixed": the trimmed length is what the
//     limit is actually applied to.
//
// KeyboardAvoidingView + a scrolling panel, because the message box is the
// tallest thing on the screen and the send button is below it: with a keyboard
// up on a small phone, the actions row is exactly what falls off the bottom.
// The web's panel has `max-height: calc(100vh - 2 * space-4); overflow: auto`
// for the same reason and says so.

import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  MAX_FEEDBACK_LENGTH,
  sendFeedback,
} from '@fjellrute/core/feedback/api';
import { useT } from '@fjellrute/core/i18n';
import {
  colors,
  fontSize,
  radius,
  shadow,
  space,
  TOUCH_TARGET,
} from './theme';

type Props = {
  /** Prefill for the reply address — the signed-in account's own email. */
  accountEmail: string;
  /** Close the dialog (back button, backdrop, cancel, or after a send). */
  onClose: () => void;
};

export function FeedbackDialog({ accountEmail, onClose }: Props) {
  const t = useT();
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState(accountEmail);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const trimmed = message.trim();
  const tooLong = trimmed.length > MAX_FEEDBACK_LENGTH;
  const canSend = trimmed.length > 0 && !tooLong && !sending;

  async function submit() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await sendFeedback(trimmed, replyTo.trim());
      setSent(true);
    } catch (err) {
      // The typed text stays in state, so nothing is lost on a retry.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      // The status bar sits over a near-black backdrop while this is up, so on
      // Android the light icons are the readable ones. iOS ignores this prop.
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.flex}
        // Only iOS moves the view; on Android the system resizes the window and
        // doing both pushes the panel off the top. Same split as login.tsx.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('Lukk', 'Close')}
        >
          {/* The island: swallows taps so typing in the panel does not dismiss
              the dialog behind it. */}
          <Pressable style={styles.panelHolder} onPress={() => {}}>
            <ScrollView
              style={styles.panel}
              contentContainerStyle={styles.panelContent}
              keyboardShouldPersistTaps="handled"
              alwaysBounceVertical={false}
            >
              {sent ? (
                // Confirmation state. Deliberately explicit that a human reads
                // it: the alpha runs on testers bothering to write in, and
                // "thanks, received" is the least we owe someone who did.
                <>
                  <Text style={styles.title}>
                    {t(
                      'Takk for tilbakemeldingen!',
                      'Thank you for your feedback!',
                    )}
                  </Text>
                  <Text style={styles.intro}>
                    {t(
                      'Meldingen er mottatt, og den blir lest. Trenger vi flere detaljer, tar vi kontakt.',
                      'Your message has been received, and it will be read. If we need more detail, we will get in touch.',
                    )}
                  </Text>
                  <View style={styles.actions}>
                    <View />
                    <Pressable
                      onPress={onClose}
                      style={({ pressed }) => [
                        styles.sendBtn,
                        pressed && styles.sendBtnPressed,
                      ]}
                      accessibilityRole="button"
                    >
                      <Text style={styles.sendBtnText}>
                        {t('Lukk', 'Close')}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.title}>
                    {t('Send tilbakemelding', 'Send feedback')}
                  </Text>
                  <Text style={styles.intro}>
                    {t(
                      'Fant du en feil, mangler det noe, eller er noe forvirrende? Skriv det her — det går rett til utvikleren.',
                      'Found a bug, is something missing, or is something confusing? Write it here — it goes straight to the developer.',
                    )}
                  </Text>

                  <Text style={styles.label}>
                    {t('MELDING', 'MESSAGE')}
                  </Text>
                  <TextInput
                    style={[styles.input, styles.textarea]}
                    value={message}
                    onChangeText={setMessage}
                    multiline
                    textAlignVertical="top"
                    maxLength={MAX_FEEDBACK_LENGTH}
                    editable={!sending}
                    autoFocus
                    placeholder={t(
                      'Beskriv hva du opplevde, og hva du forventet …',
                      'Describe what happened, and what you expected…',
                    )}
                    placeholderTextColor={colors.textFaint}
                  />
                  <Text style={styles.counter}>
                    {trimmed.length} / {MAX_FEEDBACK_LENGTH}
                  </Text>

                  <Text style={styles.label}>
                    {t('SVARADRESSE', 'REPLY ADDRESS')}
                    <Text style={styles.optional}>
                      {t('  valgfritt', '  optional')}
                    </Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={replyTo}
                    onChangeText={setReplyTo}
                    editable={!sending}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    placeholder={accountEmail}
                    placeholderTextColor={colors.textFaint}
                  />
                  <Text style={styles.hint}>
                    {t(
                      'Vi bruker denne kun for å svare deg. Tøm feltet hvis du ikke vil ha svar.',
                      'We use this only to reply to you. Clear the field if you would rather not have a reply.',
                    )}
                  </Text>

                  {error !== null && (
                    <Text style={styles.error} accessibilityLiveRegion="polite">
                      {error}
                    </Text>
                  )}

                  <View style={styles.actions}>
                    <Pressable
                      onPress={onClose}
                      disabled={sending}
                      style={styles.cancelBtn}
                      accessibilityRole="button"
                    >
                      <Text
                        style={[
                          styles.cancelBtnText,
                          sending && styles.cancelBtnTextDisabled,
                        ]}
                      >
                        {t('Avbryt', 'Cancel')}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void submit()}
                      disabled={!canSend}
                      style={({ pressed }) => [
                        styles.sendBtn,
                        pressed && styles.sendBtnPressed,
                        !canSend && styles.sendBtnDisabled,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !canSend, busy: sending }}
                    >
                      {sending ? (
                        <ActivityIndicator color={colors.accentContrast} />
                      ) : (
                        <Text style={styles.sendBtnText}>
                          {t('Send', 'Send')}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.s4,
    // Heavier than AccountChip's `popoverBackdrop`, and for the opposite
    // reason: this IS a modal task, and the page behind it should recede rather
    // than stay a live surface.
    backgroundColor: colors.backdrop,
  },
  panelHolder: {
    // `width: min(520px, 100%)`, as the two rules RN needs to say it in.
    width: '100%',
    maxWidth: 520,
  },
  panel: {
    // Not `flex: 1` — the panel is as tall as its content and no taller, up to
    // the height the backdrop's padding leaves it. `flexGrow: 0` is what stops
    // a ScrollView filling its parent by default.
    flexGrow: 0,
    backgroundColor: colors.glass,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    ...shadow.level2,
  },
  panelContent: { padding: space.s6 },

  title: {
    marginBottom: space.s3,
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  intro: {
    marginBottom: space.s6,
    fontSize: fontSize.sm,
    lineHeight: 21,
    color: colors.textMuted,
  },

  label: {
    marginBottom: space.s2,
    fontSize: fontSize.xs,
    fontWeight: '700',
    // The web uppercases in CSS; RN has no `text-transform`, so the strings are
    // uppercase at the call site above — same convention as the hub's eyebrow.
    letterSpacing: 11 * 0.08,
    color: colors.textMuted,
  },
  optional: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    letterSpacing: 0,
    color: colors.textFaint,
  },

  input: {
    padding: space.s3,
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.md,
    // 16, not `fontSize.base` (15), for the reason login.tsx spells out: 16 is
    // iOS's threshold for auto-zooming a focused field.
    fontSize: 16,
    lineHeight: 25,
    color: colors.text,
  },
  textarea: { minHeight: 132 },
  counter: {
    marginTop: space.s1,
    marginBottom: space.s4,
    fontSize: fontSize.xs,
    color: colors.textFaint,
    textAlign: 'right',
  },
  hint: {
    marginTop: space.s2,
    fontSize: fontSize.xs,
    lineHeight: 17,
    color: colors.textFaint,
  },
  // THE PHONE'S ERROR BLOCK, not the web's, and the difference is one shade.
  // The web draws this as `--descent-strong` on a tinted, bordered block built
  // from `--descent` at 0.1 and 0.35. `colors.danger` IS `--descent-strong` —
  // same value — so the text is exact; the tint becomes `dangerSurface`, which
  // theme.ts derives from `danger` rather than picking, and the border goes.
  // What that buys is that a failed send here looks like a failed sign-in in
  // login.tsx, which is the comparison a user can actually make.
  error: {
    marginTop: space.s4,
    padding: space.s3,
    fontSize: fontSize.sm,
    lineHeight: 20,
    color: colors.danger,
    backgroundColor: colors.dangerSurface,
    borderRadius: radius.sm,
  },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s3,
    marginTop: space.s6,
  },
  cancelBtn: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    // Padded left-negative would be neater than this, but the web's cancel is a
    // bare text link flush with the panel's padding; keeping it flush matters
    // more than the extra few points of tap width a horizontal pad would buy.
    paddingRight: space.s4,
  },
  cancelBtnText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
  cancelBtnTextDisabled: { color: colors.textFaint },
  sendBtn: {
    minHeight: TOUCH_TARGET,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.s6,
    // The web fills this with `linear-gradient(180deg, accent-hover, accent)`.
    // A two-stop vertical gradient behind a label is not worth an <Svg> and an
    // absolutely-positioned child; the flat accent is what every other primary
    // button on the phone already uses, including login's.
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    ...shadow.level2,
  },
  sendBtnPressed: { backgroundColor: colors.accentPressed },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.accentContrast,
  },
});
