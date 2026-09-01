// The phone's half of the seasonal photo table.
//
// WHY THIS FILE EXISTS AT ALL, given the rule that nothing non-visual is
// written inside apps/mobile. Nothing non-visual is: `Season`,
// `seasonFromDate` and the four photographer credits all come from
// @fjellrute/core/theme/season, so the phone does not decide which season it
// is and does not decide whose photograph it is showing. What is left here is
// four `require()` calls, and they cannot live anywhere else.
//
// Metro resolves asset references at BUNDLE TIME by statically reading the
// argument to `require()`. That means the path has to be a literal, in a file
// Metro is bundling, inside this app — a variable, a template string, or a
// path handed over from packages/core all produce the same runtime error about
// an unregistered asset, and packages/core is not even bundled by Metro alone.
// The web's counterpart is a URL string under public/ that Vite serves, which
// is why apps/web/src/theme/season.ts keeps its own `src` values too. Both
// clients name their own files; both read the same table for everything else.
//
// The four images are byte-identical copies of apps/web/public/overview-*.jpg.
// Copies, not a shared directory, for the same reason: Metro will not follow a
// require() out of the project into apps/web/public, and Expo's asset pipeline
// needs them under this app to put them in the .apk/.ipa at all.

import {
  OVERVIEW_CREDITS,
  seasonFromDate,
  type Season,
  type SeasonCredit,
} from '@fjellrute/core/theme/season';

/** What `require()` returns for an image: Metro's asset registry id, which
 *  `<Image source={…}>` takes directly. `number` at runtime — typed through
 *  ImageSourcePropType-compatible `number` rather than `any`. */
type AssetModule = number;

export interface SeasonPhoto extends SeasonCredit {
  /** The bundled image, ready to hand to `<Image source={…}>`. */
  src: AssetModule;
}

/**
 * Account overview: mountain scenery without people, all four leaning "cloudy
 * mystic" — peaks and ridges in fog. Same four photographs as the web's
 * `OVERVIEW_PHOTOS`, same credits, from the same table.
 */
/* `@typescript-eslint/no-require-imports` is switched off for this object only.
   The rule is right everywhere else in the app — a `require()` of a MODULE is a
   CommonJS import written in a TypeScript file — but these four are not module
   imports. They are the bundler's asset syntax, and the note at the top of this
   file is the whole argument for why an `import` cannot replace them: Metro
   reads the literal at bundle time to register the file, and `import photo from
   '…jpg'` resolves through the type system to something Metro never registers.
   Re-enabled immediately after the table. */
/* eslint-disable @typescript-eslint/no-require-imports */
export const OVERVIEW_PHOTOS: Record<Season, SeasonPhoto> = {
  spring: {
    src: require('../../assets/overview/overview-spring.jpg') as AssetModule,
    ...OVERVIEW_CREDITS.spring,
  },
  summer: {
    src: require('../../assets/overview/overview-summer.jpg') as AssetModule,
    ...OVERVIEW_CREDITS.summer,
  },
  fall: {
    src: require('../../assets/overview/overview-fall.jpg') as AssetModule,
    ...OVERVIEW_CREDITS.fall,
  },
  winter: {
    src: require('../../assets/overview/overview-peaks.jpg') as AssetModule,
    ...OVERVIEW_CREDITS.winter,
  },
};
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The photo for today.
 *
 * No override, where the web has a sticky "/summer"-style URL segment for
 * previewing a theme out of season. That override is a URL the developer types
 * into an address bar, and a phone has no address bar — reproducing it would
 * mean inventing a gesture or a hidden setting, which is a feature rather than
 * a port. `seasonFromDate` is the shared half, so the phone and an
 * un-overridden browser always agree.
 */
export function overviewPhoto(): SeasonPhoto {
  return OVERVIEW_PHOTOS[seasonFromDate()];
}
