# Data rights audit — upstream sources, licenses & rate limits

Last verified: 2026-08-22 (§6 rewritten for the NVDB → OpenStreetMap swap;
§§1–5 last checked against the linked pages on 2026-07-13).

This app (Fjellrute) is a commercial service. Every upstream source below has been
checked for (a) whether commercial use is permitted, (b) what attribution is
required, and (c) any service-level usage policy (rate limits, fair use) that is
*separate* from the data license itself.

Summary: **all sources permit commercial use.** All require attribution, which is
shown in the map-corner attribution line (2D Leaflet + 3D MapLibre), in the
in-app info dialog (`TermsDialog.tsx`), and in the Terms of Service
(`docs/terms-of-service.{en,no}.md`).

One source, **OpenStreetMap (§6)**, is additionally **share-alike**. Its
obligations do not stop at a credit line, they constrain the architecture, and
they are the reason parking is a single-source layer. Read §6 before adding any
data to that feature.

---

## 1. Kartverket — topo WMTS tiles, place names (SSR), elevation API

Endpoints used:

- `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png` (basemap, 2D + 3D)
- `https://ws.geonorge.no/stedsnavn/v1/navn` (place-name search)
- `https://ws.geonorge.no/hoydedata/v1/punkt` (point elevation)

**License:** Creative Commons Attribution 4.0 (CC BY 4.0). Commercial use is
explicitly permitted — the terms apply "for both commercial and non-commercial
purposes."

**Attribution:** "© Kartverket", with a link to kartverket.no where possible.
For systematic use of place names from SSR, Kartverket asks for wording like
"place names are obtained from SSR © Kartverket" with a link (covered in our
ToS/info dialog).

**Tile-service usage policy (distinct from the data license):**

- Kartverket restructured its cache/WMTS offering in 2024 (consolidated from
  ~25–30 services to a handful, all moved from `*.statkart.no` to
  `cache.kartverket.no`) explicitly *because of load*. No hard published
  req/s number, but the terms state that "some of the Norwegian Mapping
  Authority's APIs/services are subject to technical limitations. These will
  be stated for each service" — i.e. Kartverket reserves the right to
  throttle/limit per service.
- Zoom levels 12–20 in the cache/WMS services contain Geovekst-sourced data:
  it may be *displayed* in services as-is, but **copying or repurposing that
  data (e.g. bulk tile scraping, harvesting into our own tile store) requires
  separate permission** from post@kartverket.no. Displaying tiles live in the
  client, as we do, is fine. Do not add server-side tile prefetch/mirroring
  for z12+ without asking Kartverket first.
- **Offline caching of z12+ topo tiles is a form of "copying" this data and
  is therefore currently disallowed.** The offline downloader caps topo at
  z11 (`maxDownloadZoom: 11` in `packages/core/src/offline/layers.ts`) so no Geovekst-
  restricted tile is ever persisted to a user's device. This is why a
  downloaded topo area looks crisp online but blurs when you zoom in close
  offline (most visible in the 3D view) — it is a licensing limit, not a bug.
- **Permission request status: PENDING — under handling by Kartverket.** A
  request to cache z12+ topo tiles offline has been submitted to
  post@kartverket.no and is awaiting their decision. Until written permission
  is on file, the z11 cap stays. Once granted, raise `maxDownloadZoom` on the
  topo layer (one line) and note the grant reference here.
- Action item satisfied: we only display tiles client-side; no bulk download,
  and offline caching is capped at the licence-safe z11 pending the request above.

Links:
- Terms of use: https://www.kartverket.no/en/api-and-data/terms-of-use
- Norwegian terms: https://www.kartverket.no/api-og-data/vilkar-for-bruk
- Cache/WMTS service docs: https://cache.kartverket.no/
- 2024 cache-service restructuring notice: https://www.geonorge.no/aktuelt/Se-siste-nyheter/store-endringer-i-kartverkets-cachetjenester/

## 2. MET Norway — api.met.no (Locationforecast 2.0)

Endpoint used: `https://api.met.no/weatherapi/locationforecast/2.0/compact`
(proxied through our Worker at `/metno-api`).

**License:** CC BY 4.0 (some datasets NLOD). **Commercial use permitted.**

**Hard service requirements (ToS, not just license):**

- **Identifying User-Agent is mandatory**, with app/domain name and contact
  info; anonymous clients "risk being blocked without warning."
  ✅ Our Worker stamps `fjellrute/0.1 contact@fjellrute.no` (`worker/proxy.js:16`).
  Note: the Vite dev proxy uses a different UA (`vite.config.ts:48`) — both are
  compliant in form.
- **Rate limit: 20 requests/second per application, total** (not per end
  user). Above that requires a special agreement; violations may be throttled
  or blocked. Our per-route, on-demand fetch pattern is far below this, but if
  we ever add map-wide weather sampling, this is the ceiling.
- **Caching is mandatory:** honour the `Expires` header and use
  `If-Modified-Since`; do not re-request unchanged data.
  ✅ Our Worker caches all `/metno-api` responses at the Cloudflare edge with a
  fixed TTL (`worker/proxy.js`), so repeat lookups never reach api.met.no.
  It uses a fixed TTL rather than the upstream `Expires` header — acceptable
  in practice, see action item below.
- **Attribution required** (CC BY 4.0): credit MET Norway with a license link.
  ✅ Now shown in the map-corner attribution and info dialog.
- **Trademark restriction:** must not use "Yr" in the service name or the Yr
  logo. (We don't.)

Links:
- Terms of Service: https://api.met.no/doc/TermsOfService
- Getting started / caching & UA details: https://api.met.no/doc/GettingStarted

## 3. NVE — bratthet/utløp (steepness + runout), Varsom avalanche API

Endpoints used:

- `https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/tile/{z}/{y}/{x}` (+ `/export` for pixel sampling in `packages/core/src/elevation/runout.ts`)
- `https://api01.nve.no/hydrology/forecast/avalanche/v6.3.2/api/AvalancheWarningByCoordinates/Detail` (proxied at `/varsom-api`)

**License: verified — NLOD (Norsk lisens for offentlige data), compatible with
CC BY 3.0 NO.** NLOD §3 explicitly grants the right to "copy, distribute, adapt
and exploit the information **for commercial and non-commercial purposes**."
Commercial use: OK.

**Attribution:** NVE asks that "when using data you should, as far as possible,
link to the relevant service." Standard NLOD credit line: "Contains data under
the Norwegian licence for Open Government data (NLOD) made available by NVE."
Avalanche forecasts should credit Varsom.no/NVE. ✅ shown in map corner +
dialog.

**Rate limits:** NVE publishes **no** rate limit for the WMTS/export or Varsom
APIs. Data is provided "as is," no timeliness guarantee, no liability. The
`/export` pixel-sampling endpoint renders per request (uncached) — keep our
request volume conservative; contact NVE (via api.nve.no / gis@nve.no) before
any high-volume/systematic harvesting.

⚠️ Safety caveat worth keeping in the ToS: the bratthet/utløp layers are
model-derived *aktsomhetskart* (awareness maps), not a route clearance — NVE
disclaims responsibility for decisions based on them.

Links:
- NVE open data & API terms: https://www.nve.no/om-nve/apne-data-og-api-fra-nve/
- NLOD 2.0 license text: https://data.norge.no/nlod/en/2.0
- Varsom API docs: https://api.nve.no/doc/snoeskredvarsel/

## 4. seNorge / xgeo snow grids (via NVE)

Endpoints used:

- `https://kart.nve.no/enterprise/services/seNorgeGrid_png/ImageServer/WMSServer` (snow-depth WMS overlay, 2D + 3D)
- `https://gts.nve.no/api/GridTimeSeries/...` (snow-depth values, proxied at `/gts-api`)

**License: verified — NLOD.** The seNorge grids are produced jointly by MET
Norway and NVE (with Kartverket), and are distributed by NVE (GTS API, kart.nve.no,
xgeo.no) under NVE's open-data terms, i.e. NLOD → **commercial use OK with
attribution.** The underlying MET observations/forecasts are CC BY 4.0.

**Attribution:** credit both producers: "Snødybde © NVE / MET Norway (seNorge)."
✅ Map-corner attribution updated to include MET alongside NVE/seNorge.

**Rate limits:** none published for GTS or the WMS ImageServer, but the
ImageServer renders every WMS request on the fly (no tile cache) — the client
already minimizes requests (512px tiles, maxNativeZoom 9, updateWhenIdle,
keepBuffer). Same rule as NVE above: check with NVE before bulk/systematic use.

Links:
- About seNorge: https://www.senorge.no/aboutSeNorge
- GTS API: https://gts.nve.no/ (docs: https://gts.nve.no/swagger)
- NVE open data terms: https://www.nve.no/om-nve/apne-data-og-api-fra-nve/

## 5. 3D terrain DEM — Kartverket NDH (self-hosted) + Mapzen/AWS fallback

Endpoint used: `/terrain-dem/{z}/{x}/{y}.png` (our Worker, `worker/terrain.js`),
which serves, in order:

1. **Self-generated Terrarium tiles from Kartverket's national elevation
   model (NDH DTM, 1 m / 10 m)**, stored in R2 and produced by
   `scripts/terrain/make_terrarium_tiles.py` from GeoTIFF exports off
   https://hoydedata.no.

   **License: CC BY 4.0 (© Kartverket).** Important distinction from the
   Geovekst restriction in §1: that restriction covers the *topo map cache
   tiles* at z12+; the høydedata **elevation model itself is openly licensed**
   — bulk download and derived products (our tiles) are explicitly permitted.
   Attribution "Terrain © Kartverket (CC BY 4.0)" is shown in the 3D map
   credits (`MapAttribution.tsx`).

2. **Fallback: AWS Open Data Terrarium tiles**
   (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`)
   for areas not yet covered by our tiles: hosted on the AWS Open Data
   registry, free for any use; upstream sources (incl. USGS, ArcticDEM,
   EU-DEM) require attribution, which the 3D map credits show.

Links:
- Høydedata / NDH: https://hoydedata.no (license: https://creativecommons.org/licenses/by/4.0/)
- AWS terrain tiles: https://registry.opendata.aws/terrain-tiles/

## 6. OpenStreetMap — parking areas (`amenity=parking`)

Replaced Statens vegvesen's NVDB on **2026-08-22**. The former §6 is preserved
in `docs/parking-data-sources.md`; the short version is that NVDB registers the
parking the road authority administers, which is not the same set as the lots
Norwegian tours start from, and this is the one source swap made for coverage
rather than for terms.

What we use:

- **Source file:** `https://download.geofabrik.de/europe/norway-latest.osm.pbf`
  (Geofabrik's Norway extract of the OSM planet).
- **Build:** `scripts/parking/build_parking_extract.py` filters the extract to
  `amenity=parking`, drops `access=private|no|permit` and roadside parking
  (`parking=lane|street_side|on_kerb|half_on_kerb|shoulder`), reduces closed
  ways to their centroid, and writes both the D1 loader SQL and the published
  bundle below. Relations are not included.
- **Serving:** rows live in the `parking` table in our own D1
  (`migrations/0009_parking.sql`) and are answered by bounding box at
  `/api/parking` (`worker/parking.js`). Nothing is fetched from an OSM server
  at request time.

**License: Open Database License (ODbL) 1.0**, with the individual contents
under the Database Contents License. Commercial use: explicitly permitted. ODbL
is, however, the only **share-alike** license in this document, and it carries
two obligations the others do not.

**§4.3 — attribution wherever the work is publicly used.** ✅
"© OpenStreetMap contributors (ODbL)" appears under the Parking tab
(`SourceAttribution`), in the map-corner attribution while parking pins are
shown (`MapAttribution.tsx`), and on the printed briefing's credit line
(`BriefingSheet.tsx`) — the printed sheet being a Produced Work in ODbL's sense,
which is why the credit prints even when the section came back empty.

**§4.6 — the database behind a publicly used Produced Work must itself be
made available, under ODbL, at no more than a reasonable cost.** ✅ Discharged
at **https://fjellrute.no/data/parking** (`apps/web/public/data/parking/`), which serves
the extract as GeoJSON alongside `LICENSE.txt` and a `README.md` recording
provenance and filter rules. Three things depend on that URL continuing to
resolve, and all three are easy to break silently:

1. `'/data/parking'` is in `STATIC_PAGES` in `worker/knownPaths.js`. Remove it
   and the path 302s to the site root, turning a licence obligation into a
   redirect nobody notices.
2. `apps/web/public/data/parking/` is **committed**, deliberately, and is the one
   generated artefact in the tree that is. The 4 MB loader SQL is not — it goes
   to the gitignored `build/`, and `--from-geojson` rebuilds it from the
   published copy, so the committed file is both the obligation and the source
   of truth.
3. `packages/core/src/terms/content.ts` §7 and this section both name the URL. Moving it
   means changing both.

**Share-alike, and why parking is all-OSM or nothing.** Under the OSMF
Collective Database Guideline, Fjellrute's own data (routes, tracks, saved
tours) stays a separate database in a collection rather than a Derivative
Database, so ODbL does not reach it. That holds while parking is *all* OSM or
*all* non-OSM within one regional cut. The Horizontal Map Layers Guideline is
the sharper edge: two complementary sources for the **same feature type** in the
same area do trigger share-alike. So NVDB was **removed** rather than kept as a
gap-filler, and `ParkingArea.source` stays a mandatory discriminator with a
`check ("source" = 'osm')` on the column — the schema will reject a second
source rather than let one arrive unnoticed. Do not add one without redoing this
analysis.

**Service requirements (distinct from the license):**

- **The Overpass API is not used, and must not be.** Its fair-use policy
  excludes production application traffic. Bulk extract plus our own D1 is the
  supported pattern and also the faster one.
- **Refresh:** monthly, by re-running the build against a fresh Geofabrik
  extract and reloading the table. The counts quoted in
  `apps/web/public/data/parking/index.html` come from that run and are updated with it.
- **Nominatim is not used** either — no geocoding against OSM infrastructure.

**Coverage, measured.** The 2026-08-22 build saw 47,422 `amenity=parking`
features in the Norway extract — exactly the national count taginfo reported for
that tag, which is the standing check that the filter reads the whole file.
7,262 were dropped by the access and roadside filters and 484 were relations,
leaving **39,676 published**. Innerdalen, the lot whose absence started this,
is `way/171691144` with `capacity=89`, `fee=75 NOK` and `payment=app;credit_cards`.

⚠️ **Regression, recorded rather than glossed.** NVDB carried a winter
maintenance attribute; OSM has no established equivalent tag, and the field is
gone. For a ski-touring app that was the single most useful column on the sheet.
It was traded for coverage — a field reliably present about the wrong car parks,
for a wider set of the right ones — and `payment` took its slot on the briefing,
"app only" being the fact most likely to strand someone in a valley with no
signal. If OSM settles on a ploughing tag, `ParkingPanel.tsx` is where it goes
back.

**Corrections belong upstream.** A wrong or missing lot is fixed by editing
OpenStreetMap, not by patching our table; the edit then reaches every consumer
of the data at the next monthly refresh. That is the better half of the bargain
and is stated as such on the download page.

Links:
- OSM copyright & attribution: https://www.openstreetmap.org/copyright
- ODbL 1.0 license text: https://opendatacommons.org/licenses/odbl/1-0/
- Collective Database Guideline: https://wiki.osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline
- Horizontal Map Layers Guideline: https://wiki.osmfoundation.org/wiki/Licence/Community_Guidelines/Horizontal_Map_Layers_-_Guideline
- Produced Work Guideline: https://wiki.osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline
- Geofabrik Norway extract: https://download.geofabrik.de/europe/norway.html
- Our published extract: https://fjellrute.no/data/parking

---

## Where attribution is displayed

1. **Map corner (always visible):** Leaflet attribution control (2D) and
   MapLibre attribution control (3D, now expanded, not collapsed) — credits
   Kartverket, NVE/seNorge, MET Norway, Varsom, Mapzen/AWS, and OpenStreetMap
   contributors while parking pins are shown.
2. **Terms of use, §7 "Data sources and licences":** `packages/core/src/terms/content.ts`,
   English and Norwegian, full wording with license names (NLOD, CC BY 4.0,
   ODbL 1.0) — rendered both by the acceptance gate (`TermsPage`) and by the
   in-app info dialog (`TermsDialog.tsx`), which hold no copy of their own.
   This is also the only place in the UI that names the §4.6 download URL.
3. **Data panels:** `apps/web/src/components/SourceAttribution.tsx` under the snow,
   avalanche and parking panels.
4. `docs/terms-of-service.{en,no}.md` are **pointers** to §7 above, not a
   second copy — deliberately, so there is only one terms text to keep true.
5. **Printed briefing:** the credit line at the foot of the sheet
   (`apps/web/src/briefing/BriefingSheet.tsx`), which credits only the sources whose
   sections were actually switched on — a sheet with parking off does not cite
   OpenStreetMap, and the test harness asserts that in both directions. The
   parking credit is the one on that line that is a licence term (ODbL §4.3)
   rather than a courtesy, which is also why it prints when the section came
   back empty: "nothing mapped within 2 km" is itself a statement sourced from
   OSM.
6. **The extract itself:** https://fjellrute.no/data/parking, which is ODbL
   §4.6 rather than attribution, but belongs on this list because it is the
   obligation most easily lost in a refactor.

### A note on `TERMS_VERSION`

§7 of `packages/core/src/terms/content.ts` has twice been edited **without bumping
`TERMS_VERSION`** (still `2026-07-16`): once when the NVDB credit was added, and
again on 2026-08-22 when that credit was replaced by OpenStreetMap under ODbL.
The judgement is the same both times: §7 discloses whose data the app shows and
on what terms, nothing in either edit changes what the user may do or what
Fjellrute promises, and bumping the version puts every existing user back
through the acceptance gate to be told a credit line changed.

Recorded here rather than left implicit so a reviewer can disagree with it. The
second edit is the more arguable of the two, because ODbL is share-alike and
NLOD is not — but the share-alike obligation runs against *Fjellrute*, not
against the user, and the user-facing consequence of it (the published extract)
is an addition to their rights rather than a subtraction. If the call is wrong,
the fix is two constants: `TERMS_VERSION` here and its copy in
`worker/policyVersions.js`, which `pnpm test:policies` requires to agree.

## Open action items

- Kartverket permission request (submitted, **pending — under handling**):
  we have asked Kartverket (post@kartverket.no) for permission to cache z12+
  topo tiles offline. Until it is granted, the offline downloader stays capped
  at z11 (`packages/core/src/offline/layers.ts`, `maxDownloadZoom: 11`). When the reply
  arrives, record the outcome here and, if approved, raise the cap.
- If traffic grows, ask Kartverket about a service agreement before any
  server-side tile caching of z12+ (Geovekst restriction).
- Nice-to-have: switch the Worker's fixed-TTL edge cache for `/metno-api` to
  honour MET's `Expires` header and send `If-Modified-Since` on revalidation,
  matching the ToS wording exactly (current fixed-TTL caching already prevents
  re-requesting unchanged data, which is the intent of the rule).
- No formal written confirmation exists from NVE re: high-volume use of the
  uncached `/export` sampling endpoint — get one before scaling that feature.
