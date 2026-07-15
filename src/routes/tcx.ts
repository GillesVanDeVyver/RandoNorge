// Parser for TCX files (Garmin Training Center XML) into the app's in-memory
// `Route` shape (segments of [lat, lng]), so a recorded activity or a planned
// course exported as TCX opens in the planner just like a GPX file.
//
// Mapping to the route model:
//   - TCX groups trackpoints under <Track> elements. An activity has one
//     <Track> per <Lap>; a course has a single <Track>. Each <Track> becomes
//     one route segment, matching how GPX <trkseg>s map to segments — a
//     recording gap (new lap/track) shows up as a segment break.
//   - A <Trackpoint> only contributes a point if it carries a <Position> with
//     latitude and longitude; points without GPS (indoor samples, pauses) are
//     skipped rather than treated as breaks.
//
// Elevation (<AltitudeMeters>) is ignored on purpose: the app recomputes
// elevation, stats and snow from the coordinates once the route is on the map,
// exactly as it does for GPX imports.

import { simplify } from '../geometry';
import type { LatLng, Route, Segment } from '../types';
import { RouteImportError } from './errors';

// Match the drawn-route / GPX simplification tolerance (see geometry/index.ts).
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

/** Read the numeric text content of the first child with the given tag name. */
function childNumber(parent: Element, tag: string): number | null {
  const el = parent.getElementsByTagName(tag)[0];
  if (!el || el.textContent === null) return null;
  const n = parseFloat(el.textContent);
  return Number.isFinite(n) ? n : null;
}

/** Read lat/lng from a <Trackpoint>'s <Position>, or null if absent/malformed. */
function pointFrom(trackpoint: Element): LatLng | null {
  const position = trackpoint.getElementsByTagName('Position')[0];
  if (!position) return null;
  const lat = childNumber(position, 'LatitudeDegrees');
  const lng = childNumber(position, 'LongitudeDegrees');
  if (lat === null || lng === null || !isValidLatLng(lat, lng)) return null;
  return [lat, lng];
}

/** Turn a <Track>'s trackpoints into a simplified segment (>= 2 points). */
function toSegment(track: Element): Segment | null {
  const seg: Segment = [];
  for (const tp of Array.from(track.getElementsByTagName('Trackpoint'))) {
    const p = pointFrom(tp);
    if (p) seg.push(p);
  }
  if (seg.length < 2) return null;
  return simplify(seg, SIMPLIFY_EPSILON_M);
}

/**
 * Parse TCX text into a Route. Every <Track> (activity laps and course tracks
 * alike) becomes one segment.
 *
 * @throws {RouteImportError} if the text is not valid TCX or holds no track
 *   with at least two positioned points.
 */
export function parseTcx(text: string): Route {
  const doc = new DOMParser().parseFromString(text, 'application/xml');

  // DOMParser reports malformed XML as a <parsererror> node rather than
  // throwing, so check for it explicitly.
  if (doc.querySelector('parsererror')) {
    throw new RouteImportError(
      "This file isn't valid XML — it may be corrupted.",
    );
  }
  if (doc.documentElement?.nodeName !== 'TrainingCenterDatabase') {
    throw new RouteImportError("This doesn't look like a TCX file.");
  }

  const route: Route = [];
  for (const track of Array.from(doc.getElementsByTagName('Track'))) {
    const s = toSegment(track);
    if (s) route.push(s);
  }

  if (route.length === 0) {
    throw new RouteImportError(
      'No track with at least two GPS points was found in this file.',
    );
  }

  return route;
}
