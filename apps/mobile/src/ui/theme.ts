// Shared visual constants, so screens do not each invent their own greys.
//
// Deliberately not a port of apps/web's CSS custom properties. Those live in
// stylesheets the phone cannot read, and half of them describe things React
// Native has no equivalent for (backdrop-filter, the glass tokens the map
// chrome uses). What is copied is the palette's intent: a cool near-black for
// text, one accent that reads against both snow and forest, and generous
// spacing because everything here is touched rather than clicked.

export const colors = {
  /** Page background. Not pure white: a full-brightness phone screen against a map is fatiguing. */
  background: '#f7f8fa',
  surface: '#ffffff',
  border: '#e2e5ea',
  text: '#14181f',
  textMuted: '#5b6472',
  /** The accent, used for primary actions and the drawn route line. */
  accent: '#1d6fa5',
  accentPressed: '#17587f',
  accentText: '#ffffff',
  danger: '#b3261e',
  dangerSurface: '#fdecea',
  /** Backdrop for controls that sit on top of the map. */
  overlay: 'rgba(255, 255, 255, 0.92)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  /** Pill. Any value past half the height rounds fully. */
  pill: 999,
} as const;

/**
 * The minimum tappable size, in points. Both platforms' guidelines land within
 * a point or two of this (44 on iOS, 48dp on Android); 44 is the safe floor and
 * is used as a minHeight rather than a fixed height so text can still grow when
 * the user has enlarged their system font.
 */
export const TOUCH_TARGET = 44;
