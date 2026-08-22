// Parking areas near a route start, from Statens vegvesen's Nasjonal
// vegdatabank (NVDB), vegobjekttype 43 "Parkeringsområde" — *område avsatt til
// parkering for mer enn ett kjøretøy*.
//
// Why NVDB and not OpenStreetMap: see docs/parking-data-sources.md. The short
// version is that OSM has materially better trailhead coverage (47k objects,
// with the Norwegian `hiking=yes` utfartsparkering convention) but cannot be
// queried live by a commercial service — both Overpass and the OSM editing API
// forbid it — so using it means a bulk extract, a D1 table, a build pipeline,
// and taking on ODbL share-alike. NVDB is NLOD, the licence Fjellrute already
// carries for NVE and seNorge, needs no key, and its own guidelines actively
// prefer live querying over bulk download.
//
// The honest limitation, and it is a real one: NVDB describes the road network
// Statens vegvesen administers or has registered. Europaveg, riksveg, fylkesveg
// and municipal roads are in scope. The unsigned gravel pull-off at the end of
// a private toll road above a valley farm generally is not — and that is a
// large share of Norwegian trailheads. An empty result here means "NVDB does
// not know about parking here", never "there is nowhere to park". The UI says
// so; see ParkingPanel.

import { haversine } from '../geometry';
import type { LatLng } from '../types';

// Proxied through the Worker in production and the Vite dev server locally, so
// the X-Client / X-Kontaktperson headers NVDB's guidelines ask for are stamped
// server-side. Browsers cannot set them from fetch() in a way we'd control, and
// going direct would make us anonymous traffic. See worker/proxy.js.
const ENDPOINT = '/nvdb-api/vegobjekter/api/v4/vegobjekter/43';

/** Where a parking area's record came from.
 *
 *  A mandatory source discriminator from day one, on the advice of
 *  docs/parking-data-sources.md: if OSM-derived rows are ever added alongside
 *  these, keeping them separately identified (and never merging coordinates)
 *  keeps the collection arguable as a Collective Database, where each part
 *  retains its own licence, rather than one Derivative Database to which ODbL
 *  share-alike applies wholesale. That distinction is free to preserve now and
 *  expensive to retrofit later. */
export type ParkingSource = 'nvdb';

export interface ParkingArea {
  /** Stable within `source`; NVDB's vegobjekt id. */
  id: string;
  source: ParkingSource;
  /** Representative point — the centre of the object's bounding box, since
   *  NVDB returns type 43 as a point, a line or a polygon depending on how it
   *  was surveyed. */
  point: LatLng;
  /** Straight-line distance from the query origin, meters. */
  distanceM: number;
  /** NVDB's own name where it carries one; many objects are unnamed. */
  name: string | null;
  /** Number of spaces, where recorded. */
  capacity: number | null;
  /** Raw NVDB value for the fee attribute, e.g. "Avgiftsbelagt" / "Gratis". */
  fee: string | null;
  /** Surface, e.g. "Asfalt" / "Grus". A gravel surface is a mild hint that a
   *  lot is rural, which is exactly the kind we most want to find. */
  surface: string | null;
  /** Whether the lot is maintained through winter, where recorded — the single
   *  most useful attribute for ski touring and the one most often missing. */
  winter: string | null;
  /** Who owns or maintains it, e.g. "Stat" / "Kommune" / "Privat". */
  owner: string | null;
  /** NVDB "Bruksområde", e.g. "Rasteplass" / "Innfartsparkering". */
  usage: string | null;
  /** Epoch ms when this result was actually retrieved. Cached results keep
   *  their original time so the UI reports honest data age. */
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// NVDB response shapes. Deliberately loose: docs/parking-data-sources.md notes
// that the live request/response shapes were never exercised, only read from
// upstream documentation, and the documentation pages for the endpoint are
// navigation stubs. Everything below is therefore parsed defensively — an
// attribute we cannot find renders as "—" rather than throwing.
// ---------------------------------------------------------------------------

interface NvdbEgenskap {
  id?: number;
  navn?: string;
  verdi?: unknown;
}

interface NvdbGeometri {
  wkt?: string;
}

interface NvdbObjekt {
  id?: number;
  egenskaper?: NvdbEgenskap[];
  geometri?: NvdbGeometri;
  lokasjon?: { geometri?: NvdbGeometri };
}

interface NvdbResponse {
  objekter?: NvdbObjekt[];
}

/** Centre of a WKT geometry's bounding box, as [lat, lng].
 *
 *  Type 43 comes back as POINT, LINESTRING or POLYGON depending on how the
 *  object was surveyed, sometimes with a Z ordinate, so this handles any of
 *  them by reading every vertex and taking the extent's midpoint. Bounding-box
 *  centre rather than vertex mean on purpose: a polygon ring repeats its first
 *  vertex at the end and often has vertices bunched along one edge, both of
 *  which drag a mean off-centre. For an object tens of metres across the
 *  difference is cosmetic, but the bbox centre is the one that cannot be
 *  argued with.
 *
 *  Coordinates are lon-lat because the caller requests srid=4326. */
export function wktCenter(wkt: string): LatLng | null {
  const body = wkt.slice(wkt.indexOf('('));
  if (!body) return null;
  // Is there a Z (or M) ordinate to skip? Read it off the type prefix rather
  // than guessing from the number count, which cannot distinguish "x y z" from
  // two 2D points written without a comma.
  const header = wkt.slice(0, wkt.indexOf('(')).trim().toUpperCase();
  const stride = /\s(Z|ZM|M)$/.test(header) ? 3 : 2;

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let found = false;

  for (const chunk of body.replace(/[()]/g, ' ').split(',')) {
    const nums = chunk.trim().split(/\s+/);
    if (nums.length < stride) continue;
    const lon = Number.parseFloat(nums[0]);
    const lat = Number.parseFloat(nums[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    found = true;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!found) return null;
  return [(minLat + maxLat) / 2, (minLon + maxLon) / 2];
}

// Attributes are matched on their Norwegian name rather than their numeric
// egenskapstype id. The ids for type 43 could not be verified against the live
// datakatalog (see the verification note in docs/parking-data-sources.md), and
// a wrong hardcoded id fails silently by reading the wrong column, whereas a
// name match that misses simply leaves the field null and shows "—". Once the
// smoke test in that document has been run, swapping these for ids would be a
// small and strictly safer change.
function attr(
  egenskaper: NvdbEgenskap[],
  matches: (name: string) => boolean,
): string | null {
  for (const e of egenskaper) {
    if (!e.navn || e.verdi === undefined || e.verdi === null) continue;
    if (!matches(e.navn.toLowerCase())) continue;
    const v = String(e.verdi).trim();
    if (v !== '') return v;
  }
  return null;
}

function toArea(
  o: NvdbObjekt,
  origin: LatLng,
  fetchedAt: number,
): ParkingArea | null {
  const wkt = o.geometri?.wkt ?? o.lokasjon?.geometri?.wkt;
  if (!wkt || o.id === undefined) return null;
  const point = wktCenter(wkt);
  if (!point) return null;

  const eg = o.egenskaper ?? [];
  const capacityRaw = attr(eg, (n) => n.includes('antall') && n.includes('plass'));
  const capacity = capacityRaw ? Number.parseInt(capacityRaw, 10) : NaN;

  return {
    id: String(o.id),
    source: 'nvdb',
    point,
    distanceM: haversine(origin, point),
    name: attr(eg, (n) => n === 'navn' || n.endsWith('navn')),
    capacity: Number.isFinite(capacity) ? capacity : null,
    fee: attr(eg, (n) => n.includes('avgift') || n.includes('betaling')),
    surface: attr(eg, (n) => n.includes('dekke')),
    winter: attr(eg, (n) => n.includes('vinter') || n.includes('brøyt')),
    owner: attr(eg, (n) => n === 'eier' || n.includes('vedlikeholdsansvarlig')),
    usage: attr(eg, (n) => n.includes('bruksområde')),
    fetchedAt,
  };
}

/** Longitude/latitude half-spans of a `radiusM` box around `lat`.
 *
 *  A box, not a circle: NVDB filters by `kartutsnitt`, a rectangular map
 *  extent. It therefore over-fetches the corners, which is harmless — every
 *  candidate is re-measured with a real haversine distance and anything past
 *  the radius is dropped before the user sees it. */
function bboxHalfSpans(lat: number, radiusM: number) {
  const latDeg = radiusM / 110540;
  // Meridians converge toward the pole, so a fixed ground distance spans more
  // longitude the further north you are — the difference between Lindesnes and
  // Nordkapp is about a factor of two, so it cannot be approximated away.
  const lonDeg = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { latDeg, lonDeg };
}

// One page is requested rather than following NVDB's cursor paging. A 10 km
// radius is a 20 km box, which in open country holds a handful of objects and
// in central Oslo could hold hundreds — but the caller only ever shows the
// five nearest, and truncation can only drop objects that were never going to
// be displayed in the first place. Paging through a city to throw the results
// away would cost the user latency for nothing.
const MAX_CANDIDATES = 500;

// (lat, lon, radius) → results. Quantized to ~100 m so nudging the route start
// by a metre doesn't re-query, and keyed with the radius because a wider search
// is a genuinely different question.
//
// No TTL: unlike a forecast, a car park does not change during a session. The
// edge cache in front of this holds 24 h for the same reason.
const cache = new Map<string, ParkingArea[]>();

function cacheKey(origin: LatLng, radiusM: number): string {
  return `${origin[0].toFixed(3)},${origin[1].toFixed(3)}@${Math.round(radiusM)}`;
}

/** The `limit` parking areas nearest `origin` within `radiusM`, nearest first.
 *
 *  Returns an empty array when NVDB has nothing in range — which, per the note
 *  at the top of this file, is a statement about NVDB's coverage rather than
 *  about the ground. */
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
  // kartutsnitt is minLon,minLat,maxLon,maxLat — x first, matching the example
  // in the NVDB docs (8.80,61.48,8.90,61.53 is the Gjendesheim area, where the
  // 8.8 is plainly the longitude).
  const kartutsnitt = [
    (origin[1] - lonDeg).toFixed(5),
    (origin[0] - latDeg).toFixed(5),
    (origin[1] + lonDeg).toFixed(5),
    (origin[0] + latDeg).toFixed(5),
  ].join(',');

  const params = new URLSearchParams({
    kartutsnitt,
    srid: '4326',
    inkluder: 'egenskaper,lokasjon,geometri',
    antall: String(MAX_CANDIDATES),
  });
  // NVDB sits behind a firewall that rejects request URLs over 2048 characters.
  // This one is nowhere near it, but the ceiling is documented and cheap to
  // assert, and the failure it prevents is an opaque upstream error.
  const url = `${ENDPOINT}?${params}`;
  if (url.length > 2048) throw new Error('NVDB request URL too long');

  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`NVDB API ${res.status}`);
  const data = (await res.json()) as NvdbResponse;

  const now = Date.now();
  const areas = (data.objekter ?? [])
    .map((o) => toArea(o, origin, now))
    .filter((a): a is ParkingArea => a !== null)
    // The box over-fetches its corners by up to √2; drop what the circle
    // wouldn't have included.
    .filter((a) => a.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);

  cache.set(key, areas);
  return areas.slice(0, limit);
}
