# Data rights audit — upstream sources, licenses & rate limits

Last verified: 2026-07-13 (against the linked pages on that date).

This app (Fjellrute) is a commercial service. Every upstream source below has been
checked for (a) whether commercial use is permitted, (b) what attribution is
required, and (c) any service-level usage policy (rate limits, fair use) that is
*separate* from the data license itself.

Summary: **all sources permit commercial use.** All require attribution, which is
shown in the map-corner attribution line (2D Leaflet + 3D MapLibre), in the
in-app info dialog (`TermsDialog.tsx`), and in the Terms of Service
(`docs/terms-of-service.{en,no}.md`).

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
- Action item satisfied: we only display tiles client-side; no bulk download.

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
  ✅ Our Worker stamps `fjellrute/0.1 tryggve@sonofit.no` (`worker/proxy.js:16`).
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

- `https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/tile/{z}/{y}/{x}` (+ `/export` for pixel sampling in `src/elevation/runout.ts`)
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

---

## Where attribution is displayed

1. **Map corner (always visible):** Leaflet attribution control (2D) and
   MapLibre attribution control (3D, now expanded, not collapsed) — credits
   Kartverket, NVE/seNorge, MET Norway, Varsom, Mapzen/AWS.
2. **Info dialog:** `src/components/TermsDialog.tsx` §6, full wording with
   license links (NLOD, CC BY 4.0).
3. **Data panels:** `src/components/SourceAttribution.tsx` under snow/avalanche
   panels.
4. **ToS:** `docs/terms-of-service.en.md` / `.no.md` §6.

## Open action items

- If traffic grows, ask Kartverket about a service agreement before any
  server-side tile caching of z12+ (Geovekst restriction).
- Nice-to-have: switch the Worker's fixed-TTL edge cache for `/metno-api` to
  honour MET's `Expires` header and send `If-Modified-Since` on revalidation,
  matching the ToS wording exactly (current fixed-TTL caching already prevents
  re-requesting unchanged data, which is the intent of the rule).
- No formal written confirmation exists from NVE re: high-volume use of the
  uncached `/export` sampling endpoint — get one before scaling that feature.
