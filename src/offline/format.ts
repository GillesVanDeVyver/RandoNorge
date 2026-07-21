// Shared formatting helpers for the offline-maps feature. Kept in one place so
// the download form, the planner's manager panel and the offline maps page all
// render sizes identically.

/** Human-readable byte size, e.g. "742 B", "18 KB", "124.3 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "Zoom level" is meaningless to a hiker, so map detail is presented as a
// real-world ground resolution instead. Ground resolution of a standard 256 px
// web-mercator tile is circumference · cos(lat) / (256 · 2^zoom). We evaluate
// it at a representative Norwegian latitude (~65°N) so the number shown roughly
// matches what people actually get in the field.
const NORWAY_LAT_RAD = (65 * Math.PI) / 180;
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6378137;

/** Approximate ground resolution (metres per pixel) at a given zoom. */
export function metresPerPixel(zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(NORWAY_LAT_RAD)) / (256 * 2 ** zoom);
}

/** Human-friendly finest-resolution label for a given max zoom, e.g.
 * "≈1 m per pixel", "≈8.1 m per pixel", "≈65 m per pixel". */
export function formatResolution(zoom: number): string {
  const m = metresPerPixel(zoom);
  if (m >= 10) return `≈${Math.round(m)} m per pixel`;
  if (m >= 1) return `≈${m.toFixed(1)} m per pixel`;
  return `≈${Math.round(m * 100)} cm per pixel`;
}
