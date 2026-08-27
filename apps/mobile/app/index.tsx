// The account hub — the phone's `/`, and apps/web's AccountOverview.
//
// WHY THIS SCREEN EXISTS RATHER THAN THE SAVED LIST. The web's signed-in root is
// a hub: a greeting, then action cards, one of which opens the route library at
// `/saved`. The phone's root was the library itself, which meant the two clients
// did not agree on what a signed-in session opens onto, and the phone had no
// place to put an action that is not about one route. Adding the hub is what
// makes the rest of the information architecture nameable — `/planner` and
// `/completed` are stubs today, but they are stubs with somewhere to be linked
// FROM, which is the difference between a shell and a retrofit.
//
// WHAT IS DELIBERATELY NOT PORTED FROM AccountOverview.tsx, since it is the
// larger half of that file:
//
//   - The season photo and its scrim. `OVERVIEW_PHOTOS` is four image assets in
//     apps/web, and the whole "Alpine Glass" treatment — white text over a
//     full-bleed photograph — depends on them. Copying image binaries into
//     apps/mobile to reproduce a background is a bigger decision than this
//     phase, so the hub is the same composition on the cream canvas instead,
//     with the palette doing the work the photograph does on the web.
//   - The icon tiles. The web's are SVGs from components/icons; React Native
//     cannot render them without react-native-svg, which is not a dependency
//     until Phase 2 needs it for the elevation profile. Cards carry a `→`
//     instead, which is a character rather than an invented icon.
//   - The offline maps card. It reports `useOfflineRegions().length`, and the
//     phone has no offline store — that is Phase 5. A fourth card showing a
//     count it cannot compute would be worse than three honest ones.
//   - The feedback card. It posts to /api/feedback, and no client for that is
//     in packages/core. Writing a fetch here would break the rule this plan
//     ends on, and section 4 of the mobile harness fails any `/api/` path
//     written inside the app, which is that rule with teeth.
//
// WHAT IS SHARED: `listRoutes` for the saved count, and the i18n store. As
// everywhere else on the phone, nothing here computes anything.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useT } from '@fjellrute/core/i18n';
import { listRoutes } from '@fjellrute/core/routes/api';
import { authClient } from '../src/auth/client';
import { LanguageSwitcher } from '../src/ui/LanguageSwitcher';
import {
  colors,
  fontSize,
  radius,
  shadow,
  space,
  TOUCH_TARGET,
} from '../src/ui/theme';

export default function OverviewScreen() {
  const t = useT();
  const { data: session } = authClient.useSession();

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

  const signOut = useCallback(() => void authClient.signOut(), []);

  // `name` is optional on a Better Auth user and the alpha does not require it,
  // so the email is the fallback — exactly as Root.tsx does it on the web. The
  // greeting has to name somebody; "Welcome back, undefined" is the failure
  // mode being avoided here.
  const who = session?.user.name?.trim() || session?.user.email || '';

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      // The cards are the point of the screen; let them start under the thumb
      // rather than pinning the greeting to the top of a tall phone.
      alwaysBounceVertical={false}
    >
      <View style={styles.toolbar}>
        <LanguageSwitcher />
        <Pressable
          onPress={signOut}
          style={({ pressed }) => [
            styles.signOut,
            pressed && styles.signOutPressed,
          ]}
          accessibilityRole="button"
        >
          <Text style={styles.signOutText}>{t('Logg ut', 'Sign out')}</Text>
        </Pressable>
      </View>

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
            web: the accent fill makes it unmistakable, and a hub whose main
            action is third in a list is a menu. */}
        <ActionCard
          href="/planner"
          primary
          title={t('Planlegg ny rute', 'Plan new route')}
          text={t(
            'Tegn en tur og utforsk terreng, snø- og skredinformasjon langs ruta.',
            'Draw a tour and explore the terrain, snow and avalanche information along your route.',
          )}
        />

        <ActionCard
          href="/saved"
          count={savedCount}
          loadingLabel={t('Laster lagrede ruter …', 'Loading your saved routes…')}
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

        {/* No count. The web reads one from listTracks(), which lives in
            apps/web/src/tracking/api.ts and NOT in packages/core, so the phone
            has no way to ask. Moving that client into core is the correct fix
            and belongs to whichever phase actually renders completed tours —
            doing it here would be migrating logic to satisfy a number on a
            card. */}
        <ActionCard
          href="/completed"
          title={t('Fullførte ruter', 'Completed routes')}
          text={t(
            'Turer du har fullført — din personlige toppbok.',
            'Tours you have completed — your personal summit log.',
          )}
        />
      </View>
    </ScrollView>
  );
}

type ActionCardProps = {
  /** An app route. Typed loosely on purpose: expo-router's generated `Href`
   *  union does not include a route until its file exists, and the two stubs
   *  this hub links to are created in the same commit as this file. */
  href: string;
  title: string;
  text: string;
  /** Carries the accent fill. One card per screen. */
  primary?: boolean;
  /** A figure to show above the title. `null` while it is still being fetched,
   *  `undefined` when the card has no count at all — see the note on the
   *  completed card, where the difference is the whole point. */
  count?: number | null;
  loadingLabel?: string;
};

function ActionCard({
  href,
  title,
  text,
  primary = false,
  count,
  loadingLabel,
}: ActionCardProps) {
  const hasCount = count !== undefined;

  return (
    // `asChild` so the Pressable IS the link rather than sitting inside one:
    // nesting them gives the row two overlapping touch targets, and the outer
    // one wins on Android.
    <Link href={href as never} asChild>
      <Pressable
        style={({ pressed }) => [
          styles.card,
          primary && styles.cardPrimary,
          pressed && (primary ? styles.cardPrimaryPressed : styles.cardPressed),
        ]}
        accessibilityRole="link"
        // The count is read out as part of the label rather than left to be
        // discovered as a separate line, so the card announces "3 saved routes"
        // the way it reads.
        accessibilityLabel={
          hasCount && count !== null ? `${count} ${title}` : title
        }
      >
        <View style={styles.cardBody}>
          {hasCount &&
            (count === null ? (
              <Text
                style={[styles.cardLoading, primary && styles.cardTextPrimary]}
              >
                {loadingLabel}
              </Text>
            ) : (
              <Text style={styles.cardCount}>{count}</Text>
            ))}
          <Text style={[styles.cardTitle, primary && styles.cardTitlePrimary]}>
            {title}
          </Text>
          <Text style={[styles.cardText, primary && styles.cardTextPrimary]}>
            {text}
          </Text>
        </View>
        <Text
          style={[styles.cardArrow, primary && styles.cardTitlePrimary]}
          // Decorative: the Pressable's own label already says where this goes,
          // and an arrow announced as "right arrow" after it is noise.
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          →
        </Text>
      </Pressable>
    </Link>
  );
}

/**
 * Shared by the two stub screens, so `/planner` and `/completed` look like
 * deliberate placeholders rather than broken pages.
 *
 * Exported from this file because it is the hub's own idea of what an unbuilt
 * destination looks like, and because two stubs are not enough to justify a
 * third file. When either becomes real, its use of this goes away with it.
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
    padding: space.s6,
    paddingBottom: space.s8,
  },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s4,
    marginBottom: space.s8,
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

  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.accent,
    // `text-transform: uppercase` has no React Native equivalent, so the
    // strings themselves are uppercase above. 0.16em of the web's tracking at
    // 11px, stated in points because RN's letterSpacing has no em unit.
    letterSpacing: 11 * 0.16,
  },
  greeting: {
    marginTop: space.s3,
    // The web clamps this between 34px and 56px, both past the top of the type
    // scale — a display size, sized to the viewport. `xl` (26) is the largest
    // step the scale has, and inventing a 34 here would reopen exactly the
    // "font sizes: none — inline per screen" problem the previous commit
    // closed. A phone is also not a 56px-headline-shaped surface.
    fontSize: fontSize.xl,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 32,
    color: colors.text,
  },
  greetingDot: { color: colors.accent },
  subtitle: {
    marginTop: space.s4,
    fontSize: fontSize.base,
    lineHeight: 23,
    color: colors.textMuted,
  },

  grid: {
    // ONE COLUMN, where the web has a 2×2 grid of cards with a 220px minimum
    // height. Two of those side by side on a phone is roughly 160pt wide each,
    // which is narrower than the card's own text wants; the composition the web
    // gets from a square grid, the phone gets from order.
    marginTop: space.s8,
    gap: space.s4,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    padding: space.s6,
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    ...shadow.level1,
  },
  cardPressed: { backgroundColor: colors.surface3 },
  cardPrimary: {
    backgroundColor: colors.accent,
    borderColor: 'transparent',
    ...shadow.level2,
  },
  cardPrimaryPressed: { backgroundColor: colors.accentPressed },
  cardBody: { flex: 1, gap: space.s1 },
  cardCount: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: colors.text,
  },
  cardLoading: { fontSize: fontSize.sm, color: colors.textMuted },
  cardTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: colors.text,
  },
  cardTitlePrimary: { color: colors.accentContrast },
  cardText: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    color: colors.textMuted,
  },
  // Not `accentContrast` at full strength: the body text on the primary card
  // has to sit BELOW its title in the hierarchy, and on a fill there is no
  // lighter ink available, so it steps back with opacity instead.
  cardTextPrimary: { color: colors.accentContrast, opacity: 0.75 },
  cardArrow: {
    fontSize: fontSize.lg,
    color: colors.textFaint,
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
