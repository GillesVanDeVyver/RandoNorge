/**
 * Persistence for the pencil's drawing style (freehand ↔ straight lines).
 *
 * The choice is a long-lived personal preference rather than part of a
 * route, so it lives in localStorage next to the language setting — a user
 * who prefers clicking vertices the norgeskart way gets that pencil back on
 * every visit. Reads and writes are defensive: localStorage throws in
 * private-mode / sandboxed contexts, and a failure there must never stop
 * the planner from loading.
 */

import type { DrawStyle } from '@fjellrute/core/types';

const STORAGE_KEY = 'randonorge:draw-style';

/** App default: the original fluent freehand pencil. */
const DEFAULT_STYLE: DrawStyle = 'freehand';

function isDrawStyle(value: unknown): value is DrawStyle {
  return value === 'freehand' || value === 'lines';
}

/** The stored preference, or the freehand default when there is none. */
export function loadDrawStyle(): DrawStyle {
  if (typeof window === 'undefined') return DEFAULT_STYLE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isDrawStyle(stored)) return stored;
  } catch {
    // localStorage unavailable — fall through to the default.
  }
  return DEFAULT_STYLE;
}

/** Remember the user's choice for the next session. */
export function storeDrawStyle(style: DrawStyle): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // Preference simply won't persist; not worth surfacing.
  }
}
