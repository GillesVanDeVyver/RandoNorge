// Parser for GPX files (GPS Exchange Format) into the app's in-memory
// `Route` shape (segments of [lat, lng]), so a recorded or planned track
// can be opened in the planner exactly like a hand-drawn route.
//
// Mapping to the route model:
//   - Each <trk> can hold several <trkseg> (recording gaps split a track
//     into segments). Every <trkseg> becomes one route segment, which lines
//     up one-to-one with the MultiLineString the save API stores — so eraser
//     gaps and recording gaps share the same representation.
//   - If a file has no track (a planned route export), we fall back to its
//     <rte> route(s): each <rte> becomes one segment built from its <rtept>.
//
// Elevation is intentionally ignored: the app recomputes elevation, stats,
// snow, etc. from the coordinates via its own pipeline once the route is on
// the map, so any <ele> values in the file would just be discarded anyway.
//
// Coordinates are simplified with the same RDP epsilon drawn routes get, so
// second-by-second recordings (tens of thousands of points) shrink to a size
// that stays well under the save API's payload cap and keeps the map snappy.

import { simplify } from '../geometry';
import type { LatLng, Route, Segment } from '../types';
import { translate } from '../i18n/locale.ts';
import { RouteImportError } from './errors';

// Match the drawn-route simplification tolerance (see geometry/index.ts).
const SIMPLIFY_EPSILON_M = 8;

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Read lat/lng from a <trkpt>/<rtept>/<wpt> element, or null if malformed. */
function pointFrom(el: Element): LatLng | null {
  const lat = parseFloat(el.getAttribute('lat') ?? '');
  const lng = parseFloat(el.getAttribute('lon') ?? '');
  if (!isValidLatLng(lat, lng)) return null;
  return [lat, lng];
}

/** Turn a list of point elements into a simplified segment (>= 2 points). */
function toSegment(points: Element[]): Segment | null {
  const seg: Segment = [];
  for (const el of points) {
    const p = pointFrom(el);
    if (p) seg.push(p);
  }
  if (seg.length < 2) return null;
  return simplify(seg, SIMPLIFY_EPSILON_M);
}

/**
 * Parse GPX text into a Route. Tracks (<trk>/<trkseg>) are preferred; if the
 * file has none, planned routes (<rte>) are used instead.
 *
 * @throws {RouteImportError} if the text is not valid GPX or holds no usable
 *   track/route with at least two points.
 */
export function parseGpx(text: string): Route {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml');
  } catch {
    throw new RouteImportError(
      translate(
        'Denne fila kunne ikke leses som GPX.',
        "This file couldn't be read as GPX.",
      ),
    );
  }

  // DOMParser reports malformed XML as a <parsererror> node rather than
  // throwing, so check for it explicitly.
  if (doc.querySelector('parsererror')) {
    throw new RouteImportError(
      translate(
        'Denne fila er ikke gyldig XML – den kan være ødelagt.',
        "This file isn't valid XML — it may be corrupted.",
      ),
    );
  }
  if (doc.documentElement?.nodeName.toLowerCase() !== 'gpx') {
    throw new RouteImportError(
      translate(
        'Dette ser ikke ut som en GPX-fil.',
        "This doesn't look like a GPX file.",
      ),
    );
  }

  const route: Route = [];

  // Preferred source: recorded tracks. One segment per <trkseg>.
  for (const seg of Array.from(doc.getElementsByTagName('trkseg'))) {
    const s = toSegment(Array.from(seg.getElementsByTagName('trkpt')));
    if (s) route.push(s);
  }

  // Fallback: planned routes. One segment per <rte>.
  if (route.length === 0) {
    for (const rte of Array.from(doc.getElementsByTagName('rte'))) {
      const s = toSegment(Array.from(rte.getElementsByTagName('rtept')));
      if (s) route.push(s);
    }
  }

  if (route.length === 0) {
    throw new RouteImportError(
      translate(
        'Fant ingen spor eller rute med minst to punkter i denne fila.',
        'No track or route with at least two points was found in this file.',
      ),
    );
  }

  return route;
}

/** Read a File as text and parse it as GPX. */
export async function importGpxFile(file: File): Promise<Route> {
  const text = await file.text();
  return parseGpx(text);
}

// ---------------------------------------------------------------------------
// Export
//
// The inverse of parseGpx: turn a route into a GPX 1.1 document. Routes are
// written as a single <trk> with one <trkseg> per segment, which is exactly
// what parseGpx prefers on the way back in — so a route exported here and
// re-imported keeps its segment structure (eraser/recording gaps intact).
//
// Elevation is optional. The app discards <ele> on import (it recomputes its
// own profile), but other tools (Garmin, Strava, komoot…) use it, so when the
// caller has a computed profile we write <ele> for each point.
// ---------------------------------------------------------------------------

/** One exported track point. `ele` (meters) is written as <ele> when present. */
export interface GpxTrackPoint {
  lat: number;
  lng: number;
  ele?: number | null;
}

export interface GpxExportOptions {
  /** Written to <metadata><name> and <trk><name>. Defaults to "Route". */
  name?: string;
  /** Written to <metadata><desc> and <trk><desc> when non-empty. */
  description?: string | null;
  /** Timestamp for <metadata><time>. Defaults to now. */
  time?: Date;
}

const GPX_CREATOR = 'Fjellrute';

/** Escape a string for use in XML text/attribute content. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Format a coordinate to ~1 cm precision without trailing-zero noise. */
function coord(n: number): string {
  return Number(n.toFixed(7)).toString();
}

/** Render one <trkpt> (with optional <ele>). */
function trackPoint(p: GpxTrackPoint): string {
  const ele =
    p.ele != null && Number.isFinite(p.ele)
      ? `<ele>${Number(p.ele.toFixed(1)).toString()}</ele>`
      : '';
  return (
    `      <trkpt lat="${coord(p.lat)}" lon="${coord(p.lng)}">` +
    `${ele}</trkpt>`
  );
}

/**
 * Serialize track segments into a GPX 1.1 document string. Each inner array
 * becomes one <trkseg>; empty segments (fewer than 1 point) are skipped.
 */
export function segmentsToGpx(
  segments: GpxTrackPoint[][],
  options: GpxExportOptions = {},
): string {
  const name = options.name?.trim() || 'Route';
  const desc = options.description?.trim();
  const time = (options.time ?? new Date()).toISOString();

  const meta =
    `  <metadata>\n` +
    `    <name>${escapeXml(name)}</name>\n` +
    (desc ? `    <desc>${escapeXml(desc)}</desc>\n` : '') +
    `    <time>${time}</time>\n` +
    `  </metadata>\n`;

  const trksegs = segments
    .filter((seg) => seg.length > 0)
    .map(
      (seg) =>
        `    <trkseg>\n${seg.map(trackPoint).join('\n')}\n    </trkseg>`,
    )
    .join('\n');

  const trk =
    `  <trk>\n` +
    `    <name>${escapeXml(name)}</name>\n` +
    (desc ? `    <desc>${escapeXml(desc)}</desc>\n` : '') +
    `${trksegs}\n` +
    `  </trk>\n`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="${escapeXml(GPX_CREATOR)}"\n` +
    `     xmlns="http://www.topografix.com/GPX/1/1"\n` +
    `     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n` +
    `     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 ` +
    `http://www.topografix.com/GPX/1/1/gpx.xsd">\n` +
    meta +
    trk +
    `</gpx>\n`
  );
}

/**
 * Convenience: serialize a plain Route (coordinates only, no elevation) to a
 * GPX track document.
 */
export function routeToGpx(route: Route, options?: GpxExportOptions): string {
  return segmentsToGpx(
    route.map((seg) => seg.map(([lat, lng]) => ({ lat, lng }))),
    options,
  );
}

/**
 * Turn a display name into a safe ".gpx" filename, e.g. "Galdhøpiggen loop"
 * → "galdhopiggen-loop.gpx". Falls back to "route.gpx".
 */
export function gpxFilename(name?: string | null): string {
  const slug = (name ?? '')
    .trim()
    .toLowerCase()
    // Norwegian letters don't decompose under NFKD (ø/æ are distinct letters,
    // not accented o/a), so map them explicitly before stripping.
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/å/g, 'a')
    .normalize('NFKD')
    // Strip combining marks (accents) left by the decomposition above.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'route'}.gpx`;
}
