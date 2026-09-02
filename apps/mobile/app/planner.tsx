// `/planner` — the phone's counterpart to apps/web's RoutePlannerPage.
//
// A BLANK PLANNER IS THE SAME PLANNER. This file used to be a stub, and the
// thing that ended the stub was not new screen code but the realisation that a
// planner with no route loaded is the planner with `routeId === null`: the map,
// the layer pill, the pencil, the eraser, the elevation profile and the
// forecast cards are all wanted here exactly as they are wanted over a saved
// tour, and the only differences — where the camera opens, and whether saving
// creates or updates — are two decisions inside src/ui/Planner.tsx rather than
// two screens.
//
// That is also how the web does it: one App.tsx serves both, keyed on whether
// there is a route id. Splitting them on the phone would have meant a second
// copy of the map, the layers and the profile, and the second copy is the one
// that quietly stops matching.
//
// WHAT THIS FILE STILL OWNS is the route's existence and its header title,
// which app/_layout.tsx registers as "Planlegg"/"Plan". The planner only
// overrides that title when it has a saved route's name to put there, so a
// blank planner keeps it.

import { Planner } from '../src/ui/Planner';

export default function PlannerScreen() {
  return <Planner routeId={null} />;
}
