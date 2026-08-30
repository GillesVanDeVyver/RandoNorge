// The bottom sheet that carries everything the map cannot say.
//
// This is the phone's half of apps/web's SummaryPanel in its `sheet` mode. On a
// wide screen that component is a reading column beside the map; below the web's
// 760px breakpoint it detaches and becomes exactly what is rebuilt here — a
// strip pinned to the bottom of a full-bleed map, collapsed to a grabber and a
// one-line summary, expanded by a tap or an upward swipe into a scrolling stack
// of cards.
//
// EVERY DIMENSION BELOW IS SummaryPanel.module.css:19-42's, and the parity plan
// asked for that specifically ("Match the sheet's real dimensions"). It is not
// fussiness. A user who plans on a laptop and walks with a phone is looking at
// the same product twice, and a peek strip that is 56 tall here and 64 there is
// the kind of difference nobody can name and everybody feels. What could not be
// copied is noted where it happens: the web's `min(62dvh, 560px)` is a viewport
// unit React Native has no equivalent for, so it is measured instead, and the
// blur behind `--surface-3` needs expo-blur, which is not a dependency.
//
// WHY THIS IS NOT react-native-bottom-sheet, or a Reanimated gesture. The
// interaction being reproduced is two states and one transition between them —
// not a draggable sheet that follows the finger and settles on detents. The web
// version is 25 lines of touch handling and a CSS height transition, and the
// faithful port of that is `Animated.timing` on a height. A gesture library
// here would be a third motion system in the app (after MapLibre's own and
// React Navigation's) bought to make the sheet feel *different* from the web's.
// Phase 4 draws on the map and will need real gestures; that is where the
// question gets asked properly.
//
// WHAT IS DELIBERATELY LEFT OUT of the web's panel: the tab bar and its
// scroll-spy, and the pager chevrons. Both exist to move between cards without
// scrolling, on a mouse. The sheet's whole content area on a phone is one
// vertical scroll under a thumb that is already on the glass, and a tab bar
// costs 44 points of the little height there is. The cards keep their headings,
// so the same sections are still findable — by scrolling, which is the gesture
// the surface invites.

import { useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@fjellrute/core/i18n';
import {
  colors,
  duration,
  EASE_BEZIER,
  fontSize,
  radius,
  shadow,
  space,
} from './theme';

/**
 * Height of the collapsed strip: `--sheet-peek`, 64.
 *
 * Exported because the map chrome above the sheet has to clear it — on the web
 * that is App.module.css reading the same custom property, and here it is the
 * route screen's bottom padding and its camera's viewport inset. A second copy
 * of 64 in that file is how the attribution ends up half under the grabber.
 */
export const SHEET_PEEK = 64;

/**
 * How tall the sheet gets when it is open.
 *
 * The web says `min(62dvh, 560px)` and this says the same thing in the only
 * form React Native offers: dvh does not exist here, so the height of the
 * container is measured and the fraction taken of that. Measuring is in fact
 * closer to `dvh` than `vh` was — `dvh` is the *dynamic* viewport, the browser's
 * attempt to describe what a phone's collapsing URL bar does to the visible
 * area, and a laid-out React Native view already excludes that sort of chrome.
 *
 * 560 caps it on a tablet, where 62% of the screen would be a wall of white
 * over a map nobody can see any more.
 */
const SHEET_MAX_FRACTION = 0.62;
const SHEET_MAX_HEIGHT = 560;

/**
 * How far a finger must travel on the grabber before it counts as a swipe
 * rather than a tap. The web's 24px, and the reason for having a threshold at
 * all is the same: without one, the small drift in any real tap decides the
 * sheet's state at random.
 */
const SWIPE_THRESHOLD = 24;

interface Props {
  /**
   * The one line the collapsed strip shows. On the web this is the route's
   * distance and ascent, and it exists so that a shut sheet still says
   * something — a bare grabber is a handle attached to a mystery.
   */
  peek: ReactNode;
  /** The cards. Rendered into the scroll area, visible only when expanded. */
  children: ReactNode;
}

export function SummarySheet({ peek, children }: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();

  const [expanded, setExpanded] = useState(false);
  // Filled by the first layout pass. Until then the sheet cannot know how tall
  // "62%" is, which is harmless: it starts collapsed, and the collapsed height
  // does not depend on it.
  const [available, setAvailable] = useState(0);

  const openHeight = Math.min(
    available * SHEET_MAX_FRACTION,
    SHEET_MAX_HEIGHT,
  );

  // The animated value is the sheet's height in points. `useNativeDriver` is
  // false and cannot be true — height is a layout property, and the native
  // driver only handles transform and opacity. That is a real cost (the
  // animation runs on the JS thread, so a slow render while it plays will show
  // as a stutter) and it is the same cost the web pays for animating `height`
  // instead of a transform. Matching the web's behaviour is worth more here
  // than a smoother curve that opens to a different shape.
  //
  // A LAZY useState, not the `useRef(new Animated.Value(…)).current` every
  // React Native tutorial writes. Two reasons, and the second is the real one.
  // The lint rule react-hooks/refs rejects reading `.current` during render,
  // correctly — a ref is not a rendering input. And `useRef(new X())` evaluates
  // `new X()` on every single render and throws the result away, which for an
  // Animated.Value means allocating a node and its listener bookkeeping sixty
  // times a second while the sheet is moving. The initialiser below runs once.
  const [height] = useState(() => new Animated.Value(SHEET_PEEK));

  const animateTo = (next: boolean) => {
    setExpanded(next);
    Animated.timing(height, {
      toValue: next ? Math.max(openHeight, SHEET_PEEK) : SHEET_PEEK,
      duration: duration.slow,
      easing: Easing.bezier(...EASE_BEZIER),
      useNativeDriver: false,
    }).start();
  };

  // Tap and swipe on one target, told apart by distance travelled — the web's
  // rule exactly. React Native needs no equivalent of the web's `swallowClick`
  // flag, because a touch here does not also synthesise a click: onPressOut
  // fires once and this decides what it meant. The start Y is a ref rather than
  // state so that recording it cannot cause a render mid-gesture.
  const startY = useRef<number | null>(null);

  const onPressIn = (e: GestureResponderEvent) => {
    startY.current = e.nativeEvent.pageY;
  };

  const onPressOut = (e: GestureResponderEvent) => {
    const start = startY.current;
    startY.current = null;
    if (start === null) return;
    const delta = e.nativeEvent.pageY - start;
    // A tap toggles; a swipe says which way round it wants to end up, so
    // swiping up on an already-open sheet leaves it open rather than shutting
    // it. That distinction is why this is `delta < 0` and not a toggle.
    animateTo(Math.abs(delta) < SWIPE_THRESHOLD ? !expanded : delta < 0);
  };

  const onLayout = (e: LayoutChangeEvent) => {
    setAvailable(e.nativeEvent.layout.height);
  };

  return (
    // The measuring wrapper. It fills the screen and does not draw anything —
    // `pointerEvents="box-none"` so taps aimed at the map pass through it to
    // the map, which is directly underneath. Without that the sheet's own
    // container would swallow every pan gesture on the visible two thirds.
    <View style={styles.fill} pointerEvents="box-none" onLayout={onLayout}>
      <Animated.View
        style={[
          styles.sheet,
          // Safe-area inset added to the height AND paid back as padding, which
          // is what `calc(peek + env(safe-area-inset-bottom))` plus
          // `padding-bottom: env(...)` does on the web. The effect is that the
          // grabber sits 64 above the home indicator rather than 64 above the
          // bottom of the glass, where a thumb reaching for it hits the system
          // gesture area instead.
          { height: Animated.add(height, insets.bottom) },
          { paddingBottom: insets.bottom },
        ]}
      >
        <Pressable
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          style={styles.grabber}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={
            expanded
              ? t('Skjul rutedetaljer', 'Collapse route details')
              : t('Vis rutedetaljer', 'Expand route details')
          }
        >
          <View style={styles.handle} />
          <View style={styles.peekRow}>
            {/* A string peek is wrapped so callers can pass plain text; anything
                else is trusted to bring its own typography. */}
            {typeof peek === 'string' ? (
              <Text style={styles.peekText} numberOfLines={1}>
                {peek}
              </Text>
            ) : (
              peek
            )}
          </View>
        </Pressable>

        {/* Mounted only while open. The cards below fetch weather, snow and
            avalanche data on mount, and mounting them behind a shut sheet would
            spend a user's mobile data on three panels nobody asked to see. The
            same reasoning the web applies by not rendering the sheet's contents
            on the overview screen at all. */}
        {expanded && (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}

/**
 * One section of the sheet: a heading and a card under it.
 *
 * The web's `SummaryCard`, minus the tab-bar registration — see the note at the
 * top about why the tabs did not come over. `padded={false}` is kept because it
 * does the same job on both platforms: a chart wants to reach the card's edges
 * and a paragraph does not.
 */
export function SheetCard({
  title,
  padded = true,
  children,
}: {
  title: string;
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{title}</Text>
      <View style={[styles.card, !padded && styles.cardFlush]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Written out rather than spread from `StyleSheet.absoluteFillObject`, which
  // React Native 0.86's types no longer declare — `absoluteFill` is still there
  // but it is a registered style ID, not an object, so it cannot be spread or
  // combined with the `onLayout` this view exists for.
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    // The web's `0 -8px 28px rgba(0,0,0,0.18)` is --shadow-float with its
    // offset flipped upwards, and theme.ts's `shadow.float` is that token. iOS
    // takes the negative offset below; Android's elevation has no direction and
    // draws the sheet's own shadow all round, which the rounded top edge hides
    // most of anyway.
    ...shadow.float,
    shadowOffset: { width: 0, height: -8 },
    overflow: 'hidden',
  },

  grabber: {
    height: SHEET_PEEK,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s2,
    paddingVertical: space.s2,
    paddingHorizontal: space.s4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.hairlineStrong,
  },
  peekRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  peekText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    // The web sets font-variant-numeric: tabular-nums here so a distance that
    // ticks up does not jiggle the line. React Native exposes the same OpenType
    // feature under this name.
    fontVariant: ['tabular-nums'],
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: space.s4,
    paddingBottom: space.s6,
    gap: space.s4,
  },

  section: { gap: space.s2 },
  heading: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: space.s3,
    ...shadow.level1,
  },
  cardFlush: { padding: 0, overflow: 'hidden' },
});
