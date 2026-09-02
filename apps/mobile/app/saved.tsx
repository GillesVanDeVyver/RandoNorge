// The saved routes list — the phone's `/saved`, and apps/web's RoutesListPage.
//
// WAS `index.tsx`, AND THAT WAS THE MISMATCH AN EARLIER PHASE FIXED. On the
// web, `/alpha/` is AccountOverview — a hub whose cards open this list at
// `/saved`. On the phone this list WAS the landing screen, so the two clients
// disagreed about what the root of a signed-in session is.
//
// WHAT THIS PASS CHANGED. The screen was correct and looked like nothing else
// in the product: cream page, white cards, a native stack header. The web's is a
// full-bleed photograph with a floating glass panel on it, and every row carries
// four controls this screen did not have. So it is now the web's composition —
// the same photo, the same scrim, the same panel, the same rows — and the four
// controls are here:
//
//   PUBLIC / PRIVATE   setRouteShared, and the server's answer (with a freshly
//                      minted slug on first share) folded back into the list so
//                      the copy button appears immediately. Same call, same
//                      order as handleToggleRouteShare in apps/web/src/Root.tsx.
//   COPY LINK          the public URL, built by publicShareUrl in
//                      @fjellrute/core/routes/share — the function apps/web's
//                      `shareUrlFor` now wraps — onto the system clipboard.
//   EXPORT GPX         routeToGpx + gpxFilename, the same two core functions
//                      the web's download uses. See exportRoute below for why
//                      the phone shares a file rather than downloading one.
//   DELETE             deleteRoute, behind the web's two-step inline confirm
//                      rather than a blocking dialog.
//
// WHAT IS DELIBERATELY ABSENT, matching the web AT THIS WIDTH rather than in
// general — `@media (max-width: 640px)` in RoutesListPage.module.css turns three
// things off and the phone is narrower than all of them:
//
//   - `.visHint`, the sentence explaining what public means. `display: none`
//     below 640px. Its "Updating…" state goes with it; what remains while the
//     request is in flight is `:disabled`'s 0.6 opacity, which is what the web
//     shows at this width too.
//   - `.brandName`, the wordmark. Hidden, and `.brand` becomes absolutely
//     centred — so the top bar is a back pill on the left and the brand tile in
//     the middle, which is exactly what is reproduced below.
//   - the panel's `--space-8` padding, which drops to `--space-6`.
//
// AND WHAT IS ABSENT FOR THE PHONE'S OWN REASONS:
//
//   - The `kind` prop. The web component serves both `/saved` and `/completed`
//     from one file; the phone has no completed list to serve (the tracking
//     client is not in packages/core), so this screen is the saved half only.
//     app/completed.tsx is still the stub it was.
//   - `onOpenRoute` for a row whose geometry did not parse. Core's parseRow
//     returns an empty route rather than throwing, so such a row still lists —
//     it just cannot be opened on a map, and says so.
//
// EVERY NON-TRIVIAL LINE IS STILL WRITTEN ELSEWHERE. listRoutes, deleteRoute,
// setRouteShared, routeToGpx, gpxFilename, publicShareUrl, getMyUsername, the
// distance/ascent/date formatters and the thumbnail's projection are all
// @fjellrute/core, shared with apps/web. That is the parity plan's one rule, and
// it is why this file is composition, error states and three native calls.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setStatusBarStyle } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useT } from '@fjellrute/core/i18n';
import { getMyUsername } from '@fjellrute/core/account/username';
import {
  deleteRoute,
  listRoutes,
  setRouteShared,
  type SavedRoute,
} from '@fjellrute/core/routes/api';
import {
  formatAscent,
  formatDate,
  formatDistance,
} from '@fjellrute/core/routes/format';
import { gpxFilename, routeToGpx } from '@fjellrute/core/routes/gpx';
import { publicShareUrl } from '@fjellrute/core/routes/share';
import { API_BASE, IS_LOCAL_API, IS_PRODUCTION_API } from '../src/config/api';
import { PhotoBackdrop } from '../src/ui/PhotoBackdrop';
import { LIST_SCRIM } from '../src/ui/scrim';
import { RouteThumbnail } from '../src/ui/RouteThumbnail';
import { OVERVIEW_PHOTOS } from '../src/ui/season';
import {
  ArrowLeftIcon,
  BookmarkIcon,
  CircleCheckIcon,
  DownloadIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  MountainIcon,
  RouteIcon,
  TrashIcon,
} from '../src/ui/icons';
// No `onPhotoShadow` here, unlike the hub: below 640px the wordmark is hidden
// and the panel carries every word on the screen, so nothing on this page is
// white type over a photograph.
import {
  colors,
  fontSize,
  radius,
  shadow,
  space,
  TOUCH_TARGET,
} from '../src/ui/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; routes: SavedRoute[] }
  | { status: 'error'; message: string };

/** How long the copy-link button stays green, matching the web's 1800ms. */
const COPIED_MS = 1800;

export default function SavedRoutesScreen() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  // The four pieces of per-row action state the web keeps, by the same names.
  // Ids rather than booleans because exactly one row can be mid-anything, and a
  // boolean would have to be a map to say which.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // The handle half of a public link. Fetched alongside the list rather than
  // per row: `/u/<handle>/r/<slug>` needs both halves, the handle is the same
  // for every row, and a user who has not claimed one simply has no shareable
  // link yet — which is `undefined` from publicShareUrl and no copy button,
  // exactly as on the web.
  const [username, setUsername] = useState<string | null>(null);

  // ALWAYS THE WINTER PHOTOGRAPH, and that is not an oversight. The hub rotates
  // with the season because `.page::before` in AccountOverview.module.css is
  // themed; RoutesListPage.module.css hard-codes `overview-peaks.jpg` for every
  // season, so the library is the same picture all year. Reaching into the table
  // rather than calling overviewPhoto() is what says so out loud.
  const photo = OVERVIEW_PHOTOS.winter.src;

  // See the long note on the same effect in app/index.tsx: this screen is a dark
  // photograph, the app's status bar is otherwise dark-on-cream, and the screen
  // stays mounted underneath anything pushed on top of it — so focus, not mount,
  // is the condition.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );

  // RETURNS the next state instead of setting it. That is the whole design of
  // this screen's loading, and it buys two things.
  //
  // First, the three callers want three different things on screen while the
  // request is in flight: the effect below wants nothing, because `state`
  // already starts as 'loading'; the retry button wants the loading panel back
  // in place of the error box; pull-to-refresh wants the list to stay exactly
  // where it is with the control spinning above it. A function that sets state
  // itself has to be told which of those to do, and it grows a `mode` argument
  // that means nothing to the fetch.
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Swallowed on purpose. getMyUsername already answers null for anything
      // that is not a 200, and a handle that could not be read costs the copy
      // button and nothing else — it is not worth an error box over a list that
      // loaded fine.
      const handle = await getMyUsername().catch(() => null);
      if (!cancelled) setUsername(handle);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** The error panel's button: back to the loading panel, then load again. */
  const retry = () => {
    // Leaving the error message up while the request is in flight makes the
    // button look inert.
    setState({ status: 'loading' });
    void fetchRoutes().then(setState);
  };

  /** Pull-to-refresh: the panel stays put, the control spins above it. */
  const refresh = () => {
    setRefreshing(true);
    void fetchRoutes().then((next) => {
      setState(next);
      // Also on the error path, or the control spins forever over a list that
      // is not being reloaded.
      setRefreshing(false);
    });
  };

  /** Replace one row in place, for the server's answer to a share toggle. */
  const replaceRoute = (updated: SavedRoute) =>
    setState((prev) =>
      prev.status === 'ready'
        ? {
            status: 'ready',
            routes: prev.routes.map((r) => (r.id === updated.id ? updated : r)),
          }
        : prev,
    );

  const handleToggleShare = async (id: string, share: boolean) => {
    setSharingId(id);
    setActionError(null);
    try {
      replaceRoute(await setRouteShared(id, share));
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : t('Kunne ikke oppdatere deling', 'Could not update sharing'),
      );
    } finally {
      setSharingId(null);
    }
  };

  const handleCopyLink = async (id: string, url: string) => {
    try {
      await Clipboard.setStringAsync(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), COPIED_MS);
    } catch {
      // The web's fallback, and it is worth keeping even though the phone's
      // clipboard has none of the browser's secure-context rules: the point is
      // that a failed copy still puts the link where it can be read and typed,
      // rather than silently doing nothing.
      setActionError(
        t(
          `Kopiering mislyktes – lenken er ${url}`,
          `Copy failed — the link is ${url}`,
        ),
      );
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setActionError(null);
    try {
      await deleteRoute(id);
      setState((prev) =>
        prev.status === 'ready'
          ? { status: 'ready', routes: prev.routes.filter((r) => r.id !== id) }
          : prev,
      );
      setConfirmId(null);
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : t('Kunne ikke slette ruta', 'Could not delete the route'),
      );
    } finally {
      setDeletingId(null);
    }
  };

  // GPX OUT, VIA THE SHARE SHEET RATHER THAN A DOWNLOAD. The web writes a Blob
  // and clicks an <a download>, which lands the file in the Downloads folder;
  // a phone has no such folder that another app can reach, so the file is
  // written to the app's cache and handed to the system share sheet, which is
  // where "save to Files", "send to Gaia", "mail it to myself" all live. The
  // BYTES are identical — same routeToGpx, same gpxFilename — and only the
  // delivery differs, because the two platforms deliver files differently.
  //
  // The cache directory, not documents: this file exists to be handed to
  // another app, and once it has been the phone is free to reclaim it. Writing
  // it to documents would accumulate a copy of every route ever exported in
  // storage the user cannot see.
  const handleExport = async (route: SavedRoute) => {
    setActionError(null);
    try {
      if (route.route.length === 0) return;
      const gpx = routeToGpx(route.route, {
        name: route.name,
        description: route.description,
      });
      const file = new File(Paths.cache, gpxFilename(route.name));
      // Overwrite rather than fail: exporting the same route twice is a normal
      // thing to do, and the second attempt should not be the one that breaks.
      file.create({ overwrite: true });
      file.write(gpx);
      if (!(await Sharing.isAvailableAsync())) {
        setActionError(
          t(
            'Deling er ikke tilgjengelig på denne enheten.',
            'Sharing is not available on this device.',
          ),
        );
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/gpx+xml',
        // The Android chooser's title and the iOS sheet's subject line.
        dialogTitle: t('Eksporter som GPX', 'Export as GPX'),
        UTI: 'com.topografix.gpx',
      });
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : t('Kunne ikke eksportere ruta', 'Could not export the route'),
      );
    }
  };

  /** `onBack` on the web is always "go to the overview". Here the list is
   *  usually a push on top of it, so unwinding the stack is the truthful
   *  gesture; navigating is the fallback for a deep link that arrived with no
   *  stack under it. */
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.navigate('/');
  };

  const count = state.status === 'ready' ? state.routes.length : null;

  return (
    <View style={styles.page}>
      <PhotoBackdrop photo={photo} scrim={LIST_SCRIM} />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          // The web's `.page` is `position: fixed; inset: 0`, so its padding is
          // measured from the screen edge. The phone's screen edge has a notch
          // and a home indicator in it, which is what these add.
          {
            paddingTop: insets.top + space.s4,
            paddingBottom: insets.bottom + space.s8,
          },
        ]}
        alwaysBounceVertical={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.accent}
          />
        }
      >
        {/* `.topBar`: the back pill on the left, the brand centred. Centred
            ABSOLUTELY, not by a spacer, because that is what the web does below
            640px — `.brand { position: absolute; left: 50%; transform:
            translateX(-50%) }` — and it is what keeps the mark on the screen's
            centre line rather than on the centre of what is left after the
            pill. */}
        <View style={styles.topBar}>
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [
              styles.backBtn,
              pressed && styles.backBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('Tilbake til oversikt', 'Back to overview')}
          >
            <ArrowLeftIcon color={colors.text} size={16} />
            <Text style={styles.backBtnText}>{t('Oversikt', 'Overview')}</Text>
          </Pressable>
          <View style={styles.brand} pointerEvents="none">
            <View style={styles.brandIcon}>
              <MountainIcon color={colors.accentContrast} size={18} />
            </View>
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <View style={styles.panelIcon}>
              <BookmarkIcon color={colors.accentContrast} size={22} />
            </View>
            <View style={styles.panelHeading}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>
                  {t('Lagrede ruter', 'Saved routes')}
                </Text>
                <View style={styles.countPill}>
                  <Text style={styles.countPillText}>
                    {count === null ? '…' : String(count)}
                  </Text>
                </View>
              </View>
              <Text style={styles.intro}>
                {t(
                  'Rutebiblioteket ditt. Åpne en tur for å se på eller finpusse den.',
                  'Your route library. Open a tour to review or refine it.',
                )}
              </Text>
            </View>
          </View>

          {state.status === 'loading' && (
            <View style={styles.empty}>
              {/* The web's `.spinner` is a 28px ring with one teal quadrant,
                  animated by `@keyframes`. This is the platform's own
                  indeterminate spinner in the same colour: an Animated.loop
                  driving a rotate transform would reproduce the ring exactly and
                  would still be the wrong answer, because a native spinner is
                  what a phone user reads as "working" without looking at it. */}
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.emptyTitle}>
                {t(
                  'Laster de lagrede rutene dine …',
                  'Loading your saved routes…',
                )}
              </Text>
            </View>
          )}

          {state.status === 'error' && (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {t('Kunne ikke hente turene', 'Could not load your routes')}
              </Text>
              <Text style={styles.emptyText}>{state.message}</Text>
              <Pressable
                onPress={retry}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && styles.primaryBtnPressed,
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.primaryBtnText}>
                  {t('Prøv igjen', 'Try again')}
                </Text>
              </Pressable>
            </View>
          )}

          {state.status === 'ready' && state.routes.length === 0 && (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <RouteIcon color={colors.textFaint} size={24} />
              </View>
              <Text style={styles.emptyTitle}>
                {t('Ingen lagrede ruter ennå', 'No saved routes yet')}
              </Text>
              <Text style={styles.emptyText}>
                {t(
                  'Ruter du planlegger og lagrer, vises her – klare til å ses over før du drar ut.',
                  'Routes you plan and save will appear here, ready to revisit before heading out.',
                )}
              </Text>
              <Pressable
                onPress={() => router.navigate('/planner')}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && styles.primaryBtnPressed,
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.primaryBtnText}>
                  {t('Planlegg en ny rute', 'Plan a new route')}
                </Text>
              </Pressable>
            </View>
          )}

          {state.status === 'ready' && state.routes.length > 0 && (
            <View>
              {actionError !== null && (
                <Text style={styles.listError} accessibilityRole="alert">
                  {actionError}
                </Text>
              )}
              <View style={styles.list}>
                {state.routes.map((route) => (
                  <RouteItem
                    key={route.id}
                    route={route}
                    shareUrl={publicShareUrl({
                      // One Cloudflare Worker serves both the site and the API,
                      // so the host every request goes to is also the host a
                      // public link lives on. The web passes
                      // `window.location.origin` here for the same reason —
                      // same origin, spelled the way each platform can spell it.
                      origin: API_BASE,
                      kind: 'r',
                      isShared: route.isShared,
                      slug: route.shareSlug,
                      username,
                    })}
                    sharing={sharingId === route.id}
                    copied={copiedId === route.id}
                    confirming={confirmId === route.id}
                    deleting={deletingId === route.id}
                    onOpen={() =>
                      router.navigate({
                        pathname: '/route/[id]',
                        params: { id: route.id },
                      })
                    }
                    onToggleShare={() =>
                      void handleToggleShare(route.id, !route.isShared)
                    }
                    onCopyLink={(url) => void handleCopyLink(route.id, url)}
                    onExport={() => void handleExport(route)}
                    onArmDelete={() => setConfirmId(route.id)}
                    onCancelDelete={() => setConfirmId(null)}
                    onConfirmDelete={() => void handleDelete(route.id)}
                  />
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

type ItemProps = {
  route: SavedRoute;
  shareUrl: string | undefined;
  sharing: boolean;
  copied: boolean;
  confirming: boolean;
  deleting: boolean;
  onOpen: () => void;
  onToggleShare: () => void;
  onCopyLink: (url: string) => void;
  onExport: () => void;
  onArmDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
};

/** One `<li className={styles.item}>`: the route card, then the export and
 *  delete buttons alongside it. */
function RouteItem({
  route,
  shareUrl,
  sharing,
  copied,
  confirming,
  deleting,
  onOpen,
  onToggleShare,
  onCopyLink,
  onExport,
  onArmDelete,
  onCancelDelete,
  onConfirmDelete,
}: ItemProps) {
  const t = useT();

  // A row whose geometry failed to parse still lists — core's parseRow returns
  // an empty route rather than throwing — but it cannot be opened on a map, so
  // say so instead of navigating to a blank one.
  const points = route.route.reduce((n, seg) => n + seg.length, 0);
  const openable = points > 1;

  const meta = [
    formatDistance(route.distanceM),
    `${formatAscent(route.ascentM)} ${t('stigning', 'ascent')}`,
    route.descentM !== null
      ? `${formatAscent(route.descentM)} ${t('nedstigning', 'descent')}`
      : null,
    // formatDate goes through toLocaleDateString with a BCP 47 tag, which needs
    // Intl. Hermes has it (backed by the platform's ICU on Android, the system
    // on iOS) so this matches the web's output — but it is the one formatter
    // here that could differ per device, so if a date ever renders as an ISO
    // string this is why.
    formatDate(route.updatedAt),
  ]
    // The formatters return '—' for unknown rather than an empty string, which
    // is right in a table but reads as noise in a one-line summary ('—  ·  —
    // ·  12 Mar 2026'). Dropped here rather than changed in core, where the web
    // app depends on the placeholder.
    .filter((part): part is string => part !== null && !part.startsWith('—'))
    .join('  ·  ');

  return (
    <View style={styles.item}>
      <View style={styles.routeCard}>
        <View style={styles.shareRow}>
          <Pressable
            onPress={onToggleShare}
            disabled={sharing}
            style={({ pressed }) => [
              styles.visToggle,
              pressed && styles.washPressed,
              sharing && styles.dimmed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: route.isShared, disabled: sharing }}
            accessibilityLabel={
              route.isShared
                ? t(
                    `${route.name} er offentlig; gjør privat`,
                    `${route.name} is public; make private`,
                  )
                : t(
                    `${route.name} er privat; gjør offentlig`,
                    `${route.name} is private; make public`,
                  )
            }
          >
            {route.isShared ? (
              <GlobeIcon color={colors.accent} size={16} />
            ) : (
              <LockIcon color={colors.textMuted} size={16} />
            )}
            <Text
              style={[styles.visLabel, route.isShared && styles.visLabelPublic]}
            >
              {route.isShared ? t('Offentlig', 'Public') : t('Privat', 'Private')}
            </Text>
          </Pressable>

          {route.isShared && shareUrl !== undefined && (
            <Pressable
              onPress={() => onCopyLink(shareUrl)}
              style={({ pressed }) => [
                styles.copyLinkBtn,
                pressed && styles.washPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t(
                `Kopier offentlig lenke til ${route.name}`,
                `Copy public link to ${route.name}`,
              )}
            >
              {copied ? (
                <CircleCheckIcon color={colors.copied} size={16} />
              ) : (
                <LinkIcon color={colors.textMuted} size={16} />
              )}
              <Text
                style={[styles.copyLinkText, copied && styles.copyLinkTextCopied]}
              >
                {copied ? t('Kopiert', 'Copied') : t('Kopier lenke', 'Copy link')}
              </Text>
            </Pressable>
          )}
        </View>

        {/* `.row.rowAttached`. A STYLED Pressable, so it navigates itself rather
            than sitting inside a <Link asChild>: expo-router renders that
            through a Slot that merges `style` by spreading the object, and a
            Pressable's style is a FUNCTION of the pressed state — spread, it
            becomes `{}` and the row loses every rule it has. See the same note
            in app/index.tsx. */}
        <Pressable
          onPress={openable ? onOpen : undefined}
          disabled={!openable}
          style={({ pressed }) => [
            styles.row,
            pressed && openable && styles.rowPressed,
            !openable && styles.dimmed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={route.name}
        >
          <RouteThumbnail route={route.route} />
          <View style={styles.rowBody}>
            <Text style={styles.rowName} numberOfLines={1}>
              {route.name}
            </Text>
            <Text style={styles.rowMeta}>{meta}</Text>
            {route.description !== null && route.description.length > 0 && (
              <Text style={styles.rowNotes} numberOfLines={2}>
                {route.description}
              </Text>
            )}
            {!openable && (
              <Text style={styles.rowWarning}>
                {t('Kan ikke vises på kart', 'Cannot be shown on a map')}
              </Text>
            )}
          </View>
        </Pressable>
      </View>

      <Pressable
        onPress={onExport}
        style={({ pressed }) => [
          styles.squareBtn,
          pressed && styles.exportBtnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={t(
          `Eksporter ${route.name} som GPX`,
          `Export ${route.name} as GPX`,
        )}
      >
        <DownloadIcon color={colors.textFaint} size={18} />
      </Pressable>

      {confirming ? (
        <View style={styles.confirm}>
          <Pressable
            onPress={onConfirmDelete}
            disabled={deleting}
            style={({ pressed }) => [
              styles.confirmDelete,
              pressed && styles.confirmDeletePressed,
              deleting && styles.dimmed,
            ]}
            accessibilityRole="button"
          >
            <Text style={styles.confirmDeleteText}>
              {deleting ? t('Sletter …', 'Deleting…') : t('Slett', 'Delete')}
            </Text>
          </Pressable>
          <Pressable
            onPress={onCancelDelete}
            disabled={deleting}
            style={({ pressed }) => [
              styles.confirmCancel,
              pressed && styles.washPressed,
              deleting && styles.dimmed,
            ]}
            accessibilityRole="button"
          >
            <Text style={styles.confirmCancelText}>
              {t('Avbryt', 'Cancel')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={onArmDelete}
          style={({ pressed }) => [
            styles.squareBtn,
            pressed && styles.deleteBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t(`Slett ${route.name}`, `Delete ${route.name}`)}
        >
          <TrashIcon color={colors.textFaint} size={18} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.photoFallback },

  content: {
    // `.page`'s `clamp(20px, 3.5vw, 48px)` bottoms out at 20 on any phone, and
    // `--space-6` is 24 — near enough that inventing a 20 to be exact would be
    // adding a number outside the scale to win a rounding argument.
    paddingHorizontal: space.s6,
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    minHeight: TOUCH_TARGET,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    paddingVertical: 7,
    paddingLeft: space.s3,
    paddingRight: space.s4,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radius.pill,
    ...shadow.level1,
  },
  backBtnPressed: { backgroundColor: colors.surface3 },
  backBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  brand: {
    position: 'absolute',
    left: '50%',
    // The web's `translateX(-50%)` of an element it has not measured. React
    // Native's percentage translate resolves against the element's own width,
    // so this is the same rule and not an estimate of it.
    transform: [{ translateX: '-50%' }],
  },
  brandIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    ...shadow.level2,
  },

  panel: {
    // `.content` is `flex: 1; justify-content: center`, which on a phone the
    // panel overflows anyway — at which point the web's centring also collapses
    // to "start". So: the web's own `padding-block` as a fixed gap.
    marginTop: space.s6,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    // `--space-6`, not `--space-8`: the @media rule at 640px.
    padding: space.s6,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radius.lg,
    ...shadow.float,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s4,
    paddingBottom: space.s6,
    marginBottom: space.s6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  panelIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    ...shadow.level1,
  },
  panelHeading: { flex: 1, gap: space.s1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    // `-0.02em` at 26px. RN's letterSpacing has no em unit, so it is multiplied
    // out here, the same way the hub's eyebrow does it.
    letterSpacing: fontSize.xl * -0.02,
    color: colors.text,
  },
  countPill: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    backgroundColor: colors.iconTile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radius.pill,
  },
  countPillText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textMuted,
  },
  intro: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * 1.5,
    color: colors.textMuted,
  },

  list: { gap: space.s2 },
  item: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space.s2,
  },
  routeCard: {
    flex: 1,
    backgroundColor: colors.routeCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    // `.routeCard` is `overflow: hidden` so the share row's top corners follow
    // the card's. Nothing here casts a shadow, so there is none to clip.
    overflow: 'hidden',
  },

  shareRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  visToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingVertical: space.s2,
    paddingHorizontal: space.s4,
  },
  visLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text,
  },
  visLabelPublic: { color: colors.accent },
  copyLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    paddingHorizontal: space.s4,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.hairline,
  },
  copyLinkText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
  },
  copyLinkTextCopied: { color: colors.copied },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    padding: space.s4,
  },
  // `.rowAttached:hover` slides a 3px accent bar in from the left edge. A
  // finger has no hover, so what it gets is the wash every other pressable in
  // the app uses — the same trade the hub's cards made when their chevron went.
  rowPressed: { backgroundColor: colors.surface3 },
  rowBody: { flex: 1, gap: 3 },
  rowName: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.text,
  },
  rowMeta: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  rowNotes: {
    fontSize: fontSize.sm,
    color: colors.textFaint,
  },
  rowWarning: { fontSize: fontSize.xs, color: colors.danger },

  // `.deleteBtn` and `.exportBtn` are the same rule but for their hover colour,
  // so they are one style plus two pressed states.
  squareBtn: {
    width: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.routeCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radius.md,
  },
  exportBtnPressed: { backgroundColor: colors.accentWashStrong },
  deleteBtnPressed: { backgroundColor: colors.dangerSurface },

  confirm: { flexDirection: 'row', gap: space.s2 },
  confirmDelete: {
    justifyContent: 'center',
    paddingHorizontal: space.s3,
    backgroundColor: colors.dangerDeep,
    borderRadius: radius.md,
  },
  confirmDeletePressed: { backgroundColor: colors.danger },
  confirmDeleteText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.onDanger,
  },
  confirmCancel: {
    justifyContent: 'center',
    paddingHorizontal: space.s3,
    backgroundColor: colors.routeCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radius.md,
  },
  confirmCancelText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
  },

  /** `.visToggle:disabled` / `.confirmDelete:disabled`, and the inert row. */
  dimmed: { opacity: 0.6 },
  /** `.visToggle:hover` / `.copyLinkBtn:hover`, as a pressed state. */
  washPressed: { backgroundColor: colors.accentWashStrong },

  listError: {
    marginBottom: space.s3,
    fontSize: fontSize.sm,
    color: colors.dangerDeep,
  },

  empty: {
    alignItems: 'center',
    paddingVertical: space.s8,
    paddingHorizontal: space.s6,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    backgroundColor: colors.emptyTile,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    // `1px dashed`. Android's renderer draws a dashed border solid once the
    // corner radius is non-zero, so on that platform this is a thin ring rather
    // than a dotted one. Kept because the fallback is the right shape in the
    // right colour and the alternative — an SVG circle with a dash array, for
    // an icon that appears only when the library is empty — is a component to
    // maintain for a state most users see once.
    borderStyle: 'dashed',
  },
  emptyTitle: {
    marginTop: space.s4,
    fontSize: fontSize.lg,
    fontWeight: '700',
    letterSpacing: fontSize.lg * -0.01,
    color: colors.text,
    textAlign: 'center',
  },
  emptyText: {
    marginTop: space.s2,
    // `max-width: 40ch`, in points at this size — the measure the web is after,
    // which is the line length rather than the number.
    maxWidth: 320,
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * 1.55,
    color: colors.textMuted,
    textAlign: 'center',
  },
  primaryBtn: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: space.s6,
    marginTop: space.s6,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    ...shadow.level1,
  },
  primaryBtnPressed: { backgroundColor: colors.accentPressed },
  primaryBtnText: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.accentContrast,
  },
});
