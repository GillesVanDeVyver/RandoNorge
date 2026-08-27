// The saved routes list. This is the screen the phase is judged on: it proves
// the phone can authenticate against the real backend and read the real data.
//
// EVERY NON-TRIVIAL LINE OF THIS SCREEN IS ALREADY WRITTEN. `listRoutes` is
// @fjellrute/core/routes/api — the same function apps/web calls, including the
// GeoJSON MultiLineString parsing and the localized error messages — and the
// distance/ascent/date formatting is @fjellrute/core/routes/format. That is the
// point of the shared package, and it is why this file is presentation and
// error states and nothing else. If the storage format changes, it changes in
// one place and both apps follow.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link } from 'expo-router';
import { useT } from '@fjellrute/core/i18n';
import { listRoutes, type SavedRoute } from '@fjellrute/core/routes/api';
import {
  formatAscent,
  formatDate,
  formatDistance,
} from '@fjellrute/core/routes/format';
import { authClient } from '../src/auth/client';
import { API_BASE, IS_LOCAL_API, IS_PRODUCTION_API } from '../src/config/api';
import { LanguageSwitcher } from '../src/ui/LanguageSwitcher';
import {
  colors,
  fontSize,
  radius,
  space,
  TOUCH_TARGET,
} from '../src/ui/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; routes: SavedRoute[] }
  | { status: 'error'; message: string };

export default function RoutesScreen() {
  const t = useT();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  // RETURNS the next state instead of setting it. That is the whole design of
  // this screen's loading, and it buys two things.
  //
  // First, the three callers want three different things on screen while the
  // request is in flight: the effect below wants nothing, because `state`
  // already starts as 'loading'; the retry button wants the full-screen spinner
  // back in place of the error box; pull-to-refresh wants the list to stay
  // exactly where it is with the control spinning above it. A function that
  // sets state itself has to be told which of those to do, and it grows a
  // `mode` argument that means nothing to the fetch.
  //
  // Second, and the reason it is shaped this way rather than merely documented:
  // a function that sets state cannot be called from an effect without the
  // effect being able to set state on a screen that has since been left. Here
  // the effect owns the decision, so it can drop a result that arrived too
  // late — which is what the `cancelled` flag below does.
  const fetchRoutes = useCallback(async (): Promise<LoadState> => {
    try {
      return { status: 'ready', routes: await listRoutes() };
    } catch (cause) {
      // Two different failures reach here and they need different advice, so
      // the host is named in both: a 401 means the session did not travel
      // (see setAuthHeaders in src/auth/client.ts), while a thrown network
      // error means nothing answered at all.
      const detail = cause instanceof Error ? cause.message : String(cause);
      // The useful advice depends on WHICH backend this build points at, and
      // there are three of those, so there are three answers. Telling someone to
      // go start wrangler while the app is aimed at a deployed Worker sends them
      // to a laptop that has nothing to do with the failure — IS_LOCAL_API was
      // briefly defined as "not production" and had to be narrowed back for
      // exactly this line. Wrong advice on an error screen is worse than none,
      // because it gets followed.
      let hint: string | null = null;
      if (IS_LOCAL_API) {
        hint = t(
          `Sjekk at wrangler kjører på ${API_BASE} og lytter på 0.0.0.0.`,
          `Check that wrangler is running at ${API_BASE} and listening on 0.0.0.0.`,
        );
      } else if (!IS_PRODUCTION_API) {
        hint = t(
          'Sjekk at dev-workeren er publisert: pnpm build && npx wrangler deploy --env dev',
          'Check that the dev Worker has been deployed: pnpm build && npx wrangler deploy --env dev',
        );
      }
      return {
        status: 'error',
        message: hint === null ? detail : `${detail}\n\n${hint}`,
      };
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchRoutes();
      // Signing out unmounts this screen while its request may still be open.
      // Without this the reply lands on a screen the user has left, and on a
      // 401 it would replace the login form with this screen's error box.
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchRoutes]);

  /** The error box's button: back to the spinner, then load again. */
  const retry = () => {
    // Leaving the error message up while the request is in flight makes the
    // button look inert.
    setState({ status: 'loading' });
    void fetchRoutes().then(setState);
  };

  /** Pull-to-refresh: the list stays put, the control spins above it. */
  const refresh = () => {
    setRefreshing(true);
    void fetchRoutes().then((next) => {
      setState(next);
      // Also on the error path, or the control spins forever over a list that
      // is not being reloaded.
      setRefreshing(false);
    });
  };

  return (
    <View style={styles.page}>
      <View style={styles.toolbar}>
        <LanguageSwitcher />
        <Pressable
          onPress={() => void authClient.signOut()}
          style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
          accessibilityRole="button"
        >
          <Text style={styles.signOutText}>{t('Logg ut', 'Sign out')}</Text>
        </Pressable>
      </View>

      {state.status === 'loading' && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}

      {state.status === 'error' && (
        <View style={styles.centered}>
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>
              {t('Kunne ikke hente turene', 'Could not load your routes')}
            </Text>
            <Text style={styles.errorText}>{state.message}</Text>
          </View>
          <Pressable
            onPress={retry}
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>{t('Prøv igjen', 'Try again')}</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'ready' && (
        <FlatList
          data={state.routes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>
                {t('Ingen lagrede turer', 'No saved routes')}
              </Text>
              <Text style={styles.emptyText}>
                {t(
                  'Turer du lagrer på fjellrute.no vises her.',
                  'Routes you save at fjellrute.no appear here.',
                )}
              </Text>
            </View>
          }
          renderItem={({ item }) => <RouteRow route={item} />}
        />
      )}
    </View>
  );
}

function RouteRow({ route }: { route: SavedRoute }) {
  const t = useT();
  // A row whose geometry failed to parse still lists — core's parseRow returns
  // an empty route rather than throwing — but it cannot be opened on a map, so
  // say so instead of navigating to a blank one.
  const points = route.route.reduce((n, seg) => n + seg.length, 0);
  const openable = points > 1;

  const body = (
    <View style={[styles.card, !openable && styles.cardDisabled]}>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {route.name}
      </Text>
      {route.description !== null && route.description.length > 0 && (
        <Text style={styles.cardDescription} numberOfLines={2}>
          {route.description}
        </Text>
      )}
      <Text style={styles.cardMeta}>
        {[
          formatDistance(route.distanceM),
          formatAscent(route.ascentM),
          // formatDate goes through toLocaleDateString with a BCP 47 tag, which
          // needs Intl. Hermes has it (backed by the platform's ICU on Android,
          // the system on iOS) so this matches the web's output — but it is the
          // one formatter here that could differ per device, so if a date ever
          // renders as an ISO string this is why.
          formatDate(route.updatedAt),
        ]
          // The formatters return '—' for unknown rather than an empty string,
          // which is right in a table but reads as noise in a one-line summary
          // ('—  ·  —  ·  12 Mar 2026'). Dropped here rather than changed in
          // core, where the web app depends on the placeholder.
          .filter((part) => part !== '—')
          .join('  ·  ')}
      </Text>
      {!openable && (
        <Text style={styles.cardWarning}>
          {t('Kan ikke vises på kart', 'Cannot be shown on a map')}
        </Text>
      )}
    </View>
  );

  if (!openable) return body;

  return (
    <Link href={{ pathname: '/route/[id]', params: { id: route.id } }} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={route.name}>
        {body}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.s4,
    paddingVertical: space.s2,
    gap: space.s4,
  },
  signOut: {
    minHeight: TOUCH_TARGET - 8,
    justifyContent: 'center',
    paddingHorizontal: space.s4,
    borderRadius: radius.pill,
  },
  signOutPressed: { backgroundColor: colors.surfaceActive },
  signOutText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },

  list: { padding: space.s4, gap: space.s3, flexGrow: 1 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: space.s4,
    gap: space.s1,
  },
  cardDisabled: { opacity: 0.6 },
  cardTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.text },
  cardDescription: { fontSize: fontSize.sm, color: colors.textMuted },
  cardMeta: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: space.s1,
  },
  cardWarning: { fontSize: fontSize.xs, color: colors.danger },

  centered: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.s6,
    gap: space.s4,
  },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.text },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },

  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderRadius: radius.md,
    padding: space.s4,
    gap: space.s1,
    alignSelf: 'stretch',
  },
  errorTitle: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.danger,
  },
  errorText: { fontSize: fontSize.sm, color: colors.danger, lineHeight: 19 },
  retry: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: space.s6,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
  },
  retryPressed: { backgroundColor: colors.accentPressed },
  retryText: {
    color: colors.accentContrast,
    fontSize: fontSize.base,
    fontWeight: '600',
  },
});
