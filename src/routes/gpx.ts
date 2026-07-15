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

/** Thrown for anything wrong with the file so the UI can show a message. */
export class GpxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GpxParseError';
  }
}

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
 * @throws {GpxParseError} if the text is not valid GPX or holds no usable
 *   track/route with at least two points.
 */
export function parseGpx(text: string): Route {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml');
  } catch {
    throw new GpxParseError("This file couldn't be read as GPX.");
  }

  // DOMParser reports malformed XML as a <parsererror> node rather than
  // throwing, so check for it explicitly.
  if (doc.querySelector('parsererror')) {
    throw new GpxParseError("This file isn't valid XML — it may be corrupted.");
  }
  if (doc.documentElement?.nodeName.toLowerCase() !== 'gpx') {
    throw new GpxParseError("This doesn't look like a GPX file.");
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
    throw new GpxParseError(
      'No track or route with at least two points was found in this file.',
    );
  }

  return route;
}

/** Read a File as text and parse it as GPX. */
export async function importGpxFile(file: File): Promise<Route> {
  const text = await file.text();
  return parseGpx(text);
}
