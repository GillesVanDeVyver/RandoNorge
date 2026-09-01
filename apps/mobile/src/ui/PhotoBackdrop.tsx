// The full-bleed seasonal photograph and its scrim — the "Alpine Glass"
// backdrop the web's photo pages are built on, as two React Native layers.
//
// This is the piece apps/mobile/app/index.tsx used to say it was not porting:
// "copying image binaries into apps/mobile to reproduce a background is a
// bigger decision than this phase, so the hub is the same composition on the
// cream canvas instead". That was true of the phase it was written in, and it
// is what made the phone look like a different product from the browser tab
// next to it. The four binaries are now committed (see ./season.ts), so the
// composition can be the real one.
//
// TWO LAYERS, MATCHING AccountOverview.module.css EXACTLY:
//
//   1. `.page::before` — the photograph, `center / cover`, over a `#dfe7ee`
//      fallback that shows while it loads. `resizeMode="cover"` is the same
//      rule; the fallback becomes the View's own background, because an
//      <Image> has nothing behind it to shine through.
//
//   2. `.scrim` — a three-stop vertical gradient darkening the photo so white
//      text stays legible: 0.52 at the top, easing to 0.40 at 40%, then down to
//      0.58 at the bottom where the cards sit. This photo's fog is bright,
//      which is why it is darker than the login page's.
//
// WHY THE GRADIENT IS AN SVG. React Native has no CSS gradients, and the two
// ways to draw one are expo-linear-gradient or react-native-svg's
// <LinearGradient>. The first is the idiomatic Expo answer and was not chosen:
// it is a NATIVE module, so adding it invalidates every development build on
// every device — `npx expo run:android` or a fresh EAS build before the app
// will start again — and it is a rebuild bought for one rectangle. The second
// is already a dependency (Phase 2 added it for the elevation profile), draws
// this in eight elements, and costs nothing but this comment. If expo-blur is
// ever added for the real glass surfaces, revisit: at that point a rebuild is
// already being paid for and expo-linear-gradient rides along free.
//
// Both layers are `pointerEvents="none"` and absolutely filled, so the content
// above scrolls and taps as if they were not there — the web gets the same from
// `position: fixed` plus `pointer-events: none`.

import { Image, StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { colors } from './theme';

/** The web's three gradient stops, as offset/opacity pairs. Read them against
 *  `.scrim` in AccountOverview.module.css — same numbers, same order. The ink
 *  they are all drawn in is `colors.scrimInk`; only the opacity varies, which
 *  is the whole reason the colour is a token and these are not. */
const SCRIM_STOPS: readonly { offset: string; opacity: number }[] = [
  { offset: '0%', opacity: 0.52 },
  { offset: '40%', opacity: 0.4 },
  { offset: '100%', opacity: 0.58 },
];

type Props = {
  /** A bundled image, from `OVERVIEW_PHOTOS[season].src` in ./season.ts. */
  photo: number;
};

export function PhotoBackdrop({ photo }: Props) {
  return (
    <View style={styles.root} pointerEvents="none">
      <Image
        source={photo}
        style={styles.photo}
        // `center / cover`: fill the frame, crop the overflow, never distort.
        resizeMode="cover"
        // Decorative. The greeting and the cards say everything this screen
        // means; a screen reader announcing "photograph of mountains" before
        // them is noise, exactly as `aria-hidden` makes it on the web.
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          {/* x1/y1 → x2/y2 top-to-bottom in the gradient's own object space,
              which is what `linear-gradient(180deg, …)` means on the web. */}
          <LinearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
            {SCRIM_STOPS.map(({ offset, opacity }) => (
              <Stop
                key={offset}
                offset={offset}
                stopColor={colors.scrimInk}
                stopOpacity={opacity}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#scrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.photoFallback,
  },
  photo: StyleSheet.absoluteFill,
});
