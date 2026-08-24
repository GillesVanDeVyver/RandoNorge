// Canonical slope-angle and runout colour scheme, shared by everything that
// paints terrain steepness: the elevation profile chart (ProfilePanel), the
// printable tour briefing, and any legend describing either. Keeping one
// definition matters — a briefing whose colours disagreed with the screen (or
// with the map overlay it is meant to summarise) would actively mislead.
//
// NVE Bratthet 2024 colour bands — same as the map overlay. The overlay paints
// exactly five slope classes (30-35, 35-40, 40-45, 45-50, >50). Everything
// below 30° is class 1 and renders fully transparent, so we use a neutral gray
// there to keep the line visible against a white background.
//
// Verified by sampling the published tiles: across 2.1M pixels spanning Jæren
// to Svalbard the only colours present are the five below plus the three runout
// blues. There is no green class. An earlier #38a800 band at 27-30° here had no
// counterpart on the map, which made the profile show green for terrain the
// overlay deliberately leaves blank.

export const GRAY = '#666666';

// NVE Bratthet_med_utlop_2024 layer 2/3/4 fill colours (decoded from the
// service legend). Indexed by RunoutLevel: 0 unused, 1=long, 2=medium,
// 3=short runout.
export const RUNOUT_COLORS = ['', '#9AB1E6', '#4C9BFF', '#004DA8'];

export interface SteepnessBand {
  /** Exclusive upper bound of the band, in degrees. */
  max: number;
  color: string;
}

export const STEEPNESS_BANDS: SteepnessBand[] = [
  { max: 30, color: GRAY },
  { max: 35, color: '#ffff00' },
  { max: 40, color: '#ffaa00' },
  { max: 45, color: '#ff5500' },
  { max: 50, color: '#ff0000' },
  { max: Infinity, color: '#730000' },
];

export function steepnessColor(deg: number): string {
  for (const b of STEEPNESS_BANDS) if (deg < b.max) return b.color;
  return STEEPNESS_BANDS[STEEPNESS_BANDS.length - 1].color;
}
