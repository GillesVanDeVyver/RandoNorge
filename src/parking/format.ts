// How far a lot is from the start, written the way a driver reads it.
//
// Here rather than in either of the two places that print it. The tab and the
// printed briefing show the same five lots, and a guide checking the sheet
// against the screen is checking two renderings of one query — so "240 m" on
// one and "0.2 km" on the other would look like a disagreement about the
// ground rather than about a format string. It had already started: the sheet
// was written with a plain toFixed and printed "1.2 km" to a Norwegian reader
// the tab was showing "1,2 km" to.
//
// Two rules, both about how the number is read rather than how precise it is.
// Below a kilometre it is metres, rounded to ten, because nobody paces out the
// last four; at a kilometre and above it is one decimal, because the choice
// between two lots at that range is made on the map and not on the third digit.
// And the decimal separator follows the language, since a Norwegian sheet that
// prints "1.2 km" is a sheet that was written somewhere else.

import type { Translate } from '../i18n/index.ts';

export function formatParkingDistance(m: number, t: Translate): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  const km = (m / 1000).toFixed(1);
  return t(`${km.replace('.', ',')} km`, `${km} km`);
}

/** The search radius, in the whole kilometres the slider moves in.
 *
 *  Takes no Translate, unlike the distance above: the slider steps in half
 *  kilometres and this rounds to whole ones, so there is no decimal separator
 *  for a language to have an opinion about. */
export function formatParkingRadius(m: number): string {
  return `${(m / 1000).toFixed(0)} km`;
}
