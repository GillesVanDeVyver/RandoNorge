// Sign in with an existing account.
//
// SIGN-IN ONLY, AND WHY. Creating an account requires an invite code during the
// alpha (worker/index.js, gatedEmailSignUp), plus a password policy, a username
// policy, a terms acceptance step and email verification — apps/web's
// LoginPage.tsx is over 700 lines for exactly those reasons. Reproducing that
// here would be the largest single piece of this phase and would duplicate
// rules that must not drift, for a flow each user goes through once. So the
// phone signs in, and sends anyone without an account to the web to make one.
// If the two policy modules in apps/web/src/auth move into @fjellrute/core
// later, sign-up here becomes cheap; until then this is a deliberate omission,
// not an oversight.
//
// The plan's acceptance criterion for this phase is about what happens AFTER a
// successful sign-in: kill the app, reopen it, still signed in. Nothing on this
// screen implements that — it is expo-secure-store under the expoClient plugin
// (src/auth/client.ts). What this screen must not do is get in the way of it,
// which is why there is no "remember me": the session is always persisted, as
// it is on the web.

import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useT } from '@fjellrute/core/i18n';
import { authClient } from '../src/auth/client';
import { API_BASE, IS_PRODUCTION_API } from '../src/config/api';
import { LanguageSwitcher } from '../src/ui/LanguageSwitcher';
import {
  colors,
  fontSize,
  radius,
  space,
  TOUCH_TARGET,
} from '../src/ui/theme';

export default function LoginScreen() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await authClient.signIn.email({
        // Trimmed because the on-screen keyboard's autocomplete happily appends
        // a space, and an email with a trailing space fails to match a row —
        // which surfaces as "wrong password" for a correct password.
        email: email.trim(),
        password,
      });
      if (authError) {
        // Better Auth answers the same 401 for an unknown address and a wrong
        // password, deliberately, so that this screen cannot be used to check
        // whether someone has an account. The web app asks
        // /api/account-exists to tell the two apart; that is rate-limited
        // account enumeration by design and is not worth reproducing here, so
        // the phone shows the honest combined message.
        setError(
          authError.message ??
            t(
              'Kunne ikke logge inn. Sjekk e-postadressen og passordet.',
              'Could not sign in. Check the email address and password.',
            ),
        );
        return;
      }
      // No navigation on success. The gate in _layout.tsx is subscribed to the
      // session and redirects when it changes; navigating here as well would
      // race it and can leave the login screen on the back stack.
    } catch (cause) {
      // A thrown error rather than an `error` result means the request never
      // got an answer: wrong host, wrangler not listening on 0.0.0.0, phone on
      // a different network. Say which host was tried, because that is the
      // single most useful fact and the user cannot see it otherwise.
      setError(
        t(
          `Fikk ikke kontakt med ${API_BASE}.`,
          `Could not reach ${API_BASE}.`,
        ) +
          (cause instanceof Error && cause.message ? ` (${cause.message})` : ''),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      // Only iOS moves the view; on Android the system already resizes the
      // window, and doing both lifts the fields off the top of the screen.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Fjellrute</Text>
          <LanguageSwitcher />
        </View>

        <Text style={styles.lede}>
          {t(
            'Logg inn for å se turene dine.',
            'Sign in to see your saved routes.',
          )}
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>{t('E-post', 'Email')}</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            editable={!busy}
            placeholder="deg@example.no"
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t('Passord', 'Password')}</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            editable={!busy}
          />
        </View>

        {error !== null && (
          <View style={styles.errorBox} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          onPress={() => void submit()}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            !canSubmit && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit, busy }}
        >
          {busy ? (
            <ActivityIndicator color={colors.accentContrast} />
          ) : (
            <Text style={styles.buttonText}>{t('Logg inn', 'Sign in')}</Text>
          )}
        </Pressable>

        <Text style={styles.footnote}>
          {t(
            'Har du ikke konto? Alfaen krever en invitasjonskode, og kontoer opprettes på fjellrute.no.',
            'No account yet? The alpha needs an invite code, and accounts are created at fjellrute.no.',
          )}
        </Text>

        {!IS_PRODUCTION_API && (
          // Any backend that is not production, which now means a laptop OR the
          // deployed dev Worker. Without this, an empty route list is ambiguous:
          // it could be the wrong backend. Deliberately NOT IS_LOCAL_API — that
          // is narrower now, and gating on it would hide the host in exactly the
          // case where it is least guessable, since a workers.dev URL is not
          // something you can infer from the phone's own network.
          <Text style={styles.devNote}>{`dev → ${API_BASE}`}</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  page: {
    padding: space.s6,
    paddingTop: space.s8 * 2,
    gap: space.s4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s4,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  lede: {
    fontSize: fontSize.base,
    color: colors.textMuted,
    marginBottom: space.s2,
  },
  field: { gap: space.s1 },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
  },
  input: {
    minHeight: TOUCH_TARGET + 4,
    paddingHorizontal: space.s4,
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radius.md,
    // The one deliberate step off the scale in this file. 16 is iOS's threshold
    // for auto-zooming a focused field; `fontSize.base` is 15, and a login form
    // that zooms the page the moment the email field is tapped is a worse
    // failure than a 1px inconsistency. Text INSIDE an input is also the one
    // place the scale is not really setting type — it is setting a control's
    // size, which is what TOUCH_TARGET is doing on the line above.
    fontSize: 16,
    color: colors.text,
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderRadius: radius.sm,
    padding: space.s4,
  },
  errorText: { color: colors.danger, fontSize: fontSize.sm },
  button: {
    minHeight: TOUCH_TARGET + 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    marginTop: space.s2,
  },
  buttonPressed: { backgroundColor: colors.accentPressed },
  buttonDisabled: { opacity: 0.5 },
  buttonText: {
    color: colors.accentContrast,
    fontSize: fontSize.base,
    fontWeight: '600',
  },
  footnote: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    color: colors.textMuted,
    marginTop: space.s2,
  },
  devNote: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: space.s6,
  },
});
