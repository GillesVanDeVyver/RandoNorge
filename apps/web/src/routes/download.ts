// Trigger a client-side file download from an in-memory string. Used to save
// exported GPX to disk without a server round-trip: we wrap the text in a Blob,
// point a hidden <a download> at an object URL, click it, then revoke the URL.

/**
 * Save `contents` to the user's downloads as `filename`.
 *
 * @param filename Suggested file name (the browser may adjust it).
 * @param contents File body.
 * @param mimeType MIME type for the Blob. Defaults to GPX.
 */
export function downloadTextFile(
  filename: string,
  contents: string,
  mimeType = 'application/gpx+xml',
): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // Firefox needs the anchor in the DOM for the programmatic click to fire.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the download has a chance to start first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
