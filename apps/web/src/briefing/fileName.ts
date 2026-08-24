// What the saved PDF is called.
//
// The briefing is printed through the browser, so the file name is whatever
// "Save as PDF" suggests, and what it suggests is the document title. The
// dialog therefore lends the document its own title for the length of the
// print — and this is the name it lends.
//
// <tour>_Fjellrute.pdf: the tour first, so a season's briefings sort by tour in
// a folder, and the app's name after it, so a sheet that has been mailed on
// still says where it came from.
//
// Kept here, pure and alone, because a file name is the one part of the export
// that cannot be checked by looking at the page.

/** Characters no file name may carry on Windows or macOS, plus the control
 *  range. Replaced with a dash rather than dropped: "Skåla 25/2" is a date, and
 *  "Skåla 252" would quietly say a different thing. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Longest tour name that reaches the file name. A route name is free text and
 *  occasionally a sentence; 64 characters is more than any tour needs and
 *  leaves the whole name, in any alphabet, inside the 255 *bytes* a filesystem
 *  will take — with room for the " (1)" a browser appends when the same tour is
 *  exported twice into the same folder. Multi-byte alphabets are why this
 *  counts characters conservatively rather than generously. */
const MAX_NAME = 64;

/** Name for the PDF, without the extension the browser adds itself. An unsaved
 *  route has no name to lend and saves as plain "Fjellrute". */
export function briefingFileName(routeName?: string | null): string {
  const cleaned = (routeName ?? '')
    .replace(FORBIDDEN, '-')
    // Collapse the runs a substitution can leave behind, and the leading or
    // trailing dots some filesystems treat as more than punctuation.
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, MAX_NAME)
    // The cut can land on a space or a dot, which would be trailing punctuation
    // in the finished name.
    .replace(/[.\s]+$/, '');
  return cleaned ? `${cleaned}_Fjellrute` : 'Fjellrute';
}
