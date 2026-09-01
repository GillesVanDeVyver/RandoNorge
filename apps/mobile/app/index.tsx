// The account hub — the phone's `/`, and apps/web's AccountOverview.
//
// WHY THIS SCREEN EXISTS RATHER THAN THE SAVED LIST. The web's signed-in root is
// a hub: a greeting, then action cards, one of which opens the route library at
// `/saved`. The phone's root was the library itself, which meant the two clients
// did not agree on what a signed-in session opens onto, and the phone had no
// place to put an action that is not about one route.
//
// THIS FILE USED TO CARRY A LIST OF WHAT IT WAS NOT PORTING, and the list was
// most of what the screen looks like: the season photograph and its scrim ("a
// bigger decision than this phase"), the icon tiles ("react-native-svg is not a
// dependency"), and the feedback card ("no client for /api/feedback is in
// packages/core"). Every one of those was true when it was written and none of
// them is true now — react-native-svg arrived with the elevation profile, the
// four photographs are committed under assets/overview, and the feedback client
// moved to @fjellrute/core/feedback/api with apps/web switched to it in the same
// change. So the hub is the web's hub: full-bleed photo, Alpine Glass cards,
// white type over a scrim.
//
// WHAT IS STILL NOT HERE, and why it is a shorter list than a smaller one:
//
//   - The offline maps card. It reports `useOfflineRegions().length` from
//     IndexedDB, and the phone has no offline store at all. A fourth tile
//     showing a count it cannot compute would be worse than three honest ones.
//   - The completed count. The web reads it from `listTracks()` in
//     apps/web/src/tracking/api.ts, which is not in packages/core. Moving that
//     client across is the correct fix and belongs to whichever phase actually
//     renders completed tours; doing it here would be migrating logic to
//     satisfy a number on a card.
//   - The photo credit. Not an omission — `.credit` is `display: none` below
//     900px in AccountOverview.module.css, so a phone with no credit line IS
//     the web at this width. The photographer still travels with the photo in
//     src/ui/season.ts, so the day a phone screen has room for it, it is there.
//   - The `/summer`-style seasonal override. See the note in src/ui/season.ts:
//     it is a URL a developer types, and a phone has no address bar.
//
// WHAT IS SHARED: `listRoutes` for the saved count, `sendFeedback` and
// `seasonFromDate` for the two things this screen adds, and the i18n store. As
// everywhere else on the phone, nothing here computes anything.

import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setStatusBarStyle } from 'expo-status-bar';
import { useT } from '@fjellrute/core/i18n';
import { listRoutes } from '@fjellrute/core/routes/api';
import { authClient } from '../src/auth/client';
import { AccountChip } from '../src/ui/AccountChip';
import { FeedbackDialog } from '../src/ui/FeedbackDialog';
import { PhotoBackdrop } from '../src/ui/PhotoBackdrop';
import { overviewPhoto } from '../src/ui/season';
import {
  ArrowRightIcon,
  BookmarkIcon,
  CircleCheckIcon,
  MessageIcon,
  MountainIcon,
  RouteIcon,
} from '../src/ui/icons';
import {
  colors,
  fontSize,
  onPhotoShadow,
  radius,
  shadow,
  space,
} from '../src/ui/theme';

export default function OverviewScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { data: session } = authClient.useSession();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // NULL MEANS "NOT KNOWN YET", NOT ZERO, and the distinction is the reason
  // this is not just a number. A count that starts at 0 shows every user "0
  // saved routes" for as long as the request takes, which is the one moment
  // someone with a full library is most likely to be looking. The web's
  // AccountOverview takes the same care with the same comment on its props.
  //
  // A FAILED request also leaves this null rather than setting an error state.
  // The hub is not the place to explain a failure it cannot act on: the card
  // still navigates, and /saved will report the same failure properly, with the
  // retry button and the which-backend hint that screen already has.
  const [savedCount, setSavedCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const routes = await listRoutes();
        // Signing out unmounts this screen while the request may still be open.
        if (!cancelled) setSavedCount(routes.length);
      } catch {
        // Deliberately silent — see above.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // LIGHT STATUS BAR, AND WHY IT IS IMPERATIVE. Every other screen is cream, so
  // _layout.tsx sets `style="dark"` once for the app; this one is a dark
  // photograph, and dark-on-dark makes the clock and the battery unreadable.
  // Rendering a second <StatusBar style="light"> here would not do it: this
  // screen stays MOUNTED underneath /saved and /planner in the stack, so
  // nothing would ever set it back. Focus is the actual condition, so it is
  // what the effect keys on.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );

  // `name` is optional on a Better Auth user and the alpha does not require it,
  // so the email is the fallback — exactly as Root.tsx does it on the web. The
  // greeting has to name somebody; "Welcome back, undefined" is the failure
  // mode being avoided here.
  const email = session?.user.email ?? '';
  const who = session?.user.name?.trim() || email;

  const photo = overviewPhoto();

  return (
    <View style={styles.page}>
      <PhotoBackdrop photo={photo.src} />

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
      >
        {/* The web's `.brand` header, plus the account chip that on the web is
            `position: fixed` in the same corner. One row here rather than two
            layers, because a phone has no viewport to pin something to that is
            not also the top of the scrolling content. */}
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.brandIcon}>
              <MountainIcon color={colors.accentContrast} size={20} />
            </View>
            <Text style={styles.brandName}>Fjellrute</Text>
          </View>
          <AccountChip name={who} email={email} />
        </View>

        <View style={styles.main}>
          <Text style={styles.eyebrow}>
            {t('KONTOOVERSIKT', 'ACCOUNT OVERVIEW')}
          </Text>
          <Text style={styles.greeting}>
            {t('Velkommen tilbake', 'Welcome back')}
            {who === '' ? '' : `, ${who}`}
            <Text style={styles.greetingDot}>.</Text>
          </Text>
          <Text style={styles.subtitle}>
            {t('Hvor går turen nå?', 'Where to next?')}
          </Text>

          <View style={styles.grid}>
            {/* Primary action, and first for the same reason it is first on the
                web below 900px, where `.cardPrimary` takes `order: -1`: in one
                column the main action reads best at the top. */}
            <ActionCard
              href="/planner"
              primary
              Icon={RouteIcon}
              title={t('Planlegg ny rute', 'Plan new route')}
              text={t(
                'Tegn en tur og utforsk terreng, snø- og skredinformasjon langs ruta.',
                'Draw a tour and explore the terrain, snow and avalanche information along your route.',
              )}
            />

            <ActionCard
              href="/saved"
              Icon={BookmarkIcon}
              count={savedCount}
              loadingLabel={t(
                'Laster lagrede ruter …',
                'Loading your saved routes…',
              )}
              title={
                savedCount === 1
                  ? t('Lagret rute', 'Saved route')
                  : t('Lagrede ruter', 'Saved routes')
              }
              text={t(
                'Rutebiblioteket ditt — se igjen, gjennomgå og finjustér planlagte turer.',
                'Your route library — revisit, review and refine planned tours.',
              )}
            />

            {/* No count — see the note at the top of the file. */}
            <ActionCard
              href="/completed"
              Icon={CircleCheckIcon}
              title={t('Fullførte ruter', 'Completed routes')}
              text={t(
                'Turer du har fullført — din personlige toppbok.',
                'Tours you have completed — your personal summit log.',
              )}
            />
          </View>

          {/* The web's `.feedbackCard`: same glass as the grid above, but one
              wide row (icon | text | arrow) rather than a tall tile, so the
              action is impossible to miss without competing with "plan new
              route" — the only element on this screen carrying the accent
              fill. */}
          <Pressable
            onPress={() => setFeedbackOpen(true)}
            style={({ pressed }) => [
              styles.feedbackCard,
              pressed && styles.cardPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('Send tilbakemelding', 'Send feedback')}
          >
            <View style={styles.feedbackIcon}>
              <MessageIcon color={colors.text} size={20} />
            </View>
            <View style={styles.feedbackBody}>
              <Text style={styles.feedbackTitle}>
                {t('Send tilbakemelding', 'Send feedback')}
              </Text>
              <Text style={styles.cardText}>
                {t(
                  'Fant du en feil, eller mangler det noe? Skriv til oss uten å forlate appen — alt blir lest.',
                  'Found a bug, or is something missing? Write to us without leaving the app — everything is read.',
                )}
              </Text>
            </View>
            <Arrow />
          </Pressable>
        </View>
      </ScrollView>

      {feedbackOpen && (
        <FeedbackDialog
          accountEmail={email}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
    </View>
  );
}

/** The icons take a required colour and an optional size — see the note at the
 *  top of src/ui/icons.tsx about why there is no `currentColor` to inherit. */
type IconComponent = ComponentType<{ color: string; size?: number }>;

type ActionCardProps = {
  /** An app route. Typed loosely on purpose: expo-router's generated `Href`
   *  union does not include a route until its file exists, and the two stubs
   *  this hub links to are created alongside it. */
  href: string;
  Icon: IconComponent;
  title: string;
  text: string;
  /** Carries the accent tile and the teal wash. One card per screen. */
  primary?: boolean;
  /** A figure to show beside the title. `null` while it is still being fetched,
   *  `undefined` when the card has no count at all — see the note on the
   *  completed card, where the difference is the whole point. */
  count?: number | null;
  loadingLabel?: string;
};

function ActionCard({
  href,
  Icon,
  title,
  text,
  primary = false,
  count,
  loadingLabel,
}: ActionCardProps) {
  const hasCount = count !== undefined;

  return (
    // `asChild` so the Pressable IS the link rather than sitting inside one:
    // nesting them gives the card two overlapping touch targets, and the outer
    // one wins on Android.
    <Link href={href as never} asChild>
      <Pressable
        style={({ pressed }) => [
          styles.card,
          primary && styles.cardPrimary,
          pressed && styles.cardPressed,
        ]}
        accessibilityRole="link"
        // The count is read out as part of the label rather than left to be
        // discovered as a separate line, so the card announces "3 saved routes"
        // the way it reads.
        accessibilityLabel={
          hasCount && count !== null ? `${count} ${title}` : title
        }
      >
        {/* The web's `.cardPrimary` background is a 160° teal gradient LAYERED
            over `--surface-2`, so the wash is its own layer here too rather
            than a hand-mixed opaque colour — the numbers below stay the
            stylesheet's. It is flat where the web's ramps from 0.20 to 0.05:
            across a 330pt card that ramp reads as one pale mint tint either
            way, and unlike PhotoBackdrop's scrim — which spans the screen and
            is what keeps the headline legible — nothing depends on it. */}
        {primary && <View style={styles.cardWash} />}

        <View style={[styles.cardIcon, primary && styles.cardIconPrimary]}>
          <Icon
            color={primary ? colors.accentContrast : colors.text}
            size={22}
          />
        </View>

        <View style={styles.cardBody}>
          {hasCount &&
            (count === null ? (
              <Text style={styles.cardTitle}>{loadingLabel}</Text>
            ) : (
              // `.cardStat`: count and label on one baseline, "12  Saved
              // routes". A row of two Texts rather than one string, because the
              // two are different sizes and weights.
              <View style={styles.cardStat}>
                <Text style={styles.cardCount}>{count}</Text>
                <Text style={styles.cardTitle}>{title}</Text>
              </View>
            ))}
          {!hasCount && <Text style={styles.cardTitle}>{title}</Text>}
          <Text style={styles.cardText}>{text}</Text>
        </View>

        <Arrow primary={primary} />
      </Pressable>
    </Link>
  );
}

/** The bottom-right affordance arrow. `.cardArrow` is `--text-3`, and
 *  `.cardPrimary .cardArrow` steps up to `--text-2` so it does not vanish into
 *  the teal wash. Decorative: the card's own accessibility label already says
 *  where it goes, and an arrow announced after it is noise. */
function Arrow({ primary = false }: { primary?: boolean }) {
  return (
    <View
      style={styles.cardArrow}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <ArrowRightIcon
        color={primary ? colors.textMuted : colors.textFaint}
        size={18}
      />
    </View>
  );
}

/**
 * Shared by the two stub screens, so `/planner` and `/completed` look like
 * deliberate placeholders rather than broken pages.
 *
 * Exported from this file because it is the hub's own idea of what an unbuilt
 * destination looks like, and because two stubs are not enough to justify a
 * third file. When either becomes real, its use of this goes away with it.
 *
 * NOTE that it stays on the cream canvas while the hub above has moved onto the
 * photograph. That is not an oversight: the stubs are pushed onto the stack and
 * keep the navigation header, and the web has no photo behind its inner pages
 * either — only the login page and this hub are full-bleed.
 */
export function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.stub}>
      <Text style={styles.stubTitle}>{title}</Text>
      <Text style={styles.stubText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: {
    // `clamp(20px, 3.5vw, 48px)` bottoms out at 20 on any phone. 24 is the
    // nearest step on the scale, and the file's own rule is that a value off
    // the scale needs a reason — a 4pt gutter difference is not one.
    paddingHorizontal: space.s6,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s4,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
  },
  brandIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    ...shadow.level2,
  },
  brandName: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: colors.onPhoto,
    ...onPhotoShadow(8, 0.45),
  },

  main: {
    // `.content` is `flex: 1; justify-content: center` on the web. Vertically
    // centring inside a ScrollView means measuring it, and on a phone the four
    // cards overflow the screen anyway — at which point the web's centring also
    // collapses to "start". So: a fixed gap under the brand instead.
    marginTop: space.s8,
    alignItems: 'center',
  },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.accent,
    // `text-transform: uppercase` has no React Native equivalent, so the
    // strings themselves are uppercase above. 0.16em of the web's tracking at
    // 11px, stated in points because RN's letterSpacing has no em unit.
    letterSpacing: 11 * 0.16,
    textAlign: 'center',
    ...onPhotoShadow(8, 0.6),
  },
  greeting: {
    marginTop: space.s3,
    // The web clamps this between 34px and 56px, both past the top of the type
    // scale — a display size, sized to the viewport. `xl` (26) is the largest
    // step the scale has, and inventing a 34 here would reopen exactly the
    // "font sizes: none — inline per screen" problem an earlier commit closed.
    // A phone is also not a 56px-headline-shaped surface.
    fontSize: fontSize.xl,
    fontWeight: '800',
    letterSpacing: -0.8,
    lineHeight: 32,
    color: colors.onPhoto,
    textAlign: 'center',
    ...onPhotoShadow(24, 0.45, 2),
  },
  greetingDot: { color: colors.accent },
  subtitle: {
    marginTop: space.s4,
    fontSize: fontSize.base,
    lineHeight: 23,
    color: colors.onPhotoMuted,
    textAlign: 'center',
    ...onPhotoShadow(12, 0.5),
  },

  grid: {
    // ONE COLUMN, which is what the web itself does below 900px — see the media
    // query at the foot of AccountOverview.module.css. The 460px cap comes from
    // the same block, and matters on a tablet.
    width: '100%',
    maxWidth: 460,
    marginTop: space.s8,
    gap: space.s4,
  },
  card: {
    // COLUMN, not the row this screen used to draw: icon tile, then the text,
    // then the arrow in the bottom-right corner. That is `.card`'s own
    // `flex-direction: column; align-items: flex-start`, and it is the single
    // biggest reason the two clients did not look alike.
    alignItems: 'flex-start',
    gap: space.s4,
    padding: space.s6,
    // No `min-height: 220px`: the same media query sets it to 0, because a
    // fixed-height tile in one column is a lot of empty card.
    backgroundColor: colors.glass,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    ...shadow.float,
  },
  // The web has no pressed state — it has `:hover` and a 1px `:active` lift,
  // neither of which a finger can produce. A wash is what every other pressable
  // surface on the phone does.
  cardPressed: { backgroundColor: colors.surface3 },
  cardPrimary: { borderColor: colors.accentRing },
  cardWash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.accentWash,
    // The wash rounds itself rather than the card clipping it. `overflow:
    // 'hidden'` on the card would do the same job and would also set
    // `masksToBounds` on iOS, which clips the card's own drop shadow — the one
    // thing lifting these cards off the photograph.
    borderRadius: radius.lg,
  },
  cardIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.iconTile,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardIconPrimary: {
    backgroundColor: colors.accent,
    borderColor: 'transparent',
    ...shadow.level1,
  },
  cardBody: { gap: space.s2 },
  cardStat: {
    flexDirection: 'row',
    // `align-items: baseline` — RN supports it, and it is what keeps a 26pt
    // figure sitting on the same line as a 20pt label rather than centred
    // against it.
    alignItems: 'baseline',
    gap: space.s2,
  },
  cardCount: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: colors.text,
  },
  cardTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: colors.text,
  },
  cardText: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    color: colors.textMuted,
  },
  cardArrow: { alignSelf: 'flex-end' },

  feedbackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    width: '100%',
    maxWidth: 460,
    marginTop: space.s4,
    paddingVertical: space.s4,
    paddingHorizontal: space.s6,
    backgroundColor: colors.glass,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    ...shadow.float,
  },
  feedbackIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.iconTile,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
  },
  feedbackBody: { flex: 1, gap: space.s1 },
  feedbackTitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: colors.text,
  },

  stub: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.s6,
    gap: space.s3,
    backgroundColor: colors.background,
  },
  stubTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  stubText: {
    fontSize: fontSize.sm,
    lineHeight: 21,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 320,
  },
});
