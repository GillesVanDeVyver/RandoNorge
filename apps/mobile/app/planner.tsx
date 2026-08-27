// `/planner` — the phone's counterpart to apps/web's RoutePlannerPage.
//
// A STUB ON PURPOSE, and the reason it exists as a file at all is that the
// route, not the screen, is what this phase delivers. The web's planner is the
// largest view in the app: a draggable waypoint layer over the map, live
// distance and ascent as the line changes, the elevation profile, and the
// snow/avalanche/weather readouts along the drawn route. Every one of those has
// a phase of its own further down docs/mobile-web-parity-plan.md, and none of
// them can be started before the phone agrees with the web about where the
// planner LIVES. That agreement is this file.
//
// It is also what makes the hub honest: a card that navigates to a real screen
// saying "not yet" is a promise with a date on it, where a card that navigates
// nowhere is a bug, and a card that isn't there at all hides the gap. The
// harness counts routes against the web's view set, so this stub is the thing
// that makes the count true rather than the thing that fakes it.
//
// WHEN IT BECOMES REAL, this file gets the planner and `ComingSoon` stops being
// imported here. Nothing else about the shell has to move.

import { useT } from '@fjellrute/core/i18n';
import { ComingSoon } from './index';

export default function PlannerScreen() {
  const t = useT();

  return (
    <ComingSoon
      title={t('Ruteplanlegging kommer', 'Route planning is coming')}
      // Says WHERE to do this today rather than only that the phone cannot.
      // Someone who opened this card wants to plan a tour, and the web app can
      // already do it — the routes they draw there are the ones that show up
      // under Saved routes on this phone.
      text={t(
        'Tegn ruter på fjellrute.no for nå. Turene du lagrer der finner du under «Lagrede ruter» her.',
        'Draw routes at fjellrute.no for now. The tours you save there appear under “Saved routes” here.',
      )}
    />
  );
}
