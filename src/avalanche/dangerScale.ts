// The EAWS / Varsom avalanche danger scale: colours and localized names.
//
// Shared by the on-screen risk panel and the printable tour briefing. Colours
// mirror the senorge.no legend — a briefing handed to a client on a skredkurs
// has to use the same red for "4" that every other Norwegian avalanche product
// uses, so this lives in one place.

import { translate } from '../i18n/locale.ts';

export interface DangerLevelInfo {
  color: string; // badge background
  onColor: string; // text on the badge
}

export const DANGER_LEVELS: Record<number, DangerLevelInfo> = {
  1: { color: '#6dbe45', onColor: '#0a2a06' },
  2: { color: '#f4d63f', onColor: '#3a3000' },
  3: { color: '#f0922f', onColor: '#3a1e00' },
  4: { color: '#e23c34', onColor: '#ffffff' },
  5: { color: '#3a464e', onColor: '#ffffff' },
};

/** Localized danger-level name. Level 0 (or unknown) is the "not assessed"
 *  state used by the legend and the no-forecast row. */
export function dangerLevelLabel(level: number): string {
  switch (level) {
    case 1:
      return translate('Liten skredfare', 'Low avalanche danger');
    case 2:
      return translate('Moderat skredfare', 'Moderate avalanche danger');
    case 3:
      return translate('Betydelig skredfare', 'Considerable avalanche danger');
    case 4:
      return translate('Stor skredfare', 'High avalanche danger');
    case 5:
      return translate('Meget stor skredfare', 'Very high avalanche danger');
    default:
      return translate('Ikke vurdert', 'Not assessed');
  }
}
