// Local calendar days, and the short labels the day-selector chips wear.
//
// WHY THIS FILE EXISTS. Before Phase 3 of docs/mobile-web-parity-plan.md there
// were six copies of `pad2`, three of `toYMD`, two of `shiftYMD`, and two
// separate implementations of "Today / Tomorrow / short weekday" that did not
// agree with each other. That was survivable while one app rendered all of
// them, because a reader comparing two panels on one screen would notice a
// disagreement. It stops being survivable the moment a second client renders
// the same three data panels, since a phone showing "Tue" where the web shows
// "I morgen" is a bug nobody is in a position to see.
//
// EVERYTHING HERE IS LOCAL TIME, DELIBERATELY. A hiker asks "what is the
// weather on Tuesday" meaning Tuesday where they are standing, and MET's
// timestamps are UTC. Grouping by the UTC day would move an 01:00 hour into the
// wrong chip for half the year in Norway and for most of the day in the
// timezones this is developed from. So `toYMD` reads getFullYear/getMonth/
// getDate rather than toISOString, and `parseYMD` builds `new Date(y, m-1, d)`
// rather than parsing 'YYYY-MM-DD' — which the Date constructor would read as
// UTC midnight and then display as the previous evening west of Greenwich.
//
// Two copies were deliberately NOT folded in here. DatePopover's month grid and
// BriefingSheet's `longDate` both spell months out in full ("januar", "January")
// because they have room to; these are the abbreviations, which is a different
// vocabulary and not a shorter version of the same one.

import { translate } from '../i18n/locale.ts';

/** Two digits, zero-padded. Dates and clock hours both want it. */
export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A Date as 'YYYY-MM-DD' in the local timezone. */
export function toYMD(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM-DD' back to local midnight of that day. */
export function parseYMD(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Today, as 'YYYY-MM-DD' in the local timezone. */
export function todayLocalYMD(): string {
  return toYMD(new Date());
}

/**
 * Move a 'YYYY-MM-DD' by whole days, staying on the local calendar.
 *
 * Done by handing an out-of-range day to the Date constructor, which normalises
 * it — so month ends, leap days and year boundaries are the platform's problem
 * rather than this file's. Adding 86 400 000 ms instead would be wrong twice a
 * year: the day a DST transition lands on is 23 or 25 hours long.
 */
export function shiftYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return toYMD(new Date(y, m - 1, d + days));
}

const DOW_SHORT_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_SHORT_NO = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
const MONTHS_SHORT_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTHS_SHORT_NO = [
  'jan', 'feb', 'mar', 'apr', 'mai', 'jun',
  'jul', 'aug', 'sep', 'okt', 'nov', 'des',
];

/**
 * The word on a day chip: "Yesterday" / "Today" / "Tomorrow" for the three days
 * around `todayYMD`, and the short weekday name for everything else.
 *
 * Yesterday is included even though a weather forecast never contains one —
 * MET's timeseries starts at the current hour. The avalanche panel does reach
 * backwards, because a bulletin from two days ago is a real thing to look up,
 * and one function that handles a case its second caller cannot reach is
 * cheaper than two functions that differ by one line and drift.
 */
export function dayLabel(ymd: string, todayYMD: string): string {
  if (ymd === todayYMD) return translate('I dag', 'Today');
  if (ymd === shiftYMD(todayYMD, 1)) return translate('I morgen', 'Tomorrow');
  if (ymd === shiftYMD(todayYMD, -1)) return translate('I går', 'Yesterday');
  return translate(
    DOW_SHORT_NO[parseYMD(ymd).getDay()],
    DOW_SHORT_EN[parseYMD(ymd).getDay()],
  );
}

/** The date under the word on a day chip: "21. jun" / "Jun 21". */
export function dayDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return translate(
    `${d}. ${MONTHS_SHORT_NO[m - 1]}`,
    `${MONTHS_SHORT_EN[m - 1]} ${d}`,
  );
}
