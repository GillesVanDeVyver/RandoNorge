// Parking areas near a route start, from OpenStreetMap.
//
// This replaced NVDB (Statens vegvesen, vegobjekttype 43) on 2026-08-22. The
// reason is coverage and nothing else: NVDB registers the parking the road
// authority administers, which is a different set from the lots a tour starts
// from. Innerdalen — 89 marked spaces, 75 NOK, one of the better-known
// trailheads in Trollheimen — was simply not in it, and the first thing a user
// did with the parking tab was notice. docs/parking-data-sources.md has the
// measurement: four candidate sources, one real lot, counts that can be re-run.
// OSM had 47.4k parking features nationally and had Innerdalen.
//
// HOW THE DATA GETS HERE. Not live. OSM's live query interface is Overpass,
// whose fair-use policy excludes production application traffic, so the data
// is extracted monthly from the Geofabrik Norway PBF
// (scripts/parking/build_parking_extract.py) into a D1 table (migration 0009)
// and served by worker/parking.js as a bounding-box query.
//
// WHY THE SERVER RETURNS A BOX AND THIS FILE MEASURES THE CIRCLE. The Worker
// could answer "within N km of this point" in one line of SQL. It deliberately
// does not. A distance from a private route start to an OSM car park is a
// value derived from both, and the Worker's answers are edge-cached for a day;
// keeping the cache holding nothing but plain OSM rows keeps the ODbL question
// uninteresting. So the box goes out, the haversine runs here, and the result
// lives in this module's Map until the tab closes. See worker/parking.js.
//
// THE LICENCE, BRIEFLY. OSM is ODbL 1.0 and share-alike. Fjellrute's routes
// stay proprietary under the OSMF Collective Database Guideline, which holds
// while parking is all-OSM or all-non-OSM within one regional cut — hence
// `source` below staying a mandatory discriminator, and hence NVDB being
// removed rather than kept as a gap-filler. Attribution is not optional:
// "© OpenStreetMap contributors" appears in the map credits and on the
// briefing sheet, and the extract itself is published under ODbL at
// /data/parking to satisfy §4.6.

import { haversine } from '@fjellrute/core/geometry';
import type { LatLng } from '@fjellrute/core/types';

// Served by the Worker in production and proxied there by the Vite dev server
// locally (vite.config.ts already forwards /api to localhost:8787).
const ENDPOINT = '/api/parking';

/** Where a parking area's record came from.
 *
 *  Still a mandatory discriminator now that there is only one source, and for
 *  a sharper reason than before: it is what makes "is the parking layer still
 *  single-sourced?" a question with a checkable answer. Under the OSMF
 *  Collective Database Guideline, a collection keeps each part's own licence
 *  only while the parts stay separable; blending a second parking source into
 *  the same feature type is what the Horizontal Map Layers Guideline treats as
 *  complementary, interacting layers, and that is the share-alike trigger.
 *  Widening this union is a licensing decision. Read the guidelines first. */
export type ParkingSource = 'osm';

export interface ParkingArea {
  /** `node/<id>` or `way/<id>` — the OSM element, which is also its permalink
   *  at https://www.openstreetmap.org/{id}. Stable within `source`. */
  id: string;
  source: ParkingSource;
  /** Representative point. Ways (the majority — most lots are mapped as an
   *  area) are reduced to the centroid of their nodes by the build script. */
  point: LatLng;
  /** Straight-line distance from the query origin, meters. Computed here, in
   *  the browser, per session — see the note at the top of this file. */
  distanceM: number;
  /** OSM `name`, falling back to `operator:short` then `ref`. Null is common
   *  and honest: most Norwegian lots are mapped as geometry with no name. */
  name: string | null;
  /** OSM `capacity`, parsed to the first integer it contains. */
  capacity: number | null;
  /** OSM `charge` when a mapper recorded an amount ("75 NOK"), else the raw
   *  `fee` value ("yes", "no", "seasonal"). Text, not a number: a price with
   *  no currency, no validity window and no survey date should not be
   *  presented as something the app can do arithmetic on. */
  fee: string | null;
  /** OSM `surface` — asphalt, gravel, ground. Matters in April, when a gravel
   *  lot at 900 m is still under snow and the asphalt one is not. */
  surface: string | null;
  /** OSM `access` where it restricts rather than forbids: "customers",
   *  "destination". Lots tagged private/no/permit never reach the table. */
  access: string | null;
  /** OSM `operator`. */
  operator: string | null;
  /** What the lot is for: `hiking`, `ski`, the `parking` kind, tourism tags,
   *  comma-joined. This is what distinguishes a trailhead from a shopping
   *  centre, and the `hiking=yes` / `ski=yes` convention is well used in
   *  Norway — it is a large part of why OSM won the comparison. */
  usage: string | null;
  /** Accepted payment methods from OSM `payment:*=yes`, comma-joined: app,
   *  credit_cards, coins. Norwegian trailhead lots are increasingly app-only,
   *  which is worth knowing before driving into a valley with no signal. */
  payment: string | null;
  /** OSM `maxstay`. */
  maxstay: string | null;
  /** Epoch ms when this result was retrieved. Cached results keep their
   *  original time so the UI reports honest data age.
   *
   *  Note what this is not: it is when *we* fetched the row, not when anyone
   *  last stood in the car park. OSM carries a per-element edit timestamp, but
   *  an edit is not a survey and the extract does not carry it, so the sheet
   *  says what it can defend. */
  fetchedAt: number;
}

/** One row as worker/parking.js serves it: the stored OSM facts, no distance.
 *  Field names match the D1 columns (migration 0009). */
interface ParkingRow {
  id?: unknown;
  source?: unknown;
  lat?: unknown;
  lon?: unknown;
  name?: unknown;
  capacity?: unknown;
  fee?: unknown;
  surface?: unknown;
  access?: unknown;
  operator?: unknown;
  usage?: unknown;
  payment?: unknown;
  maxstay?: unknown;
}

interface ParkingResponse {
  areas?: ParkingRow[];
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function toArea(
  row: ParkingRow,
  origin: LatLng,
  fetchedAt: number,
): ParkingArea | null {
  const id = text(row.id);
  const lat = typeof row.lat === 'number' ? row.lat : Number.NaN;
  const lon = typeof row.lon === 'number' ? row.lon : Number.NaN;
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const point: LatLng = [lat, lon];
  const capacity = typeof row.capacity === 'number' ? row.capacity : null;

  return {
    id,
    // Pinned rather than read from the row. The column is CHECK-constrained to
    // 'osm' in D1, so trusting the payload here would only add a way for the
    // discriminator to drift from the thing it is supposed to be guarding.
    source: 'osm',
    point,
    distanceM: haversine(origin, point),
    name: text(row.name),
    capacity: Number.isFinite(capacity as number) ? (capacity as number) : null,
    fee: text(row.fee),
    surface: text(row.surface),
    access: text(row.access),
    operator: text(row.operator),
    usage: text(row.usage),
    payment: text(row.payment),
    maxstay: text(row.maxstay),
    fetchedAt,
  };
}

/** Longitude/latitude half-spans of a `radiusM` box around `lat`.
 *
 *  A box, not a circle, because that is what the endpoint takes — and because
 *  a box is a question about the world rather than about the user's route.
 *  It over-fetches the corners by up to √2, which is harmless: every candidate
 *  is re-measured with a real haversine distance below and anything past the
 *  radius is dropped before the user sees it. */
function bboxHalfSpans(lat: number, radiusM: number) {
  const latDeg = radiusM / 110540;
  // Meridians converge toward the pole, so a fixed ground distance spans more
  // longitude the further north you are — the difference between Lindesnes and
  // Nordkapp is about a factor of two, so it cannot be approximated away.
  const lonDeg = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { latDeg, lonDeg };
}

// One page, no paging. A 10 km radius is a 20 km box, which in open country
// holds a handful of lots and in central Oslo could hold hundreds — but the
// caller only ever shows the five nearest, so truncation can only drop rows
// that were never going to be displayed.
const MAX_CANDIDATES = 500;

// (lat, lon, radius) → results. Quantized to ~100 m so nudging the route start
// by a metre doesn't re-query, and keyed with the radius because a wider search
// is a genuinely different question.
//
// No TTL: unlike a forecast, a car park does not change during a session. The
// edge cache in front of this holds 24 h, and the table behind it is rebuilt
// monthly, so a session-lifetime memo is the finest granularity that means
// anything. Being in-process is also the point — this Map holds the only
// route-derived distances that exist anywhere, and it dies with the tab.
const cache = new Map<string, ParkingArea[]>();

function cacheKey(origin: LatLng, radiusM: number): string {
  return `${origin[0].toFixed(3)},${origin[1].toFixed(3)}@${Math.round(radiusM)}`;
}

/** The `limit` parking areas nearest `origin` within `radiusM`, nearest first.
 *
 *  An empty array means OSM has no mapped parking in range. That is a much
 *  stronger statement than the NVDB version of this function could make, but
 *  it is still a statement about a map rather than about the ground: OSM is
 *  volunteer-surveyed and a lot nobody has walked past with a phone is a lot
 *  nobody has mapped. The UI says so; see ParkingPanel. */
export async function fetchParkingNear(
  origin: LatLng,
  radiusM: number,
  limit: number,
  signal?: AbortSignal,
): Promise<ParkingArea[]> {
  const key = cacheKey(origin, radiusM);
  const cached = cache.get(key);
  if (cached) return cached.slice(0, limit);

  const { latDeg, lonDeg } = bboxHalfSpans(origin[0], radiusM);
  const params = new URLSearchParams({
    minLat: (origin[0] - latDeg).toFixed(5),
    maxLat: (origin[0] + latDeg).toFixed(5),
    minLon: (origin[1] - lonDeg).toFixed(5),
    maxLon: (origin[1] + lonDeg).toFixed(5),
    limit: String(MAX_CANDIDATES),
  });

  const res = await fetch(`${ENDPOINT}?${params}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`parking API ${res.status}`);
  const data = (await res.json()) as ParkingResponse;

  const now = Date.now();
  const areas = (data.areas ?? [])
    .map((row) => toArea(row, origin, now))
    .filter((a): a is ParkingArea => a !== null)
    // The box over-fetches its corners; drop what the circle wouldn't include.
    .filter((a) => a.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);

  cache.set(key, areas);
  return areas.slice(0, limit);
}
