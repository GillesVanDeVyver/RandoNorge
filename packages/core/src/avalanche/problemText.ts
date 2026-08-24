// Turning Varsom's encoded avalanche-problem fields into human sentences.
//
// Shared by the interactive panel (AvalancheProblems) and the printable tour
// briefing. Varsom packs aspects into a bitstring and the danger band into two
// heights plus a "fill" code; getting either wrong misstates where the problem
// actually is, so both renderers decode them through this one module.

import type { AvalancheProblem } from './api';
import { translate } from '../i18n/locale.ts';

// Compass aspects, clockwise from north, matching the order of the bits in
// Varsom's ValidExpositions string ("11000111" → N, NE, SW, W, NW).
export const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const DIRS_NO = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];

/** The at-risk aspects, localized, in compass order. */
export function aspectList(expositions: string): string[] {
  return DIRS.map((d, i) => translate(DIRS_NO[i], d)).filter(
    (_, i) => expositions[i] === '1',
  );
}

// Varsom encodes the danger band with two height lines and a "fill" code that
// says which part of the mountain is affected (see AvalancheProblemType docs).
export function elevationText(p: AvalancheProblem): string | null {
  const { exposedHeight1: h1, exposedHeight2: h2, exposedHeightFill: fill } = p;
  switch (fill) {
    case 1:
      return translate(`Over ${h1} moh.`, `Above ${h1} m`);
    case 2:
      return translate(`Under ${h1} moh.`, `Below ${h1} m`);
    case 3:
      return translate(
        `Over ${h1} moh. og under ${h2} moh.`,
        `Above ${h1} m and below ${h2} m`,
      );
    case 4:
      return translate(
        `Mellom ${h2} moh. og ${h1} moh.`,
        `Between ${h2} m and ${h1} m`,
      );
    default:
      return null; // all elevations / not specified
  }
}

/**
 * Octagonal aspect-rose sector path for index `i` (0 = N, clockwise), for a
 * rose of radius `r` centred at (`c`, `c`). Shared so the screen and print
 * roses are the same shape.
 */
export function roseSectorPath(i: number, c: number, r: number): string {
  const a1 = ((i * 45 - 22.5) * Math.PI) / 180;
  const a2 = ((i * 45 + 22.5) * Math.PI) / 180;
  const x1 = c + r * Math.sin(a1);
  const y1 = c - r * Math.cos(a1);
  const x2 = c + r * Math.sin(a2);
  const y2 = c - r * Math.cos(a2);
  return `M${c} ${c} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}
