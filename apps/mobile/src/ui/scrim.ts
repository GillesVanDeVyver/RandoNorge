// The gradients that darken a photograph so white type stays legible on it.
//
// A FILE OF ITS OWN, and not because there are two of them. They started inside
// PhotoBackdrop.tsx, which is where they are used, and eslint's
// `react-refresh/only-export-components` is right to refuse that: a module that
// exports both a component and a constant loses Fast Refresh for the component,
// so editing the picture would reload the app instead of the screen.
//
// Only the OPACITIES are here. The ink they are drawn in is `colors.scrimInk`
// in ./theme.ts, and it stays there — this file must never grow a colour, which
// is also what section 14 of scripts/verify-mobile-app.mjs would say about it.

/** One stop: where it sits along the gradient, and how opaque the ink is
 *  there. Offsets are percentage strings because that is what SVG's <Stop>
 *  takes and what `linear-gradient()` writes on the web, so the two spellings
 *  can be compared line for line. */
export interface ScrimStop {
  offset: string;
  opacity: number;
}

/**
 * `.scrim` in AccountOverview.module.css: 0.52 at the top, easing to 0.40 at
 * 40%, then down to 0.58 at the bottom where the cards sit. This photo's fog is
 * bright, which is why it is darker than the login page's.
 */
export const OVERVIEW_SCRIM: readonly ScrimStop[] = [
  { offset: '0%', opacity: 0.52 },
  { offset: '40%', opacity: 0.4 },
  { offset: '100%', opacity: 0.58 },
];

/**
 * `.scrim` in RoutesListPage.module.css: 0.55, 0.42 at 45%, 0.55.
 *
 * Two hundredths from the hub's at each end and a slightly later, slightly
 * brighter waist — near enough that sharing one set would look identical in a
 * screenshot, and far enough that doing so would be this file deciding a
 * question that belongs to two different stylesheets. They are also different
 * shapes for a reason: the hub darkens most at the FOOT, under its cards, while
 * the list is symmetrical because its panel is one block in the middle.
 */
export const LIST_SCRIM: readonly ScrimStop[] = [
  { offset: '0%', opacity: 0.55 },
  { offset: '45%', opacity: 0.42 },
  { offset: '100%', opacity: 0.55 },
];
