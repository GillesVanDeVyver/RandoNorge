// Single entry point the UI uses to import a route file, dispatching to the
// right parser by file extension: GPX and TCX are text/XML, FIT is binary.
// All three parsers surface problems as a RouteImportError whose message is
// safe to show the user directly.

import type { Route } from '../types';
import { translate } from '../i18n/locale.ts';
import { RouteImportError } from './errors';
import { parseGpx } from './gpx';
import { parseTcx } from './tcx';
import { parseFit } from './fit';

export { RouteImportError } from './errors';

/** File extensions (and their MIME types) the importer accepts. */
export const IMPORT_ACCEPT =
  '.gpx,.tcx,.fit,application/gpx+xml,application/vnd.garmin.tcx+xml,application/vnd.ant.fit,application/xml,text/xml';

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * A picked file, as much of one as this module needs: a name to dispatch on and
 * two ways to read it. A browser `File` satisfies it exactly, which is what
 * lets the web app keep passing one straight in — and is the whole of the
 * adapter that keeps the three parsers free of the DOM. React Native's document
 * picker returns a URI instead, so Phase 3 wraps it in this shape.
 */
export interface ImportableFile {
  /** Used only for its extension. */
  name: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Read a file and parse it into a Route based on its extension.
 *
 * @throws {RouteImportError} for an unsupported extension, or whatever the
 *   underlying parser throws for a malformed file.
 */
export async function importRouteFile(file: ImportableFile): Promise<Route> {
  switch (extensionOf(file.name)) {
    case 'gpx':
      return parseGpx(await file.text());
    case 'tcx':
      return parseTcx(await file.text());
    case 'fit':
      return parseFit(await file.arrayBuffer());
    default:
      throw new RouteImportError(
        translate(
          'Filtypen støttes ikke – velg en GPX-, TCX- eller FIT-fil.',
          'Unsupported file type — please choose a GPX, TCX, or FIT file.',
        ),
      );
  }
}
