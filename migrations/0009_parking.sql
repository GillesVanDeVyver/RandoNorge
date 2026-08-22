-- Migration 0009: parking areas, from OpenStreetMap.
--
-- Why this exists. The parking tab shipped against NVDB (Statens vegvesen,
-- vegobjekttype 43), queried live through the Worker proxy. NVDB is the road
-- authority's register of the lots the road authority administers, and that
-- turns out to be a different set from the lots people actually start a tour
-- from: Innerdalen — 89 marked spaces, 75 NOK, asphalt, one of the better
-- known trailheads in Trollheimen — is simply not in it. A route planner that
-- cannot find the car park at Innerdalen is not a route planner anyone will
-- trust at the second trailhead either. docs/parking-data-sources.md has the
-- measurement: four candidate sources, one real lot, reproducible counts.
-- OSM was the only one that had it, with 47.4k parking features nationally
-- against NVDB's much thinner trailhead coverage.
--
-- Why a table instead of a live query. OSM's live query interface is the
-- Overpass API, whose fair-use policy explicitly excludes production
-- application traffic — pointing the app at it would be freeloading on
-- volunteer-funded infrastructure and would break the first time it did. So
-- the data is extracted from the Geofabrik Norway PBF once a month by
-- scripts/parking/build_parking_extract.py and loaded here, and the Worker
-- serves it from D1 (worker/parking.js). 47k rows is nothing for D1 and the
-- query becomes a local index scan instead of a third-party round trip.
--
-- THE LICENCE, WHICH SHAPES THE SCHEMA. OSM is ODbL 1.0, which is
-- share-alike. Fjellrute's own route data stays proprietary only under the
-- OSMF Collective Database Guideline, and that guideline holds only while
-- parking is "all OSM or all non-OSM within the same regional cut". Two
-- consequences are baked into this file and must survive future edits:
--
--   1. "source" is not decoration. It is the discriminator that makes the
--      collective-database line auditable — one query tells you whether the
--      parking layer is still single-sourced. It is constrained to 'osm'
--      deliberately. Adding a second parking source (NVDB, Kartverket N50,
--      Overture) would make the layers complementary and interacting for a
--      single feature type, which is exactly the share-alike trigger the
--      Horizontal Map Layers Guideline describes. Widening this CHECK is a
--      licensing decision, not a schema tweak. Read the guideline first.
--
--   2. Nothing route-derived is stored here. No distance to a saved route,
--      no "nearest parking for track X". Those are computed in the browser
--      per session and thrown away. This table holds OSM facts and only OSM
--      facts, so it can be published verbatim under ODbL — which it is, at
--      /data/parking, satisfying ODbL §4.6 (access to a derivative database)
--      for everyone we show the map to.
--
-- Loading. The generated INSERTs go to build/parking.sql, which is NOT a
-- numbered migration and is NOT committed (build/ is gitignored): it is 4 MB
-- regenerated wholesale each refresh, and it starts with `delete from
-- "parking"`. OSM ids vanish when mappers merge features, and a stale car park
-- is worse than a missing one at 6am, so the refresh replaces rather than
-- upserts.
--
-- What IS committed is the published copy, public/data/parking/, because ODbL
-- §4.6 requires us to serve it. Keeping the SQL out of git therefore loses
-- nothing: --from-geojson rebuilds the loader from the file we have to publish
-- anyway, and the round trip is byte-identical to the PBF-built SQL apart from
-- the build timestamp in the header.
--
--   # From a fresh extract (the monthly refresh):
--   python scripts/parking/build_parking_extract.py norway-latest.osm.pbf \
--       --sql-out build/parking.sql --publish-dir public/data/parking
--
--   # From the committed publication (a fresh checkout, or a rollback):
--   python scripts/parking/build_parking_extract.py \
--       --from-geojson public/data/parking/parking-norway.geojson \
--       --sql-out build/parking.sql
--
--   npx wrangler d1 execute fjellrute-db-eu --local  --file build/parking.sql
--   npx wrangler d1 execute fjellrute-db-eu --remote --file build/parking.sql
--
-- Apply this schema locally:  npx wrangler d1 migrations apply fjellrute-db-eu --local
-- Apply in prod:              npx wrangler d1 migrations apply fjellrute-db-eu --remote

create table "parking" (
  -- "node/123" or "way/456" — the OSM element this row came from, which is
  -- also the permalink: https://www.openstreetmap.org/{id}. Stable enough to
  -- be a primary key between refreshes, but not guaranteed forever: mappers
  -- merge and split features, which is why the refresh is a full replace.
  "id" text not null primary key,
  -- Always 'osm'. See the licence note above before touching this.
  "source" text not null default 'osm' check ("source" = 'osm'),
  -- WGS84. For a way, the arithmetic centroid of its nodes — parking
  -- polygons are lots tens of meters across and the UI rounds distances to
  -- the nearest 10 m, so the centroid is well inside the noise.
  "lat" real not null,
  "lon" real not null,
  -- OSM "name", falling back to "operator:short" then "ref". Null is common
  -- and honest: most Norwegian parking areas are mapped as geometry with no
  -- name at all, and the UI shows the distance instead of inventing one.
  "name" text,
  -- First integer found in OSM "capacity" ("89", "~20", "30 (+2 HC)"). Null
  -- when the tag is absent or says something uncountable like "yes".
  "capacity" integer,
  -- "charge" if the mapper recorded an amount ("75 NOK"), else the raw "fee"
  -- value ("yes", "no", "seasonal"). Kept as text on purpose: a price with no
  -- currency, no validity date and no idea when it was last checked should
  -- not be presented as a number the app can do arithmetic on.
  "fee" text,
  -- OSM "surface": asphalt, gravel, ground. Matters in April, when a gravel
  -- lot at 900 m is still under a meter of snow and the asphalt one is not.
  "surface" text,
  -- OSM "access". Rows tagged private/no/permit are dropped by the build
  -- script, so what survives here is 'yes', 'customers', 'destination' and
  -- similar — restrictions worth showing, not prohibitions.
  "access" text,
  "operator" text,
  -- Comma-joined marks of what the lot is for: "hiking", "ski", the
  -- "parking" kind (surface/underground/multi-storey), tourism tags. This is
  -- the field that lets a trailhead lot be told apart from a shopping centre.
  "usage" text,
  -- Comma-joined "payment:*=yes" keys: app, credit_cards, coins. Norwegian
  -- trailhead lots are increasingly app-only, which is worth knowing before
  -- driving three hours into a valley without signal.
  "payment" text,
  "maxstay" text
);

-- The only query the Worker runs is a bounding box: lat between ? and ?, lon
-- between ? and ?. SQLite has no spatial index and D1 has no extensions, but
-- it does not need one at this size. A leading range scan on "lat" narrows
-- 47k national rows to the handful inside a 2-10 km latitude band, and
-- carrying "lon" in the same index lets the second condition be tested from
-- the index without touching the table. Covering the whole projection would
-- double the storage for no measurable gain at this row count.
create index "parking_lat_lon_idx" on "parking" ("lat", "lon");

-- Cheap, and it makes "is the parking layer still single-sourced?" an index
-- lookup rather than a table scan. That question has a licence attached to
-- its answer (see above), so it should stay easy to ask.
create index "parking_source_idx" on "parking" ("source");
