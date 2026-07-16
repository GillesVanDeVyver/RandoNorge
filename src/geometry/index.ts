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
export interface RouteProjection {
  /** Nearest point on the route. */
  point: LatLng;
  /** Straight-line distance from the query point, meters. */
  distanceM: number;
  /** Index of the segment containing the nearest edge. */
  segmentIndex: number;
  /** Index of the edge's start vertex within that segment. */
  vertexIndex: number;
  /** Interpolation factor along that edge, in [0, 1]. */
  t: number;
}

// Find the closest point on a route to `p`. Uses the same equirectangular
// approximation as `project` (planar math around the query latitude), which
// is accurate to well under a metre at ski-tour scales. O(N) over all
// route vertices — cheap enough to run per GPS fix. Returns null for an
// empty route.
export function projectOntoRoute(route: Route, p: LatLng): RouteProjection | null {
  const latToM = 110540;
  const lngToM = 111320 * Math.cos((p[0] * Math.PI) / 180);
  const px = p[1] * lngToM;
  const py = p[0] * latToM;

  let best: RouteProjection | null = null;
  let bestD2 = Infinity;

  for (let s = 0; s < route.length; s++) {
    const seg = route[s];
    if (seg.length === 0) continue;
    let ax = seg[0][1] * lngToM;
    let ay = seg[0][0] * latToM;
    if (seg.length === 1) {
      const d2 = (px - ax) ** 2 + (py - ay) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = {
          point: seg[0],
          distanceM: 0,
          segmentIndex: s,
          vertexIndex: 0,
          t: 0,
        };
      }
      continue;
    }
    for (let i = 1; i < seg.length; i++) {
      const bx = seg[i][1] * lngToM;
      const by = seg[i][0] * latToM;
      const dx = bx - ax;
      const dy = by - ay;
      let t = 0;
      const len2 = dx * dx + dy * dy;
      if (len2 > 0) {
        t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
      }
      const fx = ax + t * dx;
      const fy = ay + t * dy;
      const d2 = (px - fx) ** 2 + (py - fy) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        const a = seg[i - 1];
        const b = seg[i];
        best = {
          point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
          distanceM: 0, // filled in below
          segmentIndex: s,
          vertexIndex: i - 1,
          t,
        };
      }
      ax = bx;
      ay = by;
    }
  }

  if (best) best.distanceM = Math.sqrt(bestD2);
  return best;
}

// Split a route at a projection into the part already passed (segments and
// vertices before the projected point, ending at it) and the remainder
// (starting at the projected point). Segment order is taken as travel
// order — segment 0 first, drawn start to end.
export function splitRouteAt(
  route: Route,
  proj: RouteProjection,
): { done: Route; remaining: Route } {
  const done: Route = route.slice(0, proj.segmentIndex);
  const remaining: Route = [];

  const seg = route[proj.segmentIndex];
  const before = seg.slice(0, proj.vertexIndex + 1);
  before.push(proj.point);
  if (before.length >= 2) done.push(before);

  const after: Segment = [proj.point, ...seg.slice(proj.vertexIndex + 1)];
  // When t === 1 the projected point coincides with the next vertex; the
  // duplicate first point is harmless for Polyline rendering.
  if (after.length >= 2) remaining.push(after);

  for (let s = proj.segmentIndex + 1; s < route.length; s++) {
    remaining.push(route[s]);
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
