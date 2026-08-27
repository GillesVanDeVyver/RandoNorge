// `/completed` — the phone's counterpart to the web's `completed` view.
//
// A STUB, and for a different reason than /planner. The planner is unbuilt
// because it is enormous. This one is unbuilt because the phone cannot yet ASK:
// the client that lists recorded tracks is `listTracks` in
// apps/web/src/tracking/api.ts, which is in apps/web and not in packages/core,
// so there is nothing for this screen to import. Writing a fetch here instead
// would put non-visual logic inside apps/mobile, which is the one thing
// docs/mobile-web-parity-plan.md closes by forbidding.
//
// So the fix is known and it is not this file: move the tracking client into
// core and switch apps/web to it in the same commit, exactly as the plan
// prescribes, in the phase that renders completed tours. Until then the route
// exists and says so. Note that the web has a sixth view behind this one —
// `/completed/:id`, a single tour's planned-versus-actual overview — which is
// why this is a list screen's slot and not a leaf.

import { useT } from '@fjellrute/core/i18n';
import { ComingSoon } from './index';

export default function CompletedScreen() {
  const t = useT();

  return (
    <ComingSoon
      title={t('Fullførte ruter kommer', 'Completed routes are coming')}
      // Deliberately does not say "you have no completed routes". The phone has
      // not asked and does not know, and an empty state it cannot substantiate
      // would be a lie to anyone who has recorded tours on the web.
      text={t(
        'Turer du har registrert vises fortsatt bare på fjellrute.no. Toppboka kommer hit.',
        'Tours you have recorded still show only at fjellrute.no. Your summit log is on its way here.',
      )}
    />
  );
}
