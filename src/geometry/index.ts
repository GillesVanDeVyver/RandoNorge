import type { LatLng, Route, Segment } from '../types';

// WGS84 haversine distance in meters.
export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Project lat/lng to local meters using an equirectangular approximation
// around the segment's mean latitude. Good enough for RDP at ski-tour scales.
function project(points: LatLng[]): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const meanLat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const latToM = 110540;
  const lngToM = 111320 * Math.cos((meanLat * Math.PI) / 180);
  return points.map(([lat, lng]) => ({ x: lng * lngToM, y: lat * latToM }));
}

function perpendicularDistanceSq(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const tt = Math.max(0, Math.min(1, t));
  const fx = a.x + tt * dx;
  const fy = a.y + tt * dy;
  const ex = p.x - fx;
  const ey = p.y - fy;
  return ex * ex + ey * ey;
}

// Total length of a polyline in meters.
export function segmentLength(seg: Segment): number {
  let total = 0;
  for (let i = 1; i < seg.length; i++) total += haversine(seg[i - 1], seg[i]);
  return total;
}

// Resample a polyline at fixed-distance intervals (meters). The returned
// points are linearly interpolated along the original segments and always
// include the original start and end vertices.
export function resample(seg: Segment, intervalM: number): Segment {
  if (seg.length < 2) return seg.slice();
  const out: Segment = [seg[0]];
  let carry = 0; // distance accumulated since the last emitted point
  for (let i = 1; i < seg.length; i++) {
    const a = seg[i - 1];
    const b = seg[i];
    const d = haversine(a, b);
    if (d === 0) continue;
    let traveled = -carry; // start sampling so first hit is at intervalM past last emit
    while (traveled + intervalM <= d) {
      traveled += intervalM;
      const t = traveled / d;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    carry = d - traveled;
  }
  const last = seg[seg.length - 1];
  const tail = out[out.length - 1];
  if (last[0] !== tail[0] || last[1] !== tail[1]) out.push(last);
  return out;
}

// Where a point projects onto a route: the nearest location on any edge.
// Distances "along" the route are cumulative within-segment haversine sums
// (segment gaps contribute nothing) — the same convention the elevation
// profile uses for its x-axis, so the two stay aligned.
export interface RouteProjection {
  /** Nearest point on the route. */
  point: LatLng;
  /** Straight-line distance from the query point, meters. */
  distanceM: number;
  /** Along-route distance of `point` from the route start, meters. */
  alongM: number;
}

// When choosing where a position projects onto the route, candidates whose
// straight-line distance is within this tolerance of the best are treated
// as ties, and the earliest (smallest along-route distance) wins. On
// out-and-back routes the outbound and return legs overlap, so a pure
// nearest-point search could jump progress to the return leg; preferring
// the minimal advance keeps progress honest (it can always catch up).
const AHEAD_TIE_TOLERANCE_M = 25;

// Find the closest point on the route to `p`, restricted to the part of
// the route between `minAlongM` and `maxAlongM` (a forward search window —
// pass Infinity for no upper bound). Uses the same equirectangular
// approximation as `project` (planar math around the query latitude),
// accurate to well under a metre at ski-tour scales. O(N) over all route
// vertices — cheap enough to run per GPS fix. Returns null when the route
// has no edges in the window.
export function projectOntoRouteAhead(
  route: Route,
  p: LatLng,
  minAlongM = 0,
  maxAlongM = Infinity,
): RouteProjection | null {
  const latToM = 110540;
  const lngToM = 111320 * Math.cos((p[0] * Math.PI) / 180);
  const px = p[1] * lngToM;
  const py = p[0] * latToM;

  let cum = 0;
  let best: RouteProjection | null = null;
  let bestD = Infinity;

  for (const seg of route) {
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1];
      const b = seg[i];
      const edgeLen = haversine(a, b);
      const cumStart = cum;
      cum += edgeLen;
      if (edgeLen === 0) continue;
      if (cum < minAlongM) continue; // edge lies wholly behind the window
      if (cumStart > maxAlongM) continue; // edge lies wholly past the window

      const ax = a[1] * lngToM;
      const ay = a[0] * latToM;
      const bx = b[1] * lngToM;
      const by = b[0] * latToM;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      // Clamp to the part of the edge inside the window so a partially
      // covered edge can't project outside it.
      const tMin = Math.max(0, Math.min(1, (minAlongM - cumStart) / edgeLen));
      const tMax = Math.max(
        tMin,
        Math.min(1, (maxAlongM - cumStart) / edgeLen),
      );
      if (t < tMin) t = tMin;
      if (t > tMax) t = tMax;

      const fx = ax + t * dx;
      const fy = ay + t * dy;
      const d = Math.hypot(px - fx, py - fy);
      if (d < bestD - AHEAD_TIE_TOLERANCE_M) {
        bestD = d;
        best = {
          point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
          distanceM: d,
          alongM: cumStart + t * edgeLen,
        };
      }
    }
  }
  return best;
}

// Split a route at an along-route distance into the part already passed
// (from the start up to the split point) and the remainder (from the split
// point onward). Segment order is taken as travel order — segment 0 first,
// drawn start to end. Distances follow the same within-segment convention
// as projectOntoRouteAhead.
export function splitRouteAtDistance(
  route: Route,
  alongM: number,
): { done: Route; remaining: Route } {
  const done: Route = [];
  const remaining: Route = [];
  let cum = 0;
  let past = alongM <= 0; // already beyond the split point?

  for (const seg of route) {
    if (past) {
      remaining.push(seg);
      continue;
    }
    if (seg.length < 2) {
      done.push(seg);
      continue;
    }
    const before: Segment = [seg[0]];
    let after: Segment | null = null;
    for (let i = 1; i < seg.length; i++) {
      if (after) {
        after.push(seg[i]);
        continue;
      }
      const d = haversine(seg[i - 1], seg[i]);
      if (cum + d <= alongM) {
        cum += d;
        before.push(seg[i]);
        continue;
      }
      const t = d > 0 ? (alongM - cum) / d : 0;
      const a = seg[i - 1];
      const b = seg[i];
      const split: LatLng = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ];
      if (t > 0) before.push(split);
      after = [split, seg[i]];
    }
    if (after) {
      if (before.length >= 2) done.push(before);
      remaining.push(after);
      past = true;
    } else {
      done.push(seg); // entire segment lies before the split point
    }
  }
  return { done, remaining };
}

// Ramer–Douglas–Peucker simplification, epsilon in meters.
export function simplify(points: Segment, epsilonMeters = 8): Segment {
  if (points.length <= 2) return points.slice();
  const proj = project(points);
  const eps2 = epsilonMeters * epsilonMeters;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    if (j - i < 2) continue;
    let maxD = 0;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = perpendicularDistanceSq(proj[k], proj[i], proj[j]);
      if (d > maxD) {
        maxD = d;
        idx = k;
      }
    }
    if (maxD > eps2 && idx !== -1) {
      keep[idx] = 1;
      stack.push([i, idx]);
      stack.push([idx, j]);
    }
  }
  const out: Segment = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}
