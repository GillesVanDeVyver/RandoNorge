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

Superseded in part on 2026-08-22: the coverage numbers in "The gate, measured"
*were* obtained by querying the sources directly, and the method for each is
recorded there so the figures can be re-run rather than believed.

---

## What was built — 2026-08-22

> **Superseded the same day.** NVDB was removed and the layer rebuilt on
> OpenStreetMap; see "The recommendation, executed" below. This section is kept
> as written because the reasoning it records — why the cheap licence looked
> like the right trade before the coverage gate had been run — is the part worth
> remembering.

**NVDB vegobjekttype 43, queried live.** Shipped as a Parking tab after Weather,
numbered pins on the 2D map, and a switchable section on the printed briefing.
Radius defaults to 2 km with a 1–10 km slider, five lots listed, measured from
`routeEnds().start`. (Both numbers and the slider itself have since changed —
see "The radius control" below, which supersedes this sentence.)

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

**The gate this document exists to name was still open when the above shipped.**
NVDB was chosen because it is the option that could ship that day under a licence
already held, not because it had been shown to know about Norwegian trailheads.
It has since been run, and NVDB failed it — see "The gate, measured" below, which
supersedes this paragraph and carries the recommendation that follows from it.
The prediction made here turned out to be the right one: the answer to a missing
trailhead is not a wider radius but reopening the OSM question with the ODbL cost
priced, which is what the `source` column exists to make possible.

Three request shapes against `nvdbapiles.atlas.vegvesen.no` — the Gjendesheim
`kartutsnitt` query below, a shortened form of it, and the parameterless
datakatalog lookup for type 43 — each returned HTTP 400 from the authoring
environment, which cannot set the `Accept: application/json` header NVDB
requires. That is a fact about the tool, not evidence about NVDB's coverage, and
it must not be read as one; NVDB's failure below rests on a field report instead.
Run the `curl` commands at the end of this document from a normal shell if a
measured NVDB count is wanted.

**Also unverified:** the live NVDB response shape. `src/parking/api.ts` reads
attributes by matching their Norwegian names rather than by `egenskapstype` id,
precisely because the ids in this document were never exercised against the API.
A wrong id fails silently by reading the wrong column; a missed name renders an
honest "—". That is a deliberate trade of precision for a safe failure mode, and
it should be tightened to ids once the smoke test at the end of this document has
actually been run.

---

## The gate, measured — 2026-08-22 (later the same day)

The gate named at the top of this document has now been run, and **NVDB failed
it.** The trigger was a report from the field: Innerdal Parkeringsplass in
Nerdal, Sunndal — a signed, asphalted, 89-space lot charging 75 NOK at the end of
the private toll road into Innerdalen — is absent from the tab. That is not an
edge case. It is the archetype of a Norwegian trailhead: the parking is a fee box
on a farm road, and the road belongs to the farm.

Four candidate sources were measured against it. Only one has the lot.

| Source | Parking objects in Norway | Has the Innerdal lot? | What it can tell a driver | Licence |
| --- | --- | --- | --- | --- |
| OpenStreetMap | 47,422 | **Yes** | name, capacity, fee, surface, payment method, `hiking`/`ski` | ODbL 1.0 (share-alike) |
| Overture Places | 5,582 | No — nothing within the valley | name and category only | CDLA-Permissive-2.0 |
| Kartverket N50 | 95 in Møre og Romsdal, 164 in Innlandet | No — nearest is 7.95 km away | nothing; see below | CC BY 4.0 |
| NVDB type 43 | not measurable from here | No (the field report) | name, capacity, surface, restrictions | NLOD |

**OpenStreetMap** carries the lot as way 171691144, "Parkering Innerdalen", whose
centroid is 62.7384/8.7100 — about 20 m from the coordinates in the field report,
which for an 89-space lot means the same piece of ground. It has `fee=yes`,
`charge=75 NOK`, `capacity=89`,
`surface=asphalt`, `payment:app` and `payment:credit_cards`. Spot checks at other
start points found Gjendesheim split into a long-term lot of 550 spaces and a
short-term lot with a two-hour free period, and Preikestolen priced at 40 NOK for
two hours or 275 NOK for the day. Several are tagged `hiking=yes` and `ski=yes` —
a semantic none of the official registers has, because none of them was built by
people who park at trailheads.

**Overture Places** is the interesting near-miss, and the earlier assumption
about it was wrong in both directions. Its Places theme is *not* ODbL; it is
CDLA-Permissive-2.0, sourced from Meta, Microsoft, Foursquare and others, so it
would have been a genuine permissive escape from the licence problem. It simply
does not have the data. Querying the 2026-07-22.0 release directly, the box
around Innerdalen returns seventeen places — Innerdalshytta, Renndølsetra,
Innerdal Turisthytte, half a dozen peaks — and not one parking area. The likely
reason, and this is inference rather than measurement, is that a POI dataset
assembled from business listings knows the hotel and the café at the end of the
valley and has no reason to know the fee box, because a fee box is not a
business. That would also explain a national count an order of magnitude below
OSM's while still being large enough to cover urban and commercial parking. It
has not been tested beyond this one valley.

**N50** deserves a fairer hearing than a flat no, because its own product
specification promises exactly what Fjellrute wants: *"alle parkeringsområder som
er naturlig utgangspunkt for tur- og friluftsliv søkes tatt med"* — all parking
areas that are a natural starting point for hiking and outdoor life are sought to
be included. Measured, it half keeps that promise. It has Gjendesheim (330 m) and
Spiterstulen (90 m), the two most-used trailheads in Jotunheimen. It does not
have Innerdal. Three start points is far too small a sample to call a pattern,
and the tempting reading — that N50 has the famous publicly-reached lots and
misses the ones up a private road — should be treated as a hypothesis worth
testing against twenty trailheads, not as a finding. What is not in doubt is the
single result that prompted the question: N50 does not have the lot the guide
went looking for. And it is thin even where it hits: the features are
points, not areas, and of the 259 parking points across two large counties,
**not one has a name** — no capacity, no fee, no surface, no access note. N50 can
put a dot on a map. It cannot tell a guide what the dot costs or whether the car
will fit.

**SSR**, the national place-name register, was also checked and is a dead end.
Parking is not a `navneobjekttype`; "Innerdal Parkeringsplass" is a business
listing, not an official Norwegian place name.

So the answer to "is there a free database with more parking in it" is yes, there
is exactly one, and it is the one that was rejected in the first round.

### What ODbL would actually cost

Not as much as the first-round rejection assumed, and the cost falls in a
different place than expected.

The **Collective Database Guideline**, endorsed by the OSMF board, sets the rule
that matters: *"An OSM dataset and a non-OSM dataset combined in a single
database will be considered independent (and thus form a Collective Database
rather than a Derivative Database) so long as the data used for a particular data
type is either all OSM or all non-OSM within the same regional cut."* It adds
that *"two data sets need not be physically separated to qualify as
'independent'"*. Its worked examples are close to this case: proprietary traffic
data stored alongside OSM roads and used for route optimisation is *"not subject
to share-alike"*.

Applied here: Fjellrute's routes, elevation profiles, snow and avalanche caches
are a different data type from parking. They stay proprietary. Share-alike
reaches the parking table and stops.

The map, the tab list and the printed briefing sheet are **Produced Works** — the
guideline names *".PNG, JPG, .PDF, SVG images and any raster image; a map in a
physically printed work"* explicitly. They need attribution, not publication.

What does need publishing is the parking extract itself. A Norway-wide subset of
OSM parking is a Derivative Database, and ODbL §4.6 requires that it be offered
under ODbL once produced works from it are publicly used. This is the cheapest
obligation in the whole analysis, because the extract has no proprietary value —
it is OSM data with the non-parking rows removed.

**The real catch is the Horizontal Map Layers Guideline, and it bites the current
design specifically.** It states that *"if you use OpenStreetMap data along with
non-OpenStreetMap data for a given Feature Type, then the share-alike condition
would apply regardless of whether some data for that Feature Type is in a
different layer than the other data"*, and its worked example is exactly ours,
quoted in full because the condition in the middle of it is the whole point:
*"if there are restaurants in the OpenStreetMap layer and you add additional
restaurants in another layer, but you include only those restaurants not present
in the OpenStreetMap layer so that the restaurant layers will complement each
other, then the layers for this feature are interacting and the restaurants added
in your non-OpenStreetMap layer must be shared."*

Substitute "parking" for "restaurants" and that is a precise description of what
running NVDB alongside OSM would be for: filling the lots OSM does not have. The
guideline calls that complementary, and complementary is the trigger. **Serving
NVDB parking and OSM parking together for the same region would pull the NVDB
rows into share-alike too** — and, far more importantly, would pull in any
user-contributed parking Fjellrute ever adds. Note the converse: two parking sets
that genuinely did not interact, because one wholly replaced the other in a given
region, are the case the Collective Database rule protects. The `source` discriminator already
in `ParkingArea` is what makes the alternative enforceable, but it has to become a
*partition* — one source per regional cut — rather than a blend. Mixing is the
expensive choice; choosing is free.

One thing the guidelines are silent on is spatial computation, and it is worth
being deliberate rather than assuming. The current implementation computes
`distanceM` from the user's route start at query time and holds it in an
in-process `Map` that dies with the session; nothing is persisted, and no
distance is ever written into a stored parking record. That is the right side of
every line that exists, and it should stay that way — a cached table of "distance
from private route X to OSM parking Y" is where an argument could actually be
had.

Attribution would be "© OpenStreetMap contributors" wherever the current NVDB
credit appears: the map corner, the data panel, the briefing sheet's credit line,
and `DATA_LICENSES.md`. That plumbing already exists and is already conditional.

The honest unknowns: no ODbL case law was found, and the practical enforcement
route is a complaint to the OSMF rather than litigation. Whether a Norwegian
company is caught by the EU Database Directive via the EEA is a question for a
Norwegian lawyer, not for this document. OSMF answers licence questions free at
legal-questions@osmfoundation.org, which is worth using before launch.

### Recommendation

Move parking to OSM, all of it, and drop NVDB from the parking feature type
rather than running the two side by side. The licence price is real but small and
lands on a table with no commercial value; the mixing rule above means that
keeping NVDB "as well" buys coverage at the cost of entangling every future
parking row, including user-submitted ones.

The larger cost is not legal, it is the pipeline. Overpass is explicitly not for
production application traffic, so this means a Geofabrik extract, a filter to
`amenity=parking`, a D1 table, a refresh job, and a published ODbL copy of the
extract — precisely the machinery live NVDB let us avoid. That, not the licence,
is what this decision actually buys and pays for, and it should be estimated
properly before it is scheduled rather than taken from this note.

Overture Places is worth re-testing in a year. If its Norwegian coverage deepens
it is the only candidate that is both permissive and structurally capable of
carrying fee and capacity data.

**The case for doing nothing, which is not weak.** NVDB is an authoritative
register maintained by the road authority; OSM is a volunteer dataset where the
"75 NOK" could be four years stale, the capacity could be someone's estimate, and
nothing prevents a bad edit from putting a car park in a lake. For a product
whose other data sources are all official, adopting a crowd-sourced one is a
change in kind and not only in coverage, and it imports a vandalism and staleness
risk that live NVDB does not have. The counter is that a wrong fee is a smaller
failure than no lot at all — a guide who is told nothing drives to Innerdal
anyway, whereas a guide told "75 NOK, 89 spaces, may be out of date" is strictly
better off — and that the risk is manageable by showing attributes with their
provenance and refresh date rather than as bare fact. That is a judgement about
product tone, and it belongs to the owner rather than to this document. What the
document can say is that the coverage difference is not marginal: on the test
case that prompted all of this, three of the four candidates have nothing at all.

### How these numbers were produced, so they can be re-run

OSM counts are taginfo's Norway instance (6,391 nodes, 40,547 ways, 484
relations, summing to 47,422). The candidate table further down this document
says 47,415, from the same source on 19 August; the seven-object difference is
three days of mapping, not a contradiction, and both figures are left as they
were read. The Innerdal and trailhead records came from Overpass `amenity=parking`
bounding-box queries. Overture was queried straight off the public GeoParquet
with DuckDB `httpfs` against
`s3://overturemaps-us-west-2/release/2026-07-22.0/theme=places/type=place/*.parquet`.
N50 came from the Geonorge download API — a POST order for dataset
`ea192681-d039-42ec-b1bc-f3ce04c189ac`, FGDB, EPSG:25833, fylke 15 and fylke 34 —
reading `objtype='Parkeringsområde'` out of `N50_BygningerOgAnlegg_posisjon` and
reprojecting to WGS84 to measure distances. The `_omrade` layer was checked too
and holds no parking objects at all.

**Still not verified.** NVDB's own national count: the API host answers HTTP 400
to the tooling available here, so NVDB's failure rests on the field report rather
than on a measurement, and a proper count would sharpen the comparison. The
Turtagrø check returned 12 km but is void — Turtagrø is in Vestland and the
Innlandet download is clipped at the county line. And OSM's Innerdal attributes
are a mapper's claim, not a survey; 75 NOK and 89 spaces should be treated as
what someone wrote down, which is the standing caveat on all crowd-sourced
attributes and an argument for showing them with a source, never as fact.

---

## The recommendation, executed — 2026-08-22 (evening)

The recommendation above was taken in full: parking moved to OpenStreetMap, NVDB
was removed rather than kept alongside, and the ODbL copy of the extract was
published at the same time rather than deferred to launch. What follows is what
was actually done and what was actually measured, so the numbers in this
document can be checked against the ones in the repository.

**The pipeline, as predicted, is the real cost.** Geofabrik's
`norway-latest.osm.pbf`, filtered by `scripts/parking/build_parking_extract.py`
(pyosmium, whole-extract node-location index, `idx="flex_mem"`, about 4 GB of
RAM and eight minutes for Norway), into the `parking` table added by
`migrations/0009_parking.sql`, answered by bounding box at `/api/parking`
(`worker/parking.js`). Refresh is monthly and manual for now; the estimate this
document asked for turned out to be roughly a day of work, most of it in the
attribute mapping rather than the extraction.

**The counts.** 47,422 `amenity=parking` features in the extract — the same
number taginfo reported in "How these numbers were produced", which is not a
coincidence to be quietly pleased about but a check worth keeping: the build
script prints it, and an inequality would mean the filter had stopped reading
the whole file. 7,262 were dropped as `access=private|no|permit` or as roadside
parking (`parking=lane|street_side|on_kerb|half_on_kerb|shoulder`); 484 were
relations, which are not handled. **39,676 rows published.**

**The test case is closed.** Innerdalen is `way/171691144`, "Parkering
Innerdalen", 62.738433/8.7101885 — about 25 m from the coordinate in the
original report — with `capacity=89`, `fee=75 NOK`, `surface=asphalt` and
`payment=app,credit_cards`. Every attribute this document predicted OSM would
carry, it carries.

**The licence obligations, discharged.** §4.3 attribution is on the map, the
tab and the printed sheet; §4.6 is `public/data/parking/`, served at
`https://fjellrute.no/data/parking` with the GeoJSON, `LICENSE.txt` and a
`README.md`. `docs/DATA_LICENSES.md` §6 was rewritten around both and is now the
authoritative statement of the posture; this document is the reasoning behind
it, not a second copy of it.

**The mixing rule was honoured literally.** The `/nvdb-api` proxy, the
`NVDB_HEADERS`, the Vite dev-proxy entry and the NLOD credit are gone.
`ParkingArea.source` survives them, which was the point of putting it there —
but it now carries `check ("source" = 'osm')` in the schema, so it is a lock
rather than an invitation. Adding a second source means editing a migration and
re-reading the Horizontal Map Layers analysis, in that order.

**Two regressions the coverage question hid, both found by looking at real
rows rather than at counts.** This document argued the swap on coverage, and
coverage was the easy part; what it did not anticipate is that OSM changes the
*values* as well as the number of them.

The first was a filter bug: `parking=surface` is OSM's way of saying "a normal
open car park", the overwhelming default, and the build script was reading the
`parking` key as a description of what the lot is *for*. 15,214 of 39,676 rows
would have printed "Bruk: surface" directly beneath "Dekke: Asfalt".
`UNINFORMATIVE_PARKING_KINDS` now drops it and `yes` at build time. After the
fix the `usage` column is 3,125 `hiking` and 1,660 `ski` at the top — the two
values this app exists to surface — and nothing meaningless above them.

The second is structural and is the reason `src/parking/format.ts` grew a
tag-translation layer. NVDB answered in Norwegian prose and the panel could
print the field straight through; OSM answers in machine tags, so the same
panel would have shown a Norwegian driver `Dekke: asphalt · Avgift: no ·
Adkomst: yes · Betaling: easypark,mastercard,visa` — worse than the register it
replaced, on a screen that is read in a car park. The maps were built from the
measured value distributions in D1 rather than from the wiki, which is how
`access=customers` (2,849 rows, a fact worth eight hours of worry) got
separated from `access=yes` (4,138 rows, pure noise, now dropped). The rule in
that module is that an unrecognised value is humanised and never dropped: OSM
tagging is open, and a lookup returning null for anything it had not been told
about would silently delete true facts as the data improved.

**What was lost, stated plainly.** NVDB's winter-maintenance attribute. OSM has
no established tag for ploughing, and for a ski-touring app that was the single
most useful column on the briefing sheet. `payment` took its slot, on the
grounds that "app only" is the fact most likely to strand a driver in a valley
with no signal. This is the one respect in which the swap is a regression, and
it is recorded in `ParkingPanel.tsx`, `BriefingSheet.tsx` and
`docs/DATA_LICENSES.md` §6 rather than left to be rediscovered.

**One judgement made without asking, flagged here for disagreement.**
`TERMS_VERSION` was **not** bumped when §7 of `src/terms/content.ts` was
rewritten from NLOD to ODbL, because bumping it re-gates every signed-in alpha
tester behind an acceptance dialog to tell them a credit line changed. The
argument against is that ODbL is share-alike and NLOD is not, so the *kind* of
licence disclosed changed and not only the name. The counter-argument, and the
reason for the call, is that the share-alike obligation runs against Fjellrute
rather than against the user, and its user-facing consequence — a published
extract they may take — adds to their rights rather than subtracting. Reversing
it is two constants, `src/terms/content.ts` and `worker/policyVersions.js`,
which `pnpm test:policies` requires to agree.

**Still open.** Vandalism and staleness monitoring: nothing yet watches for a
car park appearing in a lake or a fee going four years stale, and the "case for
doing nothing" above was right that adopting a crowd-sourced source is a change
in kind. A sanity pass in the build script — features implausibly far from any
road, capacities in the thousands — would be the cheap first version of it. And
the monthly refresh is a calendar reminder rather than a scheduled job.

---

## The radius control — 2026-08-23

The slider is gone. The Parking tab now opens with a sentence — "Viser parkering
innen 3 km fra startpunktet" / "Showing parking within 3 km of the starting
point" — and a cog at the end of it that turns the number into a field. Defaults
in `src/parking/useParking.ts`: **3 km, adjustable 1–20 km in whole
kilometres.**

Three things changed and each is worth separating from the others.

**The wording.** The slider was labelled "Søkeradius fra start" and never said
what the list under it was, so the panel spent its first fold on a control and
described its answer nowhere. The sentence is the label the control needed all
along, and it is also the caveat the empty state already made: these are the
lots *within a radius*, not the lots that exist.

**The default, 2 km → 3 km.** Applied at `PARKING_DEFAULT_RADIUS_M`, so the
printed briefing's fallback moves with it — the two read the same constant
through `parking/radius.ts` precisely so a guide who has not touched the setting
cannot be shown one radius on screen and printed another. 300 m to 2 km is still
the realistic range this document measured; the extra kilometre is slack for the
tour whose start is up a side valley from the road, where 2 km returned nothing
and the guide had to go and widen it by hand to find the obvious car park.

**The unit, 500 m → 1 km steps.** This fixed a quiet lie rather than a
preference: the slider moved in half kilometres under a label that rounded to
whole ones, so 2,500 m displayed — and printed on the briefing — as "3 km". The
radius is now chosen in the same unit it is shown in, and
`parkingRadiusKm()` in `src/parking/format.ts` is the one place that converts.

The ceiling went 10 km → 20 km at the same time, for the long approach up a
closed winter road. It is deliberately behind two actions now (open the cog,
type a number) rather than one drag: a 20 km search is not a radius anyone
should arrive at by overshooting.

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
