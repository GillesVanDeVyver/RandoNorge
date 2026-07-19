// =========================================================================
// Seasonal theming for the full-bleed photo pages (login + account
// overview). The photo swaps automatically with the calendar season, and
// can be forced for the rest of the browser session by visiting the app
// with a season as the URL path — e.g. https://…/summer — handy for
// previewing a theme out of season.
// =========================================================================

export type Season = 'spring' | 'summer' | 'fall' | 'winter';

const SEASONS: readonly Season[] = ['spring', 'summer', 'fall', 'winter'];

/** sessionStorage key for the sticky URL override ("/summer" etc.).
 *  Session-scoped on purpose: a new tab/window falls back to the
 *  date-based season, but reloads and in-app navigation keep it. */
const OVERRIDE_KEY = 'fjellrute:season-override';

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
 * URL theme override: if the path starts with a season segment
 * ("/summer", "/fall/planner", … — "autumn" is accepted as an alias),
 * remember it for the rest of the browser session and strip the segment
 * from the URL so the app's normal routing (Root's pathToNav) never sees
 * it. Must run before Root reads window.location — main.tsx calls it
 * ahead of the first render.
 */
export function consumeSeasonPathOverride(): void {
  const match = window.location.pathname.match(
    /^\/(spring|summer|fall|autumn|winter)(\/.*)?$/i,
  );
  if (!match) return;
  const segment = match[1].toLowerCase();
  const season: Season = segment === 'autumn' ? 'fall' : (segment as Season);
  try {
    sessionStorage.setItem(OVERRIDE_KEY, season);
  } catch {
    // Storage unavailable (private mode quirks, blocked cookies):
    // the stripped URL still themes this page view via the fallback
    // below not being reached — but without persistence the next
    // navigation reverts to the date-based season. Acceptable.
  }
  const rest = match[2] && match[2] !== '/' ? match[2] : '/';
  window.history.replaceState(
    null,
    '',
    rest + window.location.search + window.location.hash,
  );
}

/** The active season: the sticky URL override if one was set this
 *  session, otherwise derived from today's date. */
export function getSeason(): Season {
  try {
    const stored = sessionStorage.getItem(OVERRIDE_KEY);
    if (stored && (SEASONS as readonly string[]).includes(stored)) {
      return stored as Season;
    }
  } catch {
    // Storage unavailable — fall through to the date-based season.
  }
  return seasonFromDate();
}

// -------------------------------------------------------------------------
// Per-season photos. All are licensed under the Pexels license (free for
// commercial use, no attribution required — https://www.pexels.com/license/);
// we credit the photographers anyway. Files live in public/.
// -------------------------------------------------------------------------

export type SeasonPhoto = {
  /** Path under public/, used as the page's background image. */
  src: string;
  /** The photo's Pexels page, linked from the corner credit. */
  href: string;
  /** Photographer name, shown as "Photo: <name>". */
  credit: string;
};

/** Login page: someone on their way up, whatever the season. */
export const LOGIN_PHOTOS: Record<Season, SeasonPhoto> = {
  spring: {
    // Subject walks left-of-centre so the login card (right side on
    // desktop) never overlaps the person.
    src: '/login-spring.jpg',
    href: 'https://www.pexels.com/photo/man-walking-on-grassland-near-a-mountain-1994893/',
    credit: 'Andrei Tanase',
  },
  summer: {
    src: '/login-summer.jpg',
    href: 'https://www.pexels.com/photo/man-standing-on-a-rock-1271619/',
    credit: 'Andrei Tanase',
  },
  fall: {
    src: '/login-fall.jpg',
    href: 'https://www.pexels.com/photo/back-view-of-a-person-standing-on-the-dirt-road-near-the-mountains-8659509/',
    credit: 'Anastassiya Golovko',
  },
  winter: {
    src: '/login-backcountry.jpg',
    href: 'https://www.pexels.com/photo/person-carrying-backpack-while-ski-touring-6575864/',
    credit: 'Alois Lackner',
  },
};

/** Account overview: mountain scenery without people — the signed-in
 *  hub reads as its own place, same as before. All four lean "cloudy
 *  mystic": peaks and ridges in fog, matching the winter original. */
export const OVERVIEW_PHOTOS: Record<Season, SeasonPhoto> = {
  spring: {
    src: '/overview-spring.jpg',
    href: 'https://www.pexels.com/photo/clouds-in-mountains-8722318/',
    credit: 'Gutjahr Aleksandr',
  },
  summer: {
    src: '/overview-summer.jpg',
    href: 'https://www.pexels.com/photo/a-mountain-covered-in-fog-4762987/',
    credit: 'Michael Wernet',
  },
  fall: {
    src: '/overview-fall.jpg',
    href: 'https://www.pexels.com/photo/photo-of-mountains-under-cloudy-sky-3181457/',
    credit: 'Tom Verdoot',
  },
  winter: {
    src: '/overview-peaks.jpg',
    href: 'https://www.pexels.com/photo/landscape-photography-of-mountains-covered-in-snow-691668/',
    credit: 'eberhard grossgasteiger',
  },
};
