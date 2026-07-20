// Shared formatting helpers for the offline-maps feature. Kept in one place so
// the download form, the planner's manager panel and the offline maps page all
// render sizes identically.

/** Human-readable byte size, e.g. "742 B", "18 KB", "124.3 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
