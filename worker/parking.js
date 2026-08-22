// Parking areas by bounding box, from the D1 "parking" table (migration 0009).
//
//   GET /api/parking?minLat=&maxLat=&minLon=&maxLon=[&limit=]
//     → { areas: [...], fetchedAt: <epoch ms>, source: 'osm', attribution }
//
// This replaces the live NVDB proxy the parking tab shipped against. NVDB is
// the road authority's register of the lots it administers and misses the
// trailhead lots a tour planner needs — Innerdalen among them. OSM has them;
// docs/parking-data-sources.md has the measurement. The data is extracted
// monthly from the Geofabrik Norway PBF by scripts/parking/build_parking_-
// extract.py and loaded into D1, because OSM's live query interface
// (Overpass) forbids production application traffic in its fair-use policy.
//
// No session required: parking areas are public facts about the world and the
// same rows go to everyone. Rate limited per IP anyway, because an unbounded
// bbox endpoint is otherwise a convenient way to dump the whole table.
//
// WHY THIS RETURNS A BOX AND NOT A RADIUS. The client asks "what is within N
// km of here", and it would be one line of SQL to answer that here. It must
// not. "Distance from this point to this OSM car park" is a value derived
// from a private route and OSM data together; computing it server-side would
// put it in the response, the response goes in the 24 h edge cache, and the
// cache is then holding an artifact that is arguably a derivative of an ODbL
// database rather than a copy of one. Instead the Worker answers a purely
// geographic question whose answer depends on nothing of the user's, the
// client rounds the box out of the requested radius, and the haversine runs
// in the browser and dies with the tab (src/parking/api.ts).
//
// That is a deliberate design choice, not a settled reading of ODbL — the
// OSMF guidelines say nothing about spatial operations. It costs nothing and
// it keeps the cached artifact obviously clean, which is the point.

import { rateLimit, clientIp } from './rateLimit.js';

// A bbox is capped so this cannot be used to page through the country. 2
// degrees of latitude is ~222 km, comfortably more than the 10 km maximum
// radius the UI offers even at its widest, and small enough that no single
// query returns a meaningful fraction of the table.
const MAX_SPAN_DEG = 2;
// Norway plus Svalbard and Jan Mayen, matching the build script's filter.
const LAT_MIN = 57;
const LAT_MAX = 81;
const LON_MIN = -10;
const LON_MAX = 36;
// The UI asks for 5; the extra headroom lets the client filter the box down
// to a circle and still have candidates left over.
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';

export async function handleParkingApi(request, env, url) {
  if (request.method !== 'GET') {
    return Response.json(
      { error: 'method not allowed' },
      { status: 405, headers: { Allow: 'GET' } },
    );
  }

  const box = parseBbox(url.searchParams);
  if (typeof box === 'string') {
    return Response.json({ error: box }, { status: 400 });
  }
  const limit = parseLimit(url.searchParams.get('limit'));
  if (limit === null) {
    return Response.json({ error: 'invalid limit' }, { status: 400 });
  }

  // Generous: panning the map re-queries, and each query is one indexed range
  // scan. This is a ceiling on scripted abuse, not a budget for browsing.
  const { allowed, resetAt } = await rateLimit(
    env,
    `parking:${clientIp(request)}`,
    120,
    60,
  );
  if (!allowed) {
    const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    return Response.json(
      { error: 'too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  try {
    // Column order matches the client's ParkingArea, minus distanceM, which
    // the browser computes. "lat"/"lon" lead so the index on ("lat", "lon")
    // is the obvious plan.
    const { results } = await env.DB.prepare(
      'select "id", "source", "lat", "lon", "name", "capacity", "fee", ' +
        '"surface", "access", "operator", "usage", "payment", "maxstay" ' +
        'from "parking" ' +
        'where "lat" between ? and ? and "lon" between ? and ? ' +
        'limit ?',
    )
      .bind(box.minLat, box.maxLat, box.minLon, box.maxLon, limit)
      .all();

    return Response.json(
      {
        areas: results ?? [],
        // When the *data* was served, not when it was surveyed. The client
        // shows it so a stale tab is visibly stale; the underlying OSM survey
        // date is not carried per row and pretending otherwise would be worse
        // than saying nothing.
        fetchedAt: Date.now(),
        source: 'osm',
        attribution: ATTRIBUTION,
      },
      {
        headers: {
          // The table changes once a month at most and the answer depends on
          // nothing but the box, so this is exactly the sort of thing an edge
          // cache is for. 24 h, and a stale-while-revalidate day on top so a
          // refresh deploy never makes anyone wait.
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=86400',
          // ODbL attribution travels with the data, not only in the UI, so a
          // response inspected on its own still says where it came from.
          'X-Data-Source': 'OpenStreetMap',
          'X-Data-License': 'ODbL-1.0',
        },
      },
    );
  } catch (err) {
    console.error('parking api error:', err);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}

/** Parse and sanity-check the four bbox parameters. Returns the box, or a
 *  string describing what was wrong with it. */
function parseBbox(params) {
  const minLat = num(params.get('minLat'));
  const maxLat = num(params.get('maxLat'));
  const minLon = num(params.get('minLon'));
  const maxLon = num(params.get('maxLon'));
  if (minLat === null || maxLat === null || minLon === null || maxLon === null) {
    return 'minLat, maxLat, minLon and maxLon are required numbers';
  }
  if (minLat > maxLat || minLon > maxLon) return 'inverted bounding box';
  if (maxLat - minLat > MAX_SPAN_DEG || maxLon - minLon > MAX_SPAN_DEG) {
    return `bounding box larger than ${MAX_SPAN_DEG} degrees`;
  }
  // Clamp rather than reject: a box straddling the coverage edge is a normal
  // query from someone near the border, not a bad request.
  return {
    minLat: Math.max(minLat, LAT_MIN),
    maxLat: Math.min(maxLat, LAT_MAX),
    minLon: Math.max(minLon, LON_MIN),
    maxLon: Math.min(maxLon, LON_MAX),
  };
}

function num(value) {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseLimit(raw) {
  if (raw === null || raw.trim() === '') return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) return null;
  return n;
}
