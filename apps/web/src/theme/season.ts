// =========================================================================
// Seasonal theming for the full-bleed photo pages (login + account
// overview). The photo swaps automatically with the calendar season, and
// can be forced for the rest of the browser session by visiting the app
// with a season as the first path segment — e.g. https://…/alpha/summer —
// handy for previewing a theme out of season.
// =========================================================================

// `Season`, `SEASONS` and `seasonFromDate` moved to
// @fjellrute/core/theme/season when apps/mobile's account overview grew the
// same seasonal photo: which season it is, is a date calculation, and two
// clients showing a different photo on the same afternoon is precisely the
// drift packages/core exists to prevent. They are re-exported here so every
// call site in this app keeps importing them from './theme/season' — this
// module is still the web's whole answer to seasonal theming, it just no longer
// owns the calendar. What stays below is the part that is a browser: the
// sessionStorage override and the URL it is set from.
import {
  SEASONS,
  seasonFromDate,
  OVERVIEW_CREDITS,
  type Season,
} from '@fjellrute/core/theme/season';
import { appPath, stripAppBase } from '../appBase.ts';

export { SEASONS, seasonFromDate };
export type { Season };

/** sessionStorage key for the sticky URL override ("/summer" etc.).
 *  Session-scoped on purpose: a new tab/window falls back to the
 *  date-based season, but reloads and in-app navigation keep it. */
const OVERRIDE_KEY = 'fjellrute:season-override';

/**
 * URL theme override: if the path starts with a season segment
 * ("/alpha/summer", "/alpha/fall/planner", … — "autumn" is accepted as an
 * alias), remember it for the rest of the browser session and strip the
 * segment from the URL so the app's normal routing (Root's pathToNav) never
 * sees it. Must run before Root reads window.location — main.tsx calls it
 * ahead of the first render.
 *
 * The segment is looked for *inside* the app's base (`src/appBase.ts`) and the
 * cleaned URL is written back under it. A base-less "/summer" is still
 * accepted — that is the form these links were shared in — and is rewritten
 * into the app's real URL space, because the bare root it would otherwise
 * clean itself down to belongs to the public holding page.
 */
export function consumeSeasonPathOverride(): void {
  const match = stripAppBase(window.location.pathname).match(
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
    appPath(rest) + window.location.search + window.location.hash,
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

/**
 * Account overview: mountain scenery without people — the signed-in hub reads
 * as its own place, same as before. All four lean "cloudy mystic": peaks and
 * ridges in fog, matching the winter original.
 *
 * The href/credit half comes from core's `OVERVIEW_CREDITS`, because
 * apps/mobile now shows these same four photographs and the two clients must
 * not be able to credit different photographers for the same image. Only `src`
 * is written here: it is a path under public/, which is meaningful to Vite and
 * meaningless to Metro, so each client supplies its own — see the note at the
 * top of packages/core/src/theme/season.ts.
 */
export const OVERVIEW_PHOTOS: Record<Season, SeasonPhoto> = {
  spring: { src: '/overview-spring.jpg', ...OVERVIEW_CREDITS.spring },
  summer: { src: '/overview-summer.jpg', ...OVERVIEW_CREDITS.summer },
  fall: { src: '/overview-fall.jpg', ...OVERVIEW_CREDITS.fall },
  winter: { src: '/overview-peaks.jpg', ...OVERVIEW_CREDITS.winter },
};
