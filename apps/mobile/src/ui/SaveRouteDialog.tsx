// Name the route and put it in the library — the React Native half of
// apps/web/src/components/SaveRouteDialog.tsx.
//
// The props are the web component's props, deliberately unchanged down to the
// order: `initialName`, `initialDescription`, `isUpdate`, `statsLabel`,
// `onSave`, `onClose`. That is not tidiness. The two files are the same dialog
// on two screens, and a shared prop list is what makes a change to one of them
// obviously a change that has to be made to the other — a phone dialog that
// took a `route` and did its own saving would drift apart from the web's
// without either file ever looking wrong.
//
// The behaviour is the web's too, including the parts that look like
// oversights and are not:
//
//   - `busy` is never cleared on SUCCESS. The parent unmounts the dialog when
//     the save resolves, so clearing it would be a state update on the way out;
//     leaving the form locked also means a second tap during the unmount cannot
//     start a second save. It is cleared in the catch, which is the path where
//     the dialog stays up.
//   - The name is trimmed before it is handed over, and an all-whitespace name
//     is simply not submittable — the button is disabled on `!name.trim()`,
//     which is the web's rule, rather than an error message appearing after the
//     fact.
//   - Errors surface inline and the typed text stays. The usual cause is a
//     mountain with no signal, and the remedy is pressing Save again.
//
// WHAT THE PLATFORM CHANGES is the same short list FeedbackDialog's header
// gives, and for the same reasons: Escape becomes Modal's `onRequestClose`
// (Android's hardware back), the backdrop click test becomes a dismissing
// Pressable with a non-dismissing island inside it, `autoFocus` on the input
// does double duty by raising the keyboard, and a KeyboardAvoidingView wraps
// the lot because the notes box plus a raised keyboard is exactly what pushes
// the footer off the bottom of a small phone.
//
// The one visible difference from the web: no × in the header. The web needs it
// because a mouse has nowhere else to click; here the backdrop is the close
// affordance, the hardware back button is the other, and the footer already
// carries Cancel. A 32-point × in the corner of a phone dialog is a third way
// to do the same thing at half the size of a comfortable target.

import { useState } from 'react';
import {
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
import { useT } from '@fjellrute/core/i18n';
import {
  MAX_ROUTE_DESCRIPTION_LENGTH,
  MAX_ROUTE_NAME_LENGTH,
} from '@fjellrute/core/routes/api';
import {
  colors,
  fontSize,
  radius,
  shadow,
  space,
  TOUCH_TARGET,
} from './theme';

type Props = {
  /** Prefilled when re-saving a route that already has a name. */
  initialName?: string;
  initialDescription?: string;
  /** True when saving updates an existing route instead of creating one. */
  isUpdate: boolean;
  /** Preformatted stats shown under the title, e.g. "12.4 km · 1 240 m ascent". */
  statsLabel: string | null;
  /** Resolves on success; a thrown error is shown inline. */
  onSave: (name: string, description: string) => Promise<void>;
  onClose: () => void;
};

export function SaveRouteDialog({
  initialName = '',
  initialDescription = '',
  isUpdate,
  statsLabel,
  onSave,
  onClose,
}: Props) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !busy;

  /** Only closable while nothing is in flight — the web's backdrop and × both
   *  test `!busy`, because a dialog that vanishes mid-request leaves the user
   *  with no idea whether the route was saved. */
  const close = () => {
    if (!busy) onClose();
  };

  async function submit() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed, description.trim());
      // No setBusy(false): see the header. The parent closes this on success.
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Kunne ikke lagre ruta', 'Could not save the route'),
      );
      setBusy(false);
    }
  }

  const title = isUpdate
    ? t('Lagre endringer', 'Save changes')
    : t('Lagre rute', 'Save route');

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={close}
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
          onPress={close}
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
              <Text style={styles.title} accessibilityRole="header">
                {title}
              </Text>
              {statsLabel !== null && (
                // The figures the route is being saved WITH, said out loud at
                // the moment of saving. The web puts them here for the same
                // reason: they are what the library list will show, and this is
                // the last point at which noticing they are wrong is cheap.
                <Text style={styles.stats}>{statsLabel}</Text>
              )}

              <Text style={styles.label}>{t('NAVN', 'NAME')}</Text>
              <TextInput
                style={[styles.input, busy && styles.inputDisabled]}
                value={name}
                onChangeText={setName}
                editable={!busy}
                autoFocus
                maxLength={MAX_ROUTE_NAME_LENGTH}
                // A tour name is a proper noun far more often than not
                // ("Storebjørn fra Krossbu"), so the keyboard opens shifted.
                autoCapitalize="sentences"
                returnKeyType="done"
                onSubmitEditing={() => void submit()}
                placeholder={t(
                  'f.eks. Storebjørn fra Krossbu',
                  'e.g. Storebjørn from Krossbu',
                )}
                placeholderTextColor={colors.textFaint}
              />

              <Text style={styles.label}>
                {t('NOTATER', 'NOTES')}
                <Text style={styles.optional}>
                  {t('  valgfritt', '  optional')}
                </Text>
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.textarea,
                  busy && styles.inputDisabled,
                ]}
                value={description}
                onChangeText={setDescription}
                editable={!busy}
                multiline
                textAlignVertical="top"
                maxLength={MAX_ROUTE_DESCRIPTION_LENGTH}
                placeholder={t(
                  'Forhold, plan B, ting å huske …',
                  'Conditions, plan B, things to remember…',
                )}
                placeholderTextColor={colors.textFaint}
              />

              {error !== null && (
                <Text style={styles.error} accessibilityLiveRegion="polite">
                  {error}
                </Text>
              )}

              <View style={styles.actions}>
                <Pressable
                  onPress={close}
                  disabled={busy}
                  style={styles.cancelBtn}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.cancelBtnText,
                      busy && styles.cancelBtnTextDisabled,
                    ]}
                  >
                    {t('Avbryt', 'Cancel')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void submit()}
                  disabled={!canSave}
                  style={({ pressed }) => [
                    styles.saveBtn,
                    pressed && styles.saveBtnPressed,
                    !canSave && styles.saveBtnDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canSave, busy }}
                >
                  {/* The busy label is a WORD, not a spinner, unlike
                      FeedbackDialog's send button. A spinner would replace the
                      only text saying which of the two things this button does,
                      and "Saving…" says both that it is working and what it is
                      working on. */}
                  <Text style={styles.saveBtnText}>
                    {busy ? t('Lagrer …', 'Saving…') : title}
                  </Text>
                </Pressable>
              </View>
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
    backgroundColor: colors.backdrop,
  },
  panelHolder: {
    // `width: min(440px, 100%)` — the web's, and narrower than
    // FeedbackDialog's 520 because this form is two short fields rather than a
    // paragraph box.
    width: '100%',
    maxWidth: 440,
  },
  panel: {
    // Not `flex: 1`: the panel is as tall as its content, up to what the
    // backdrop's padding leaves it. `flexGrow: 0` is what stops a ScrollView
    // filling its parent by default.
    flexGrow: 0,
    backgroundColor: colors.glass,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    ...shadow.level2,
  },
  panelContent: { padding: space.s6 },

  title: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  stats: {
    marginTop: space.s1,
    fontSize: fontSize.xs,
    color: colors.textFaint,
    // The web adds its `tnum` class here; this is that class.
    fontVariant: ['tabular-nums'],
  },

  label: {
    marginTop: space.s6,
    marginBottom: space.s2,
    fontSize: fontSize.xs,
    fontWeight: '700',
    // The web uppercases in CSS; RN has no `text-transform`, so the strings are
    // uppercase at the call site — same convention as FeedbackDialog.
    letterSpacing: fontSize.xs * 0.08,
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
  // The web's `:disabled { opacity: 0.6 }`. It is worth having even though the
  // field is only locked for the second or two a save takes: without it the
  // form looks live while it is not, and the first thing anyone does when a
  // save seems slow is start editing the name again.
  inputDisabled: { opacity: 0.6 },
  textarea: { minHeight: 84 },

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
    paddingRight: space.s4,
  },
  cancelBtnText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
  cancelBtnTextDisabled: { color: colors.textFaint },
  saveBtn: {
    minHeight: TOUCH_TARGET,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.s6,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    ...shadow.level2,
  },
  saveBtnPressed: { backgroundColor: colors.accentPressed },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.accentContrast,
  },
});
