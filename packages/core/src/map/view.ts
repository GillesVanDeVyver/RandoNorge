// Where a map opens when it has nothing of its own to open on.
//
// Three numbers, and every one of them was written more than once before this
// file existed. `[65, 13]` and its zoom appear in apps/web's Map.tsx and again
// in OfflineMapsPage.tsx, as two independent `INITIAL_CENTER` constants that
// happen to agree; the phone's blank planner would have been the third copy,
// and the first one able to disagree without anybody noticing, because nothing
// renders the two clients side by side.
//
// The parity plan's rule is that anything non-visual crosses into
// packages/core and the web switches to it in the same change, and "where the
// map stands before the user has said anything" is exactly that: not a colour,
// not a layout, a decision about the product. So it is here, and both web call
// sites now import it.
//
// ZOOM IS IN MAPLIBRE'S SCALE, which is the one thing about this file that can
// catch you out. Leaflet numbers its levels one higher than MapLibre does for
// the same ground scale — 256px tiles against 512px tiles — so the web reads
// these through `toLeafletZoom()` in apps/web/src/viewCamera.ts, which is where
// that conversion already lived. MapLibre's own scale is the right one to store
// because two of the three clients (the web's 3D view, the phone) speak it
// natively, and because a stored number that needs converting on the majority
// of its readers is a number stored in the wrong unit.

import type { LatLng } from '../types';

/**
 * The middle of Norway, near enough: 65°N 13°E is in the Helgeland mountains,
 * a little inland of Mo i Rana. Paired with `INITIAL_ZOOM` it frames the whole
 * country, which is the honest thing to show someone whose position is unknown
 * — the alternative is guessing a region and being wrong for most of the
 * people who open the app.
 *
 * `LatLng`, so lat first, in core's own order. MapLibre and GeoJSON both want
 * [lng, lat]; transpose at the call site, once, as everything else here does.
 */
export const INITIAL_CENTER: LatLng = [65, 13];

/**
 * All of Norway in one screen, in MapLibre's scale. The web asks for
 * `toLeafletZoom(INITIAL_ZOOM)` — 5 — which is the number its map used to have
 * typed into it.
 */
export const INITIAL_ZOOM = 4;

/**
 * And where the map goes once it knows where you are: close enough that a
 * drawn line means something on the ground — roughly two kilometres across a
 * phone — and wide enough to see the next valley over, which is usually where
 * the tour is going.
 *
 * Deliberately further out than the web's navigation follow zoom (15 in
 * Leaflet, 14 here). Following a track wants the next hundred metres; planning
 * one wants the shape of the terrain, and starting too close means the first
 * gesture is always a pinch.
 */
export const LOCATED_ZOOM = 13;
