// The Fjellrute design tokens, as React Native values.
//
// THIS FILE USED TO SAY THE DIVERGENCE WAS DELIBERATE. It said the web's custom
// properties "live in stylesheets the phone cannot read, and half of them
// describe things React Native has no equivalent for", and then defined its own
// palette. The first half of that is true and the second half is true of about
// four tokens — `backdrop-filter`, the two glass surfaces that depend on it, and
// the CSS shadow strings. It was applied to all of them, and the accent went
// from the product's teal to a stock blue on the strength of an argument that
// only ever covered the blur. The phone did not look like Fjellrute, and the
// reason was this comment.
//
// So: every value below is the value in apps/web/src/index.css, and the names
// mirror the custom property names (`--space-4` → `space.s4`, `--text-base` →
// fontSize.base) so the mapping is checkable rather than a matter of taste.
// scripts/verify-mobile-app.mjs section 13 parses that stylesheet and fails if
// the two disagree. The tokens drifted silently once; that check is what stops
// it happening twice.
//
// WHERE THE PLATFORMS GENUINELY PART, which is now the short list it always
// should have been:
//
//   - blur. `--glass-blur` has no React Native equivalent without expo-blur,
//     which is not a dependency and is a native module — adding one means a new
//     dev client build. `glass` below is therefore the web's `--surface-2`
//     (0.96 alpha, nearly opaque) rather than `--surface-1` (0.85, which only
//     reads correctly when something is blurring what is behind it). Swap in a
//     BlurView and `surface1` becomes the right value to hand it.
//   - shadows. A CSS shadow string cannot cross over, and `--shadow-2` is two
//     layered shadows that RN cannot express at all. See `shadow` below.
//   - the font. See FONT_FAMILY — the one row of the plan's table left open.
//
// `--ease` and the three `--dur-*` values were held back for exactly one phase,
// on the grounds that a token nobody consumes is indistinguishable from a token
// that is wrong. Phase 2's bottom sheet is the transition that needed them, so
// they are here now — see `duration` and `EASE_BEZIER` at the foot of the file.

import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const colors = {
  /**
   * The page canvas: `#f4f2ec`, warm cream.
   *
   * The one token here that is NOT a custom property. index.css sets it as a
   * literal on `html, body, #root` (lines 106 and 139) rather than declaring
   * `--page-bg`, so there is nothing named to point at — the parity check
   * matches the literal instead. Worth knowing before hunting for a variable
   * that does not exist.
   *
   * It replaces `#f7f8fa`, a cool grey. The old comment justified that as "not
   * pure white: a full-brightness phone screen against a map is fatiguing",
   * which is a good reason for not being white and no reason at all for being
   * the opposite temperature to the rest of the product.
   */
  background: '#f4f2ec',

  /** Opaque white: cards, inputs, the navigation header. */
  surface: '#ffffff',

  /**
   * `--surface-1`. The web's primary glass panel. Only correct behind a blur —
   * at 0.85 alpha with nothing blurring the map underneath it, map detail reads
   * straight through the text. Exported unused so that whoever adds expo-blur
   * has the right number waiting rather than reaching for `glass`.
   */
  surface1: 'rgba(255, 255, 255, 0.85)',

  /**
   * `--surface-2`, and what map chrome actually uses here. See the blur note at
   * the top of the file. Also the honest name for what the old `overlay` token
   * was approximating at 0.92.
   */
  glass: 'rgba(255, 255, 255, 0.96)',

  /** `--surface-3`. Deepest raised element. */
  surface3: 'rgba(245, 247, 250, 0.98)',

  /** `--surface-hover` / `--surface-active`, the washes over glass. On the phone
   *  there is no hover, so only the second has a use: it is the pressed state
   *  for anything sitting on the map. */
  surfaceActive: 'rgba(0, 0, 0, 0.1)',

  /**
   * `--hairline`. Replaces the old opaque `#e2e5ea` border.
   *
   * Opacity is the point, not a detail: these borders sit on chrome floating
   * over a map, and an opaque grey line reads as a seam where a translucent one
   * disappears into whatever is behind it.
   */
  hairline: 'rgba(0, 0, 0, 0.12)',
  hairlineStrong: 'rgba(0, 0, 0, 0.22)',

  /** `--text-1` / `--text-2` / `--text-3`. Alpha over the cream, not opaque
   *  greys, so text sits in the page rather than on it. */
  text: 'rgba(20, 28, 38, 0.92)',
  textMuted: 'rgba(20, 28, 38, 0.58)',
  textFaint: 'rgba(20, 28, 38, 0.38)',

  /** `--accent`: alpine/glacier teal. The product's colour, and the reason this
   *  file was rewritten. */
  accent: '#2dd4bf',

  /**
   * `--accent-hover`. Used here for the PRESSED state, which means pressing
   * lightens rather than darkens.
   *
   * That is the web's own behaviour and the reason not to invent a darker
   * value: the old `accentPressed: '#17587f'` was a shade of a blue that no
   * longer exists, and a hand-mixed dark teal would be a token with no
   * counterpart for the parity check to check.
   */
  accentPressed: '#4ee0cd',

  /**
   * `--accent-contrast`: near-black teal for text and icons on accent fills.
   *
   * Renamed from `accentText` to match the custom property. The old value was
   * `#ffffff`, which was legible on the old blue and is not on this teal —
   * white on `#2dd4bf` is about 1.9:1. This is the single highest-impact line
   * in the port, because it is what every primary button's label uses.
   */
  accentContrast: '#04241f',

  /** `--accent-ring`. The focus ring. No keyboard focus on the phone yet, but
   *  it is what a pressed-and-held control's halo should be when one appears. */
  accentRing: 'rgba(45, 212, 191, 0.55)',

  /**
   * `--ascent` / `--descent` and their `-strong` variants for text on white.
   *
   * The plan is blunt about why these matter: nothing on the phone can render
   * an elevation profile in the house style without them, and the profile is
   * the highest-value item in the whole plan. They arrive one phase early so
   * that Phase 2 is rendering work only.
   */
  ascent: '#34c759',
  ascentStrong: '#1f9e48',
  descent: '#ff6b5e',
  descentStrong: '#dd4a3c',

  /** `--snow`. Snow-depth figures and the snow overlay. */
  snow: '#7fb4e6',

  /** `--route`. The drawn route line, everywhere it is drawn.
   *
   *  Identical to `accent` on both platforms — kept as its own name because
   *  apps/web keeps it as its own name (ROUTE_COLOR in routeStyle.ts), and the
   *  day the route stops being the accent colour is a day nobody wants to spend
   *  finding out which of the two a given call site meant. */
  route: '#2dd4bf',

  /** `--danger`. Destructive actions and failed requests. `#b3261e`, the old
   *  value, is Material's red: correct for Android and foreign here. This is
   *  the palette's own red, the same value as `descentStrong`, so an error
   *  message speaks with the descent figures rather than against them. */
  danger: '#dd4a3c',

  /**
   * Tinted background for an error block.
   *
   * MOBILE-ONLY, and the only colour below with no counterpart in index.css:
   * the web builds its error blocks from a glass surface plus a coloured
   * border, which needs the blur to work. Derived from `danger` rather than
   * picked, so it cannot drift away from it — this is what `#fdecea`, a tint of
   * the Material red, was doing before.
   */
  dangerSurface: 'rgba(221, 74, 60, 0.1)',

  /** `--warning` and its block: a data gap, a degraded offline tile. Distinct
   *  from `danger` — nothing is being destroyed, but the data cannot be fully
   *  trusted, which on a backcountry tool is its own signal. Unused today;
   *  ported because Phase 3's three data panels are entirely about data that
   *  may not have arrived. */
  warning: '#b45309',
  warningSurface: '#fffbeb',
  warningBorder: '#fcd34d',

  // -------------------------------------------------------------------------
  // THE PHOTO PAGES. Everything above is a custom property in index.css; the
  // ones below are colours apps/web writes as LITERALS, in
  // AccountOverview.module.css, RoutesListPage.module.css and the dialogs,
  // because they belong to one composition rather than to the palette. The
  // first eight came with the account overview; the six after `iconTile` came
  // with the saved-routes list. They are here for the reason
  // `dangerSurface` is here: section 13's parity table only covers the pairs it
  // lists, and a value with no `--custom-property` to point at still must not
  // be typed into a StyleSheet — that is what section 14 checks, and it is the
  // same argument. The comment on each says which rule it came from.
  // -------------------------------------------------------------------------

  /** `.brandName` / `.greeting`: `#fff`. Not `surface` — that is the colour of
   *  a card, and this is ink, on a photograph, where the two happening to be
   *  the same value is a coincidence rather than a relationship. */
  onPhoto: '#ffffff',
  /** `.subtitle`: white stepped back so it sits under the headline. The web has
   *  no `--text-2` equivalent for type on a photo, so it writes this. */
  onPhotoMuted: 'rgba(255, 255, 255, 0.86)',

  /** The ink both scrims are made of: `rgba(8, 18, 28, …)`, a very dark blue.
   *  Stated once because it appears at five opacities between the backdrop
   *  gradient, the text shadows and the account popover, and a colour retyped
   *  five times is a colour that can drift a channel without anyone noticing. */
  scrimInk: '#08121c',
  /** `.page::before`'s fallback, shown while the photograph decodes so the
   *  first frame is a plausible pale sky rather than a black rectangle. */
  photoFallback: '#dfe7ee',

  /** `.cardPrimary`'s teal wash, layered over `glass`. The web ramps it from
   *  0.2 to 0.05 across the card; see the note at its use in app/index.tsx for
   *  why the phone's is flat. */
  accentWash: 'rgba(45, 212, 191, 0.1)',
  /** `.cardIcon` / `.feedbackIcon`: the square tile an icon sits in. `--text-1`
   *  ink at 0.06 — dark enough to read as a container on white, light enough
   *  to disappear against the glass it is on. */
  iconTile: 'rgba(20, 28, 38, 0.06)',

  /** `.routeCard` / `.deleteBtn` / `.exportBtn` / `.confirmCancel` in
   *  RoutesListPage.module.css: white at 0.55, a card ON a card. It is
   *  translucent because it sits on the panel's own glass, and going opaque
   *  would make each row a slab rather than a division of one surface. */
  routeCard: 'rgba(255, 255, 255, 0.55)',

  /** `.visToggle:hover` / `.copyLinkBtn:hover`'s teal wash, at 0.12. Distinct
   *  from `accentWash` (0.1, `.cardPrimary`'s fill) by two hundredths, which is
   *  not worth reconciling: they are different rules in different stylesheets
   *  and collapsing them would make one of the two wrong on purpose. Here it is
   *  the PRESSED state — the phone has no hover — for the sharing controls. */
  accentWashStrong: 'rgba(45, 212, 191, 0.12)',

  /** `.deleteBtn:hover`, `.confirmDelete`, `.listError`: `#c0392b`.
   *
   *  NOT `danger` (`#dd4a3c`), and the difference is deliberate on the web's
   *  part. `--danger` is the palette's red, tuned to sit beside the descent
   *  figures; this is a deeper, less orange red that the route list uses for
   *  the one irreversible thing on the screen. Copied rather than unified
   *  because unifying it here would be this file deciding a question that
   *  belongs to the stylesheet. */
  dangerDeep: '#c0392b',

  /** `.confirmDelete`'s label: `#fff` on that deep red.
   *
   *  Its own name rather than `surface` or `onPhoto`, both of which are also
   *  `#ffffff`, because both of those say what they are for and neither is
   *  this: `surface` is the colour of a card and `onPhoto` is ink on a
   *  photograph. Three white tokens is not duplication when the three answer
   *  different questions — it is what stops a card turning bone-white from
   *  quietly repainting a button label. */
  onDanger: '#ffffff',

  /** `.copyLinkBtnCopied`: the green the copy-link label flashes for 1.8s. A
   *  hair darker than `ascentStrong` (`#1f9e48`) and, again, the web's own
   *  value — this is a confirmation, not an ascent figure. */
  copied: '#1f8a4c',

  /** `.thumb`'s placeholder — the clear colour of the steepness canvas the web
   *  draws its mini-maps on, and therefore the tile the phone's SVG route shape
   *  is drawn over. See src/ui/RouteThumbnail.tsx for why the phone stops at
   *  the shape and does not fetch the map behind it. */
  mapTile: '#e8edf2',

  /** `.emptyIcon`'s dashed circle fill: `--text-1` ink at 0.05, a shade lighter
   *  than `iconTile`'s 0.06 because this one is 56px rather than 46 and the
   *  same alpha over that much area reads heavier. The web writes both. */
  emptyTile: 'rgba(20, 28, 38, 0.05)',

  /** What a modal dialog dims the app with — the web's `.backdrop`, shared by
   *  FeedbackDialog, DisclaimerModal and TermsDialog. */
  backdrop: 'rgba(0, 0, 0, 0.45)',
  /** And what a POPOVER dims it with, which is deliberately much less. The
   *  web's account popover has no backdrop at all: it is an absolutely
   *  positioned div over a page that stays fully live. The phone needs a
   *  full-screen layer to catch the tap that closes it (see AccountChip), so
   *  the layer exists — barely tinted, so one tap does not feel like leaving
   *  the screen. Built from `scrimInk` rather than black, so it warms the
   *  photograph the same way the scrim above it does. */
  popoverBackdrop: 'rgba(8, 18, 28, 0.28)',
} as const;

/**
 * The halo the web puts behind white text on a photograph.
 *
 * `text-shadow: 0 <offsetY>px <blur>px rgba(8, 18, 28, <opacity>)` maps onto
 * React Native's three Text props one-for-one, so this is a spelling change
 * rather than an approximation — unlike `shadow` below, which cannot be one.
 * It is a function rather than three named tokens because AccountOverview.module
 * .css uses four different combinations across `.brandName`, `.eyebrow`,
 * `.greeting` and `.subtitle`, and naming four one-use shadows would say they
 * were a scale when they are four judgement calls about how bright the fog is
 * behind each line.
 *
 * It lives HERE, next to `scrimInk`, so the rgba() string is built in the one
 * file allowed to contain colour — a screen that assembled it inline would be
 * writing a colour literal, which is exactly what section 14 of
 * scripts/verify-mobile-app.mjs exists to stop.
 */
export function onPhotoShadow(
  blur: number,
  opacity: number,
  offsetY = 1,
): TextStyle {
  return {
    textShadowColor: `rgba(8, 18, 28, ${opacity})`,
    textShadowOffset: { width: 0, height: offsetY },
    textShadowRadius: blur,
  };
}

/**
 * `--space-1` … `--space-8`, the web's 4px scale.
 *
 * NAMED FOR THE MULTIPLE, not semantically (`sm`/`md`/`lg`), and the rename is
 * worth the churn it cost. The old scale was 4 / 8 / 16 / 24 / 32 — the web's
 * with 12 quietly missing, because there was no name free between `sm` and
 * `md`. A missing step does not announce itself; it turns into an 8 that looks
 * mean or a 16 that looks loose, once per screen. Numbering them the way the
 * stylesheet numbers them means a gap is a hole in a sequence, and it lets the
 * parity check map `--space-3` to `space.s3` without a translation table.
 */
export const space = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s6: 24,
  s8: 32,
} as const;

/** `--radius-*`. `lg` (16) was the other silent omission: it is the corner
 *  radius of every large panel on the web, including the bottom sheet Phase 2
 *  needs, so the phone had no way to round a panel correctly. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  /** Pill. Any value past half the height rounds fully. */
  pill: 999,
} as const;

/**
 * `--text-xs` … `--text-xl`.
 *
 * The row of the plan's table that read "font sizes | 11 / 13 / 15 / 20 / 26 |
 * none — inline per screen". Five screens had invented 11, 12, 13, 14, 15, 16,
 * 17 and 30 between them, which is not a scale, it is eight decisions taken
 * separately. Sizes that were between steps round to the nearer step; `30` on
 * the login title becomes `xl` (26), which is the size the web sets its own
 * page titles at.
 */
export const fontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  lg: 20,
  xl: 26,
} as const;

/**
 * The typeface, or rather the absence of one.
 *
 * `undefined` means React Native's platform default (San Francisco, Roboto),
 * and this is the one row of the plan's Phase 0 table left open. It is NOT
 * blocked on a dependency, which is the assumption worth heading off:
 * expo-font@57.0.1 is already in pnpm-lock.yaml, pulled in by expo-router, so
 * nothing needs installing.
 *
 * It is blocked on the font files. `--font-sans` is Inter, self-hosted from
 * @fontsource/inter (apps/web/src/main.tsx), and that package ships .woff and
 * .woff2 only — neither of which expo-font can load on native, which wants
 * .ttf or .otf. Closing this row therefore means committing four Inter .ttf
 * binaries (400/500/600/700) to the repository and calling useFonts before the
 * first frame, and "add some binaries" is a decision to take on purpose rather
 * than a side effect of porting colours.
 *
 * Typed as `string | undefined` so that assigning a family name later is a
 * one-line change here and no change anywhere else.
 */
export const FONT_FAMILY: string | undefined = undefined;

/**
 * `--shadow-1`, `--shadow-2`, `--shadow-float`.
 *
 * The one place a value cannot simply be copied. A CSS shadow string does not
 * cross over, and the two platforms do not agree with each other either: iOS
 * takes the offset/radius/opacity quartet, Android takes a single `elevation`
 * and derives the rest. `--shadow-2` is worse than that — it is two layered
 * shadows, and RN can express one, so the wider of the pair is kept and the
 * tight 1px layer under it is lost. That is a real, if small, difference from
 * the web and is the reason these are approximations rather than ports.
 *
 * Spread as `...shadow.float` into a StyleSheet entry.
 */
export const shadow: Record<'level1' | 'level2' | 'float', ViewStyle> = {
  level1: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowRadius: 2,
      shadowOpacity: 0.08,
    },
    default: { elevation: 1 },
  }),
  level2: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 10,
      shadowOpacity: 0.12,
    },
    default: { elevation: 3 },
  }),
  float: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowRadius: 28,
      shadowOpacity: 0.18,
    },
    default: { elevation: 8 },
  }),
};

/**
 * `--dur-fast`, `--dur`, `--dur-slow`, in milliseconds.
 *
 * The web writes them with the unit (`320ms`) because CSS requires it and React
 * Native forbids it — `Animated.timing` takes a bare number of milliseconds —
 * so these are the same three values with the `ms` dropped, exactly as the
 * lengths are the same values with the `px` dropped. The parity check strips
 * both suffixes for the comparison.
 *
 * `base` rather than `dur` for the middle one: the web's is the unsuffixed
 * `--dur`, and a key literally called `dur` on an object called `duration` reads
 * as a stutter at every call site.
 */
export const duration = {
  fast: 120,
  base: 200,
  slow: 320,
} as const;

/**
 * `--ease`, as the four control points of its cubic Bézier rather than a string.
 *
 * `cubic-bezier(0.2, 0, 0, 1)` is a decelerate curve: it leaves fast and settles
 * slowly, which is what makes a sheet feel like it was thrown rather than
 * dragged by a motor. React Native cannot parse the CSS spelling, so the numbers
 * are kept as numbers and handed to `Easing.bezier(...EASE_BEZIER)` at the point
 * of use. Spread rather than pre-built because `Easing` comes from react-native
 * and this module is imported by files that only want colours.
 */
export const EASE_BEZIER: readonly [number, number, number, number] = [
  0.2, 0, 0, 1,
];

/**
 * The minimum tappable size, in points. Both platforms' guidelines land within
 * a point or two of this (44 on iOS, 48dp on Android); 44 is the safe floor and
 * is used as a minHeight rather than a fixed height so text can still grow when
 * the user has enlarged their system font.
 *
 * No web counterpart, and there should not be one: a pointer is precise and a
 * finger is not. The one token here the parity check deliberately ignores.
 */
export const TOUCH_TARGET = 44;
