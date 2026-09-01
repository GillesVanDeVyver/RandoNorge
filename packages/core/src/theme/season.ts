// Which season it is, and what a seasonal photo credit consists of.
//
// WHAT IS HERE AND WHAT DELIBERATELY IS NOT. The full-bleed photo pages — the
// login page and the account overview — exist on both clients now, and both
// have to agree on which of the four photos is the current one. That agreement
// is a date calculation, which is logic, which under the one rule in
// docs/mobile-web-parity-plan.md means it lives in this package rather than
// being written a second time in apps/mobile.
//
// The rest of apps/web/src/theme/season.ts stays in apps/web, because the rest
// of it is a browser: `consumeSeasonPathOverride` reads window.location and
// rewrites it through the History API, and `getSeason` layers a sessionStorage
// override on top of `seasonFromDate` below. A phone has no URL bar to type
// "/summer" into, so there is nothing for either to do there — and moving them
// would need two more adapters in i18n/environment.ts's style to buy nothing.
//
// THE PHOTOS THEMSELVES are also not here, and that is the interesting
// omission. `OVERVIEW_PHOTOS` maps a season to a `src` like '/overview-fall.jpg'
// — a URL under apps/web/public, which means nothing to Metro, whose asset
// references have to be statically analysable `require()` calls resolved at
// bundle time. So each client owns its own map from Season to an image, and
// what they share is the `Season` union that keys it, `seasonFromDate` that
// picks it, and `SeasonPhoto`'s credit fields. That is the part that could
// drift; a require() path cannot.

export type Season = 'spring' | 'summer' | 'fall' | 'winter';

export const SEASONS: readonly Season[] = [
  'spring',
  'summer',
  'fall',
  'winter',
];

/** Meteorological seasons (northern hemisphere): Mar–May spring,
 *  Jun–Aug summer, Sep–Nov fall, Dec–Feb winter. */
export function seasonFromDate(date: Date = new Date()): Season {
  const month = date.getMonth(); // 0-based
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
}

/**
 * The photographer credit shown in the corner of a photo page.
 *
 * `src` is typed as `string` on the web (a path under public/) and as whatever
 * `require()` returns on the phone (a number, in Metro's asset registry), so it
 * is NOT part of this type — see the note at the top of the file. Each client
 * intersects this with its own image field.
 */
export interface SeasonCredit {
  /** The photo's Pexels page, linked from the corner credit. */
  href: string;
  /** Photographer name, shown as "Photo: <name>". */
  credit: string;
}

/**
 * The account overview's four photos, minus the images: mountain scenery
 * without people, all leaning "cloudy mystic" — peaks and ridges in fog.
 *
 * All are licensed under the Pexels license (free for commercial use, no
 * attribution required — https://www.pexels.com/license/); we credit the
 * photographers anyway, on both clients, from this one table.
 */
export const OVERVIEW_CREDITS: Record<Season, SeasonCredit> = {
  spring: {
    href: 'https://www.pexels.com/photo/clouds-in-mountains-8722318/',
    credit: 'Gutjahr Aleksandr',
  },
  summer: {
    href: 'https://www.pexels.com/photo/a-mountain-covered-in-fog-4762987/',
    credit: 'Michael Wernet',
  },
  fall: {
    href: 'https://www.pexels.com/photo/photo-of-mountains-under-cloudy-sky-3181457/',
    credit: 'Tom Verdoot',
  },
  winter: {
    href: 'https://www.pexels.com/photo/landscape-photography-of-mountains-covered-in-snow-691668/',
    credit: 'eberhard grossgasteiger',
  },
};
