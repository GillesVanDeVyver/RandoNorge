// Which way the guide was reading the elevation profile when they opened the
// export.
//
// The profile panel offers two vertical scales, and they answer different
// questions. "Riktig skala" draws a metre up the same length as a metre along,
// so a 45° slope is a 45° line and the eye can judge the climb; "Tilpass" fills
// a fixed strip whatever the relief, so a rolling ridge is legible instead of
// being a flat thread. Neither is the truer picture of a tour — they are two
// readings of it, and which one a briefing wants is the same judgement the
// person at the screen has already made.
//
// So the export starts where they are, exactly as it starts on the camera angle
// they left the 3D view at (see terrainCamera.ts). Same reasoning, same
// deliberate limits: memory only, and nothing here is a stored preference. A
// reload starts again from the profile panel's own default, which is "Tilpass".
//
// Unlike the camera, this needs no guard against belonging to another tour: a
// vertical scale is a way of looking at any profile, not a place. Point it at a
// different route and it is still the reading the guide asked for.

export type ProfileScale = 'true' | 'fit';

let remembered: ProfileScale | null = null;

/** Called by the profile panel whenever the guide picks a scale. */
export function rememberProfileScale(scale: ProfileScale): void {
  remembered = scale;
}

/** Forget the choice — used by the tests, and by anything that wants the
 *  panel's own default back. */
export function forgetProfileScale(): void {
  remembered = null;
}

/**
 * The scale the profile is currently being read at, or null when the guide has
 * not chosen one this session.
 *
 * Null is not "fit": it is "nobody has said", which lets the caller fall back to
 * its own default rather than having this module assert one on its behalf.
 */
export function recallProfileScale(): ProfileScale | null {
  return remembered;
}
