// The root of the app: adapters installed, then a session gate over the router.
//
// ORDER MATTERS HERE, more than anywhere else in the app. Two things must be
// true before a single component renders:
//
//   1. @fjellrute/core knows the API host. Its route client builds
//      root-relative paths, which React Native's fetch cannot resolve; a
//      request made before setApiBase() throws rather than 401s, so the failure
//      does not look like an auth problem and costs an hour.
//   2. The locale store has read the stored language. Core resolves the
//      starting locale when its module loads, so restoring the choice has to
//      happen before the first frame or the app opens in Norwegian and flips.
//
// Both are therefore called at MODULE SCOPE, not in an effect. An effect runs
// after the first render, which is already too late for (2) and racy for (1)
// once a screen fetches on mount. Both functions are idempotent, so Fast
// Refresh re-running this file is harmless.

import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useT } from '@fjellrute/core/i18n';
import { authClient, installCoreNetworking } from '../src/auth/client';
import { installLocaleStorage } from '../src/i18n/install';
import { colors, fontSize, space } from '../src/ui/theme';

installCoreNetworking();
installLocaleStorage();

/**
 * Routes reachable without a session. Everything else redirects to /login.
 * A list rather than a boolean because password reset and terms will join it,
 * and a second special case written as a second `if` is how gates rot.
 */
const PUBLIC_SEGMENTS = new Set(['login']);

function SessionGate() {
  const { data: session, isPending } = authClient.useSession();
  const segments = useSegments();
  const router = useRouter();
  const t = useT();

  const first = segments[0];
  const onPublicRoute = first !== undefined && PUBLIC_SEGMENTS.has(first);

  useEffect(() => {
    // While the session is still being read out of SecureStore, redirecting
    // either way would be a guess — and guessing "logged out" here is exactly
    // the bug that makes a logged-in user see the login screen for a moment on
    // every cold start.
    if (isPending) return;

    if (!session && !onPublicRoute) {
      router.replace('/login');
    } else if (session && onPublicRoute) {
      router.replace('/');
    }
  }, [isPending, session, onPublicRoute, router]);

  if (isPending) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.loadingText}>{t('Laster…', 'Loading…')}</Text>
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        // The header takes the PAGE colour, not `surface`. White-on-cream put a
        // hard horizontal seam across the top of every screen, and the web has
        // no such bar to justify it — its chrome floats over the content. Same
        // colour plus no shadow is the closest a native stack header gets to
        // that, and it makes the cream read as one continuous canvas.
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {/* THE SIGNED-IN ROUTE SET, in the order the hub lists it, and it is
          meant to be read against the `SignedInView` union in
          apps/web/src/Root.tsx: overview, planner, saved, completed, track,
          offline. Four of those six are below. The two that are not — `track`
          (`/completed/:id`) and `offline` — are absent because neither has
          anything to read: the tracking client is not in packages/core and
          there is no offline store on the phone at all. An empty screen is
          worth registering; a screen with no way to fill it is not.

          The titles are translated, unlike `index`'s, because they are words
          rather than the product's name. They also do real work here: the
          toolbar that used to name the saved list moved to the hub with the
          account actions, so the stack header is now the only thing on these
          screens that says which one you are on. */}
      <Stack.Screen name="index" options={{ title: 'Fjellrute' }} />
      <Stack.Screen
        name="planner"
        options={{ title: t('Planlegg', 'Plan') }}
      />
      <Stack.Screen
        name="saved"
        options={{ title: t('Lagrede ruter', 'Saved routes') }}
      />
      <Stack.Screen
        name="completed"
        options={{ title: t('Fullførte ruter', 'Completed routes') }}
      />
      {/* No header on login: it is the whole screen and has its own title. */}
      <Stack.Screen name="login" options={{ headerShown: false }} />
      {/* Title comes from the route's own name once it is loaded. */}
      <Stack.Screen name="route/[id]" options={{ title: '' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SessionGate />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s4,
    backgroundColor: colors.background,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: fontSize.base,
  },
});
