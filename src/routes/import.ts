// Single entry point the UI uses to import a route file, dispatching to the
// right parser by file extension: GPX and TCX are text/XML, FIT is binary.
// All three parsers surface problems as a RouteImportError whose message is
// safe to show the user directly.

import type { Route } from '../types';
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
 * Read a File and parse it into a Route based on its extension.
 *
 * @throws {RouteImportError} for an unsupported extension, or whatever the
 *   underlying parser throws for a malformed file.
 */
export async function importRouteFile(file: File): Promise<Route> {
  switch (extensionOf(file.name)) {
    case 'gpx':
      return parseGpx(await file.text());
    case 'tcx':
      return parseTcx(await file.text());
    case 'fit':
      return parseFit(await file.arrayBuffer());
    default:
      throw new RouteImportError(
        'Unsupported file type — please choose a GPX, TCX, or FIT file.',
      );
  }
}
