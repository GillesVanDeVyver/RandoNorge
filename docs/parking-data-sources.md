# Parking near a drawn route — where the data can come from

Research note, 2026-08-20. Companion to `docs/DATA_LICENSES.md`: same question
asked of a new dataset (does it permit commercial use, what attribution, what
service policy), plus the two questions that decide whether the feature is worth
building at all — does the data actually contain *trailhead* parking, and does
taking it change Fjellrute's licence posture.

The purpose of the document is to name the decision gate (a coverage test, below)
that should be passed before any code is written, because the honest answer to
"is there an API for this" is: there are four, they all have national coverage on
paper, and only one of them is likely to know about a gravel lot at the end of a
forest road.

**Verification status.** Licences, endpoints, rate limits and object-type IDs
below were read from the upstream documentation on 2026-08-20 and the OSM object
counts come from taginfo's Norway instance dated 2026-08-19. Live request/response
shapes were *not* exercised — the smoke-test commands at the end of this document
are the ones to run before trusting any parameter spelling.

---

## What was built — 2026-08-22

**NVDB vegobjekttype 43, queried live.** Shipped as a Parking tab after Weather,
numbered pins on the 2D map, and a switchable section on the printed briefing.
Radius defaults to 2 km with a 1–10 km slider, five lots listed, measured from
`routeEnds().start`.

Chosen over OSM deliberately and with the trade-off understood. OSM has by far
the better trailhead coverage; NVDB has the licence that costs nothing — NLOD,
the same posture Fjellrute already holds for NVE and seNorge, no share-alike, no
derived-database publication obligation, no new legal conversation. NVDB is also
the only candidate whose operator explicitly *prefers* live querying to bulk
extraction, which means the D1 import pipeline the OSM route required simply does
not exist. The cost is coverage, and it is a real cost rather than a rounding
error.

Files: `src/parking/{api,useParking,store,radius,format,pin}.ts`,
`src/components/{ParkingPanel,ParkingLayer}.tsx`, the `/nvdb-api` route in
`worker/index.js` and `vite.config.ts`, and the parking section in
`src/briefing/BriefingSheet.tsx`. Licence section 6 in `docs/DATA_LICENSES.md`.

Two things were carried forward from this document verbatim. `ParkingArea.source`
is a mandatory discriminator (`'nvdb'` today), because the Collective-Database
schema decision is free on day one and expensive to retrofit, and its whole
purpose is to let a second, differently-licensed source be added later without
contaminating the first. And every empty state — the tab, the printed sheet, the
briefing switch's own hint — is worded as a gap in the register rather than a gap
in the world, because on the private and forest roads most Norwegian tours start
from, that is exactly what it is.

**Still outstanding, and it is the gate this document exists to name:** the
coverage test below has *not* been run. NVDB shipped because it is the option
that could ship today under a licence already held, not because it was shown to
know about Norwegian trailheads. If it turns out to miss the Gjendesheim /
Spiterstulen / Turtagrø class of start point, the honest response is not to widen
the radius but to reopen the OSM question with the ODbL cost priced in — which is
what the `source` column exists to make possible.

It was attempted. Three request shapes against `nvdbapiles.atlas.vegvesen.no` —
the Gjendesheim `kartutsnitt` query below, a shortened form of it, and the
parameterless datakatalog lookup for type 43 — each returned HTTP 400 from the
authoring environment, which cannot set the `Accept: application/json` header
NVDB requires. That is a fact about the tool used, not evidence about NVDB's
coverage, and it must not be read as one. Run the `curl` commands at the end of
this document from a normal shell; they carry the header, and they are the
version of this test that means anything.

**Also unverified:** the live NVDB response shape. `src/parking/api.ts` reads
attributes by matching their Norwegian names rather than by `egenskapstype` id,
precisely because the ids in this document were never exercised against the API.
A wrong id fails silently by reading the wrong column; a missed name renders an
honest "—". That is a deliberate trade of precision for a safe failure mode, and
it should be tightened to ids once the smoke test at the end of this document has
actually been run.

---

## What the feature actually asks of the data

The planner hands us a `Route` (`src/types/index.ts`): an ordered list of
segments of `[lat, lng]`, drawn freehand or click-by-click, entirely client-side.
"Parking close to the trail" is therefore a corridor query around a polyline, and
in practice a heavily weighted one — what the user wants is almost always parking
near `routeEnds().start` (and near the end, if the tour is not a loop), not a
uniform scatter of car parks along the whole line. A radius of roughly 300 m to
2 km around the endpoints, with anything within ~500 m of the line itself as a
bonus, covers the real use.

`src/geometry/index.ts` already has everything needed for the geometry half:
`haversine`, `projectOntoRouteAhead` (gives distance-from-route and
distance-along-route in one pass) and `resample`. So the data problem is purely
about getting a set of candidate points into the client or the Worker cheaply.

The attributes that matter for a ski-touring and hiking brief, in rough order of
usefulness: whether it is public or private, whether there is a fee (and whether
it is a toll road to get there), capacity, whether it is ploughed in winter, and
a name recognisable enough to put in the printed briefing.

---

## The candidates

| Source | Licence | Commercial | National coverage | Trailhead parking? | Delivery |
|---|---|---|---|---|---|
| OpenStreetMap `amenity=parking` | ODbL 1.0 | Yes, with share-alike | 47,415 objects | **Best available** | Bulk extract (Geofabrik) |
| NVDB vegobjekttype 43 `Parkeringsområde` | NLOD | Yes | Registered road network | Partial | Live REST API |
| Kartverket N50 Kartdata `Parkeringsområde` | CC BY 4.0 | Yes | Mainland Norway | Unverified | Bulk download (Geonorge) |
| Parkeringsregisteret (Statens vegvesen) | Open, NLOD-family | Yes | ~3,300 facilities | No — regulated/urban | Live REST API |
| Tilgjengelighet friluft (Kartverket) | CC BY 4.0 | Yes | Surveyed areas only | Yes, where surveyed | WMS/WFS + download |
| Nasjonal Turbase (DNT / UT.no) | Contradictory | **Unclear** | Good for start points | Yes | Live REST API (key) |
| Overture Places | CDLA-Permissive 2.0 | Yes, no share-alike | Global, POI-style | Doubtful | Bulk (Parquet on AWS) |

### 1. OpenStreetMap — the one that actually has the data

Norway has 47,415 objects tagged `amenity=parking` as of 2026-08-19 (6,391
nodes, 40,540 ways, 484 relations). Attribute richness is decent and, more to the
point, decent on exactly the fields the briefing wants: `access` on 13,752 of
them, `fee` on 8,534 (6,031 of those explicitly `fee=no`), `surface` on 8,665,
`capacity` on 5,353.

The reason to prefer it is not the count, it is who did the mapping. Norwegian
OSM convention tags trailhead parking — *utfartsparkering* — as `amenity=parking`
plus `hiking=yes`, which is a convention that exists because the people mapping
these lots were going hiking from them. No cadastral or road-authority dataset
has that incentive, and a lot at the end of a private forest road is invisible to
a road register but obvious to whoever drove there last weekend.

The catch is ODbL share-alike, dealt with in its own section below.

**Do not query it live.** The Overpass documentation is explicit that public
instances are not for this: guidance is roughly 10,000 requests and 1 GB per day
for an individual, load-shedding prioritises light users over heavy ones, and
"operating apps beyond mapper communities using public instances as backend" is
listed as problematic behaviour, with the conclusion that "only running your own
instance sustainably serves your mission." The OSM editing API is worse — it is
for editing, explicitly not for read-heavy consumption, and the usage policy warns
that access "may be withdrawn at any point: you may no longer be able to serve
your paying customers." For a commercial service, both roads are closed. The
supported path is a bulk extract, which is fine, because a national parking table
is small.

`norway-latest.osm.pbf` from Geofabrik is 1.3 GB and rebuilt daily; filtering it
with `osmium tags-filter` down to parking objects is a minute or two of local
work, run monthly at most, since car parks do not move.

### 2. NVDB vegobjekttype 43 — the official one, live, NLOD

Statens vegvesen's Nasjonal vegdatabank defines object type **43,
"Parkeringsområde"**: *område avsatt til parkering for mer enn ett kjøretøy*.
Data is NLOD with the credit line "Inneholder data under norsk lisens for
offentlige data (NLOD) tilgjengeliggjort av Statens vegvesen" — the same licence
already carried for NVE and seNorge in `DATA_LICENSES.md`, so it adds no new
obligation beyond one more attribution string.

API LES v4 lives at `https://nvdbapiles.atlas.vegvesen.no/`, objects at
`/vegobjekter/api/v4/vegobjekter/{typeId}`, no registration or key. Registration
is not required but `X-Client` (application name) and `X-Kontaktperson` (contact
email) headers are recommended — which is the same courtesy the Worker already
pays MET via `USER_AGENT` in `worker/proxy.js`, and should be stamped the same
way. Filtering is by `kartutsnitt` (map extent) with a `srid` parameter, geometry
and attributes come in via `inkluder=egenskaper,lokasjon,geometri`, and paging is
cursor-based on `antall` + `start`.

Documented limits: **40 calls per second** (1000 ms window, 429 after a 1000 ms
timeout) and a hard **2048-character cap on the whole request URL** from an
upstream firewall, which matters if a corridor query is ever expressed as a long
polygon or a long list of IDs. Notably, and unlike almost every other source in
this document, NVDB's guidelines *prefer* live querying: "vi oppfordrer våre
brukere til å hente data i sanntid, fremfor å laste ned store datasett i bulk."

The weakness is structural, not legal. NVDB describes the road network Statens
vegvesen administers or has registered. Parking on europaveg, riksveg, fylkesveg
and municipal roads is in scope; the unsigned pull-off at the end of a private
toll road above a valley farm generally is not. That is a large share of Norwegian
trailheads.

### 3. Kartverket N50 Kartdata — the zero-new-risk option

N50 is CC BY 4.0, © Kartverket, national coverage of mainland Norway, updated
continuously and distributed weekly, downloadable from Geonorge as GML, SOSI,
Esri file geodatabase or PostGIS. Its product specification includes
`Parkeringsområde` as an object type, sourced ultimately from FKB.

The appeal is that it changes nothing: Fjellrute already displays Kartverket
topo tiles, already builds terrain tiles from Kartverket høydedata, already shows
"© Kartverket" in every attribution surface. Adding N50 parking polygons is one
more line in an existing credit.

The unknown is whether N50 parking actually reaches the mountains. N50 inherits
from FKB, whose detailed coverage follows settlement and infrastructure, so
remote gravel lots may simply not be there. This is the single biggest open
question in this document and the coverage test below is designed to answer it,
because if N50 hit rate is anywhere near OSM's, the ODbL question disappears
entirely.

### 4. Parkeringsregisteret — real, but the wrong shape

Statens vegvesen's parking register covers about 3,300 parking facilities plus
street parking, with a read API and per-facility sign plans. It exists to
register *regulated* parking — operators, tariffs, enforcement — so it is an
urban dataset. OSM community discussion also notes real gaps even in Oslo and
Bærum, and that many entries are named by address rather than by place. Useful if
Fjellrute ever wants to tell someone where to leave the car in Tromsø before a
Fjellheisen tour; useless for Jotunheimen.

### 5. Tilgjengelighet / friluftsliv datasets — a good complement

Kartverket's accessibility mapping for outdoor recreation areas registers parking
and HC parking as objects alongside boat ramps, fishing spots, shelters, fire
pits, toilets and trail roads, and explicitly maps HC parking that serves as a
natural starting point for people moving in outdoor areas. CC BY 4.0, available
as WMS/WFS and download via Geonorge. Coverage is limited to municipalities and
areas that have been surveyed, so it cannot be the primary source, but where it
exists it is high quality and it is the only source that knows about
accessibility — which is a differentiator worth having, and one UT.no does not
show well.

Related: **Turrutebasen** (Nasjonal database for tur- og friluftsruter, also
CC BY 4.0 via Geonorge) does not carry parking, but it carries the official
routes. Snapping a user's drawn line to a Turrutebasen route and then looking for
parking near that route's registered start point is a plausible second retrieval
strategy — and Turrutebasen is worth its own evaluation for other reasons.

### 6. Nasjonal Turbase (DNT / UT.no) — avoid until the licence is in writing

NTB's own documentation says the data licence for all data types has been changed
to Creative Commons 4.0 and that the data is freely available for reuse in other
applications and services. UT.no's *brukervilkår*, covering "UT.no og tilhørende
tjenester", say content is for personal use only, that commercial use is not
permitted, and that automated collection of content for commercial use is
prohibited. Those two statements cannot both govern the same bytes for a paying
product.

DNT start points would be genuinely useful — they are curated trailheads with
parking notes. But this is the one source in the list where the answer to "is it
free for us" is *unknown*, and given Fjellrute's position relative to UT.no (see
`docs/Fjellrute-vs-UTno-Deep-Dive.md`) it is also the one where getting it wrong
would be most expensive. If it is wanted, it needs a written statement from DNT
naming Fjellrute as a commercial service, filed the way the pending Kartverket
tile-cache request is filed.

### 7. Overture Places — the share-alike escape hatch, if coverage allows

Overture's Places theme is licensed CDLA-Permissive 2.0, contains no
OpenStreetMap data, and therefore carries none of ODbL's share-alike
obligations — a meaningfully different proposition from OSM for a commercial
product. It is distributed as Parquet (including via AWS Open Data). Its Base
theme, by contrast, *is* ODbL, so only Places is interesting here.

The doubt is coverage: Places is built from Meta, Microsoft and Foursquare POI
data, which is business-listing-shaped. A restaurant in Bergen, certainly. An
unnamed parking area below Skjeggedal, probably not. Cheap to test, and worth
testing precisely because a permissive licence would remove the hardest question
in this document.

### 8. Commercial APIs — rejected

Google Places, Mapbox Tilequery, HERE and Parkopedia all have parking data and
all fail on at least two counts: cost that scales with usage rather than sitting
at zero, and terms that typically forbid caching or storing results and forbid
displaying them on a third-party basemap. Fjellrute's basemap is Kartverket. A
paid dependency that cannot legally be drawn on our own map, cannot be cached,
and cannot go into an offline region is not a candidate.

---

## Delivery: live API or a pre-built table

Both were considered, and for this feature they are not close.

**Live querying** is attractive for NVDB specifically, since Statens vegvesen
asks for it and the 40 req/s ceiling is generous. But the corridor around a drawn
route is not one bounding box; it is either a coarse box that over-fetches badly
on a long point-to-point tour, or several boxes. Each of those is a Worker
request against the 100k/day free-tier budget that `docs/cost-and-limits.md`
tracks, and each happens while the user is actively drawing, so latency is
user-visible in a way that a route-save or a briefing render is not. It also
cannot serve the offline story at all: `src/offline/` downloads a region for use
with no network, and a live API contributes nothing to a downloaded region.

**A pre-built table in D1** wins on every axis that matters here. 47,415 rows is
nothing against the 5 GB free allowance — call it 5 MB with attributes. D1 has no
spatial index, but it does not need one: store a coarse grid-cell key (0.05°
latitude by 0.1° longitude gives 5.5 km north-south and 5.4 km east-west at
Jotunheimen latitudes, narrowing to 3.8 km wide in Finnmark — cells get smaller
going north, never larger, so the query stays correct either way),
index that column, select the handful of cells the route's bounding box touches,
and hand the candidates to `projectOntoRouteAhead` for exact distance filtering.
That is one indexed D1 read per route plan, one Worker request, edge-cacheable by
bounding box, and the same rows can be written into an offline region alongside
the tiles.

The refresh job belongs next to `scripts/terrain/make_terrarium_tiles.py` — the
precedent is already set for "bulk-process an open dataset locally, ship the
derived artefact to Cloudflare". Car parks appear and disappear slowly; monthly
is generous.

**Recommendation, conditional on the coverage test:** pre-built D1 table, OSM as
the primary geometry source, NVDB queried live only to enrich attributes for the
handful of lots actually shown (fee, capacity, winter maintenance), and N50 as
either the primary or a filler depending on what the test says. If the test shows
N50 and NVDB together reach most real trailheads, drop OSM and keep the entire
data stack inside the existing CC BY 4.0 / NLOD posture — that is worth a
meaningful amount of coverage.

---

## The decision gate: a coverage test, before any code

Pick 25–30 trailheads that a Fjellrute user would actually plausibly start from,
spread across the country and across popularity, deliberately including several
served only by private or gravel roads. Suggested starting list: Gjendesheim
(Besseggen), Spiterstulen, Turtagrø, Skjeggedal (Trolltunga), Preikestolen,
Romsdalseggen at Vengedalen, Stavsro (Gaustatoppen), Kvamskogen, Fløyen and
Ulriken in Bergen, Sognsvann and Kolsås in Oslo, Fjellheisen and Tromsdalen in
Tromsø, Lyngen at Furuflaten, Sunnmørsalpene at Urke, Innerdalen, Trollstigen,
Rondane at Spranget, Sylan at Nedalen, and half a dozen deliberately obscure local
ones.

For each, ask three yes/no questions: is there a parking object within 200 m in
OSM, in N50, in NVDB 43. Record the hit rate per source and, separately, the
attribute completeness of the hits. Two numbers come out of it: how much coverage
OSM buys over the CC BY / NLOD sources, and whether the government sources are
good enough alone. Both are needed to decide the ODbL question honestly, and
neither can be guessed.

Budget half a day. It is cheap relative to building the wrong thing, and the
result belongs in this document.

---

## What taking OSM would commit Fjellrute to

Not legal advice, and this belongs in the next pass of
`docs/LEGAL-REVIEW-2026-07-16.md` rather than being settled here. But the shape
of it is clear enough to plan around.

A national extract of every parking object in Norway is unambiguously
"substantial" under the OSMF's own guideline, which draws its line at roughly 100
features or a village-sized area and notes that repeated small extractions
aggregate. So ODbL share-alike applies; there is no reading of the guideline
under which 47,000 objects is insubstantial.

That means two things. Attribution is straightforward: "© OpenStreetMap
contributors" with an ODbL link, added to the map-corner controls,
`TermsDialog.tsx` §6, `SourceAttribution.tsx` and ToS §6 in both languages,
exactly where the Kartverket, NVE and MET credits already live. Share-alike is
the real commitment: serving the derived parking table through our own API is
public use of a Derivative Database, so the derived database has to be offered
under ODbL. The cheap and standard way to satisfy that is to publish the extract
itself as a downloadable file — an R2 object served at a stable path with a
licence notice — which costs nothing and ends the argument.

The trap to design around is contamination. If OSM-derived rows and
Kartverket-derived rows are merged into one conflated geometry, the resulting
database is plausibly a single Derivative Database and the share-alike reading
gets much broader. Keeping them in separate tables (or at minimum separate rows
with a mandatory `source` column, never merged coordinates) keeps the collection
arguable as a Collective Database, where each part keeps its own licence. That is
a schema decision, it is free if made on day one, and it is expensive to retrofit.

If share-alike is judged unacceptable for a paid product, the fallback is real:
N50 plus NVDB plus Tilgjengelighet, all CC BY 4.0 or NLOD, all already in the
posture. The coverage test decides what that fallback costs.

---

## Sketch, if it goes ahead

A migration adding one table — `parking(id, source, source_id, lat, lon, cell,
name, capacity, fee, access, surface, hiking, updated_at)` with an index on
`cell` and a check that `source` is one of the known values — following the
commenting convention of `migrations/0004_forecast.sql`, which explains *why* the
column exists rather than what it is.

A build script under `scripts/parking/`, mirroring the terrain script: fetch the
Geofabrik Norway extract, `osmium tags-filter` it to `nwr/amenity=parking`,
reduce ways and relations to centroids, normalise the attribute tags, compute the
grid cell, emit SQL, and load with `wrangler d1 execute`. Optionally a second
pass hitting NVDB 43 per bounding box to attach official attributes to lots
within tolerance of an OSM point.

A Worker module `worker/parking.js` answering `GET /api/parking?bbox=…`, added to
`ROUTES`-adjacent handling in `worker/index.js`, edge-cached through
`caches.default` with a long TTL since the data is monthly. Client side, a
`src/parking/api.ts` plus a `usePark`-style hook following the existing
`useSnow` / `useAvalanche` pattern, debounced on route change, filtering
candidates with `projectOntoRouteAhead`, rendered as markers with a distinct icon,
and surfaced in `BriefingSheet` so the printed brief names the trailhead and says
whether it costs anything. Offline regions get the rows for the region written
alongside the tiles in `src/offline/download.ts`.

Free-tier impact: one Worker request per route plan, a few kilobytes, one indexed
D1 read. Against the scenarios in `docs/cost-and-limits.md` this is noise.

---

## Open action items

The coverage test above, before anything else — it is the gate, and both the
source choice and the ODbL decision hang off it.

Verify N50's `Parkeringsområde` coverage in mountain areas specifically, since
that single fact determines whether ODbL needs to be taken on at all.

Probe Overture Places for Norwegian trailhead parking. A permissive licence with
adequate coverage would be the best outcome available and it is an afternoon to
rule in or out.

Smoke-test the NVDB parameter spellings before writing anything against them —
`kartutsnitt` ordering, whether `srid=4326` is accepted for both input and output,
and what attributes type 43 actually carries:

```
curl -H 'Accept: application/json' \
     -H 'X-Client: fjellrute' \
     -H 'X-Kontaktperson: contact@fjellrute.no' \
  'https://nvdbapiles.atlas.vegvesen.no/datakatalog/api/v1/vegobjekttyper/43'

curl -H 'Accept: application/json' \
     -H 'X-Client: fjellrute' \
     -H 'X-Kontaktperson: contact@fjellrute.no' \
  'https://nvdbapiles.atlas.vegvesen.no/vegobjekter/api/v4/vegobjekter/43?kartutsnitt=8.80,61.48,8.90,61.53&srid=4326&inkluder=egenskaper,lokasjon,geometri&antall=5'
```

Do not open a licence conversation with DNT about Nasjonal Turbase unless their
start points are actually wanted; the contradiction between the NTB licence and
UT.no's terms means the answer has to be in writing and naming Fjellrute.

If OSM is adopted: add the ODbL section to `DATA_LICENSES.md`, add attribution in
all four surfaces, publish the derived extract under ODbL, and put the
Collective-Database schema decision (separate tables, mandatory `source`) in the
migration comment so it survives.

---

## Sources

- OSM parking counts for Norway: https://taginfo.geofabrik.de/europe:norway/tags/amenity=parking
- Geofabrik Norway extract and ODbL notice: https://download.geofabrik.de/europe/norway.html
- OSM API usage policy: https://operations.osmfoundation.org/policies/api/
- Overpass API load / fair-use guidance: https://dev.overpass-api.de/overpass-doc/en/preface/commons.html
- ODbL "substantial" community guideline: https://osmfoundation.org/wiki/Licence/Community_Guidelines/Substantial_-_Guideline
- NVDB API LES v4 overview (base URLs, NLOD): https://nvdb-docs.atlas.vegvesen.no/nvdbapil/v4/introduksjon/Oversikt/
- NVDB API limitations (40 req/s, 2048-char URL, paging): https://nvdb-docs.atlas.vegvesen.no/nvdbapil/v4/introduksjon/Begrensninger/
- NVDB API guidelines (X-Client, real-time over bulk): https://api.vegdata.no/retningslinjer.html
- NVDB terms of use of data: https://www.nvdb.no/rammer-regelverk/vilkar-og-ansvar/vilkar-for-bruk-av-data/
- NVDB datakatalog: https://nvdb-docs.atlas.vegvesen.no/nvdbapil/v4/Datakatalog/
- Parkeringsregisteret API: https://www.vegvesen.no/om-oss/om-organisasjonen/apne-data/et-utvalg-apne-data/parkeringsregisteret-api/
- Parkeringsregisteret discussion (coverage, OSM permission): https://community.openstreetmap.org/t/parkeringsregisteret/85960
- N50 Kartdata (CC BY 4.0, formats, weekly): https://register.geonorge.no/det-offentlige-kartgrunnlaget/n50-kartdata/ea192681-d039-42ec-b1bc-f3ce04c189ac
- Kartverket friluftsliv datasets: https://www.kartverket.no/en/api-and-data/friluftsliv
- Turrutebasen: https://register.geonorge.no/det-offentlige-kartgrunnlaget/tur-og-friluftsruter/d1422d17-6d95-4ef1-96ab-8af31744dd63
- Nasjonal Turbase licence statement: https://hjelp.ut.no/hc/no/articles/360011064359-Om-Nasjonal-Turbase-NTB
- UT.no brukervilkår (non-commercial clause): https://hjelp.ut.no/hc/no/articles/360003958100-Brukervilk%C3%A5r-for-UT-no-og-tilh%C3%B8rende-tjenester
- Overture attribution and licensing: https://docs.overturemaps.org/attribution/
