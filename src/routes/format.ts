// Display formatting for saved-route metadata. Matches the preformatted
// examples the list UI was designed around: "12.4 km", "1 240 m",
// "12 Mar 2026".

/** Meters → "12.4 km" (one decimal; "—" when unknown). */
export function formatDistance(distanceM: number | null): string {
  if (distanceM === null || !Number.isFinite(distanceM)) return '—';
  return `${(distanceM / 1000).toFixed(1)} km`;
}

/** Meters → "1 240 m" with a thin-space thousands separator ("—" when unknown). */
export function formatAscent(ascentM: number | null): string {
  if (ascentM === null || !Number.isFinite(ascentM)) return '—';
  const rounded = Math.round(ascentM);
  const grouped = rounded
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
  return `${grouped} m`;
}

/** ms → "1:23:45" (or "23:45" under an hour; "—" when unknown). */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const totalS = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** m/s → "12.3 km/h" ("—" when unknown). */
export function formatSpeed(mps: number | null): string {
  if (mps === null || !Number.isFinite(mps)) return '—';
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

/** m/s → "5:30 min/km" moving pace ("—" when unknown or not moving). */
export function formatPace(mps: number | null): string {
  if (mps === null || !Number.isFinite(mps) || mps <= 0) return '—';
  const sPerKm = 1000 / mps;
  if (sPerKm > 6 * 3600) return '—'; // absurdly slow: effectively standing
  const totalS = Math.round(sPerKm);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m}:${s.toString().padStart(2, '0')} min/km`;
}

/** ISO timestamp → "12 Mar 2026" ("—" when unparseable). */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
