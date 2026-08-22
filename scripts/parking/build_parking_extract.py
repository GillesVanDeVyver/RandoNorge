#!/usr/bin/env python3
"""Build the Fjellrute parking dataset from the OpenStreetMap Norway extract.

Replaces the live NVDB (Statens vegvesen, type 43) query the app used to make
per-request. NVDB's parkeringsområde register covers lots the road authority
administers; it does not cover the trailhead lots that matter for topptur
planning. OSM does — measured coverage is ~47.4k amenity=parking features in
Norway, including Innerdalen (way 171691144, capacity 89, 75 NOK), which NVDB
does not return. See docs/parking-data-sources.md for the full measurement.

Data source and licence:
    https://download.geofabrik.de/europe/norway-latest.osm.pbf
    © OpenStreetMap contributors, Open Database License (ODbL) 1.0.
    https://opendatacommons.org/licenses/odbl/1-0/

    ODbL is share-alike. Two obligations follow and BOTH are handled here:
      1. Attribution — "© OpenStreetMap contributors" must appear wherever
         parking is shown (map credits, briefing sheet, DATA_LICENSES.md).
      2. §4.6, access to the derived database — anyone receiving a Produced
         Work made from this data may demand the database behind it. This
         script therefore also writes a redistributable ODbL bundle
         (--publish-dir) that the app serves for download. Do not ship the
         D1 table without shipping the bundle.

    Fjellrute's own route data stays proprietary under the OSMF Collective
    Database Guideline, which holds only while parking is "all OSM or all
    non-OSM within the same regional cut". That is why this script is a
    replacement for NVDB and not a supplement to it: mixing two parking
    sources makes them complementary interacting layers for one feature type,
    which is precisely the share-alike trigger. Do not add a second parking
    source to this pipeline.

Usage — full refresh from upstream (needs ~4 GB RAM, takes ~8 min for Norway):
    pip install osmium
    curl -O https://download.geofabrik.de/europe/norway-latest.osm.pbf
    python scripts/parking/build_parking_extract.py norway-latest.osm.pbf \
        --sql-out build/parking.sql \
        --publish-dir public/data/parking

Usage — regenerate only the D1 loader, from what is already in the repo:
    python scripts/parking/build_parking_extract.py \
        --from-geojson public/data/parking/parking-norway.geojson \
        --sql-out build/parking.sql

Outputs:
    parking.sql       batched INSERTs for the D1 "parking" table (0009_parking.sql)
    parking.ndjson    one normalised row per line, for inspection and diffing
    <publish-dir>/parking-norway.geojson   ODbL redistribution copy
    <publish-dir>/LICENSE.txt              ODbL 1.0 notice + attribution
    <publish-dir>/README.md                provenance, filter, build date

Only the publish bundle is committed. The SQL is a build product — 4 MB of
generated INSERTs regenerated every refresh is not something to accumulate in
git history, and --from-geojson means nobody needs the 1.4 GB PBF to rebuild
it. build/ is gitignored.

Measured on the 2026-08-22 Norway extract: 6,391 nodes + 40,547 ways + 484
relations = 47,422 amenity=parking features, exactly matching taginfo's
national count that day. 7,262 were dropped (private access, roadside
parking), 484 relations were not resolved, leaving 39,676 rows.

Refresh cadence: Geofabrik rebuilds nightly. Monthly is ample for parking —
run this script, apply the generated SQL, redeploy. The Worker serves rows by
bounding box only; distances are computed client-side so no route-derived
value is ever persisted or edge-cached alongside OSM data.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import osmium
except ImportError as e:  # pragma: no cover
    sys.exit(f"missing dependency: {e.name} — run: pip install osmium")

# Norway extract bounds (Geofabrik includes Svalbard and Jan Mayen).
LAT_MIN, LAT_MAX = 57.0, 81.0
LON_MIN, LON_MAX = -10.0, 36.0

# Values of amenity=parking's access tag that mean "you cannot park here".
PRIVATE_ACCESS = {"private", "no", "permit"}

# parking=* values that are not surface lots a driver can pull into.
SKIP_PARKING_KINDS = {"lane", "street_side", "on_kerb", "half_on_kerb", "shoulder"}

# parking=* values that are true but say nothing, so they do not go in `usage`.
#
# `surface` is the tag 15,214 of the 39,676 published rows carry — it means
# "an ordinary car park at ground level", which is what the reader already
# assumes and is not what the "Bruk / Use" row on the tab and the briefing
# sheet is for. Worse, printed there it sits directly under "Dekke / Surface",
# which holds `surface=asphalt|gravel|…`, so the sheet would read
# "Dekke: Asfalt · Bruk: surface" and invite the reader to work out which of
# the two words about surfaces is the one they wanted.
#
# The kinds that survive this filter — underground, multi-storey, rooftop,
# carports, sheds, layby — all change what the driver is looking for when they
# arrive, so they stay. `yes` is the same kind of noise as `surface`.
UNINFORMATIVE_PARKING_KINDS = {"surface", "yes"}

ODBL_URL = "https://opendatacommons.org/licenses/odbl/1-0/"
OSM_COPYRIGHT = "© OpenStreetMap contributors"

_INT_RE = re.compile(r"-?\d+")


def parse_int(value: str | None) -> int | None:
    """OSM capacity is free text: '89', '~20', '30 (+2 HC)', 'yes'. Take the
    first integer if there is one, else None. Never guess."""
    if not value:
        return None
    m = _INT_RE.search(value)
    if not m:
        return None
    try:
        n = int(m.group())
    except ValueError:
        return None
    # Reject nonsense rather than store it.
    return n if 0 < n <= 100_000 else None


def clean(value: str | None, limit: int = 120) -> str | None:
    """Trim, collapse whitespace, drop empties, cap length."""
    if not value:
        return None
    text = " ".join(value.split())
    if not text:
        return None
    return text[:limit]


def fee_of(tags) -> str | None:
    """Collapse OSM's several fee tags into one human string.

    fee=yes with charge=75 NOK  →  '75 NOK'
    fee=yes alone               →  'yes'
    fee=no                      →  'no'
    """
    charge = clean(tags.get("charge") or tags.get("fee:amount"))
    fee = clean(tags.get("fee"))
    if charge:
        return charge
    if fee in {"yes", "no", "interval", "seasonal", "donation"}:
        return fee
    return fee


def payment_of(tags) -> str | None:
    """Comma-joined list of accepted payment methods, from payment:*=yes."""
    methods = []
    for tag in tags:
        if tag.k.startswith("payment:") and tag.v == "yes":
            method = tag.k.split(":", 1)[1]
            if method and method not in methods:
                methods.append(method)
    if not methods:
        return None
    methods.sort()
    return ",".join(methods)[:120]


def usage_of(tags) -> str | None:
    """What the lot is for, as tagged. hiking/ski are the ones we care about.

    Deliberately not everything true about the lot: this string is printed as
    one short "Bruk / Use" row, so a value that every second row carries pushes
    the two that matter to this app out of the reader's eye. See
    UNINFORMATIVE_PARKING_KINDS.
    """
    parts = []
    if tags.get("hiking") == "yes":
        parts.append("hiking")
    if tags.get("ski") == "yes":
        parts.append("ski")
    kind = clean(tags.get("parking"))
    if kind and kind not in UNINFORMATIVE_PARKING_KINDS:
        parts.append(kind)
    for key in ("tourism", "trailhead"):
        val = clean(tags.get(key))
        if val and val != "no":
            parts.append(f"{key}={val}")
    return ",".join(parts)[:120] if parts else None


def row_from(
    osm_type: str,
    osm_id: int,
    lat: float,
    lon: float,
    tags,
    dropped: dict[str, int] | None = None,
) -> dict | None:
    """Normalise one OSM parking feature onto the app's ParkingArea shape.

    Returns None for features we deliberately drop, counting the reason in
    `dropped`. Dropping silently is how coverage claims become wrong: the run
    should be able to say "39,676 kept, 7,262 dropped, and here is the
    breakdown", so a future argument about coverage is settled by the log
    rather than by re-reading this function.
    """
    def drop(reason: str) -> None:
        if dropped is not None:
            dropped[reason] = dropped.get(reason, 0) + 1

    if tags.get("amenity") != "parking":
        return None
    if tags.get("access") in PRIVATE_ACCESS:
        drop(f"access={tags.get('access')}")
        return None
    if tags.get("parking") in SKIP_PARKING_KINDS:
        drop(f"parking={tags.get('parking')}")
        return None
    # parking=underground / multi-storey have no useful trailhead role but are
    # legitimate destinations in towns; keep them.
    if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
        drop("out of bounds")
        return None

    return {
        "id": f"{osm_type}/{osm_id}",
        "source": "osm",
        "lat": round(lat, 7),
        "lon": round(lon, 7),
        "name": clean(tags.get("name") or tags.get("operator:short") or tags.get("ref")),
        "capacity": parse_int(tags.get("capacity")),
        "fee": fee_of(tags),
        "surface": clean(tags.get("surface"), 60),
        "access": clean(tags.get("access"), 60),
        "operator": clean(tags.get("operator")),
        "usage": usage_of(tags),
        "payment": payment_of(tags),
        "maxstay": clean(tags.get("maxstay"), 60),
    }


class ParkingHandler(osmium.SimpleHandler):
    """Collect amenity=parking nodes and ways (ways reduced to a centroid)."""

    def __init__(self) -> None:
        super().__init__()
        self.rows: list[dict] = []
        self.seen_nodes = 0
        self.seen_ways = 0
        self.skipped_relations = 0
        self.dropped: dict[str, int] = {}
        self.no_geometry = 0

    def node(self, n) -> None:
        if n.tags.get("amenity") != "parking":
            return
        self.seen_nodes += 1
        row = row_from("node", n.id, n.location.lat, n.location.lon, n.tags, self.dropped)
        if row is not None:
            self.rows.append(row)

    def way(self, w) -> None:
        if w.tags.get("amenity") != "parking":
            return
        self.seen_ways += 1
        lat, lon = centroid(w)
        if lat is None:
            self.no_geometry += 1
            return
        row = row_from("way", w.id, lat, lon, w.tags, self.dropped)
        if row is not None:
            self.rows.append(row)

    def relation(self, r) -> None:
        # Multipolygon parking areas. Resolving them needs a second pass over
        # member ways; there are only a few hundred nationally and they are
        # mostly large urban complexes, not trailheads. Counted, not silently
        # ignored — see the summary this script prints.
        if r.tags.get("amenity") == "parking":
            self.skipped_relations += 1


def centroid(way) -> tuple[float | None, float | None]:
    """Mean of a way's node positions. Good enough for a parking polygon —
    these are convex-ish lots tens of meters across, and the app rounds
    distances to the nearest 10 m anyway. Skips ways with missing locations."""
    lat_sum = lon_sum = 0.0
    count = 0
    for node in way.nodes:
        if not node.location.valid():
            continue
        lat_sum += node.location.lat
        lon_sum += node.location.lon
        count += 1
    if count == 0:
        return None, None
    return lat_sum / count, lon_sum / count


def sql_literal(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


COLUMNS = (
    "id",
    "source",
    "lat",
    "lon",
    "name",
    "capacity",
    "fee",
    "surface",
    "access",
    "operator",
    "usage",
    "payment",
    "maxstay",
)


def write_sql(rows: list[dict], path: Path, batch: int, built_at: str) -> None:
    """Emit a self-contained loader: clear the table, then batched INSERTs.

    D1 caps a single statement's size, so rows are chunked. The delete-then-
    insert is deliberate: OSM ids disappear when mappers merge features, and a
    stale row is worse than a missing one when someone is choosing where to
    leave a car at 6am."""
    path.parent.mkdir(parents=True, exist_ok=True)
    quoted = ", ".join(f'"{c}"' for c in COLUMNS)
    with path.open("w", encoding="utf-8") as fh:
        fh.write(f"-- Fjellrute parking data, generated {built_at}\n")
        fh.write(f"-- Source: OpenStreetMap Norway extract (Geofabrik). {OSM_COPYRIGHT}.\n")
        fh.write(f"-- Licence: Open Database License (ODbL) 1.0 — {ODBL_URL}\n")
        fh.write("-- Generated by scripts/parking/build_parking_extract.py — do not hand-edit.\n")
        fh.write(f"-- Rows: {len(rows)}\n\n")
        fh.write('delete from "parking";\n\n')
        for start in range(0, len(rows), batch):
            chunk = rows[start : start + batch]
            fh.write(f'insert into "parking" ({quoted}) values\n')
            values = [
                "  (" + ", ".join(sql_literal(row[c]) for c in COLUMNS) + ")"
                for row in chunk
            ]
            fh.write(",\n".join(values))
            fh.write(";\n\n")


def write_ndjson(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
            fh.write("\n")


def write_publish_bundle(rows: list[dict], directory: Path, built_at: str, source_url: str) -> None:
    """Write the ODbL §4.6 redistribution copy: the data, its licence, and
    enough provenance that a recipient can rebuild it themselves."""
    directory.mkdir(parents=True, exist_ok=True)

    features = []
    for row in rows:
        props = {k: v for k, v in row.items() if k not in ("lat", "lon") and v is not None}
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [row["lon"], row["lat"]]},
                "properties": props,
            }
        )
    geojson = {
        "type": "FeatureCollection",
        "name": "fjellrute-parking-norway",
        "license": "ODbL-1.0",
        "attribution": OSM_COPYRIGHT,
        "generated": built_at,
        "features": features,
    }
    with (directory / "parking-norway.geojson").open("w", encoding="utf-8") as fh:
        json.dump(geojson, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")

    (directory / "LICENSE.txt").write_text(
        f"""{OSM_COPYRIGHT}

This dataset is derived from OpenStreetMap and is made available under the
Open Database License (ODbL) 1.0:

    {ODBL_URL}

Any rights in individual contents of the database are licensed under the
Database Contents License:

    https://opendatacommons.org/licenses/dbcl/1-0/

You are free to copy, distribute, transmit and adapt this data, as long as
you credit OpenStreetMap and its contributors. If you alter or build upon
this data, you may distribute the result only under the same licence.

Published by Fjellrute to satisfy ODbL section 4.6 (access to a Derivative
Database) for the parking layer shown in the Fjellrute application.
""",
        encoding="utf-8",
    )

    (directory / "README.md").write_text(
        f"""# Fjellrute parking extract

{len(rows)} parking areas in Norway, extracted from OpenStreetMap.

- **Source:** {source_url}
- **Built:** {built_at}
- **Licence:** Open Database License (ODbL) 1.0 — see `LICENSE.txt`
- **Attribution:** {OSM_COPYRIGHT}

## What was extracted

Every OSM node and closed way tagged `amenity=parking`, excluding features
tagged `access=private`, `access=no` or `access=permit`, and excluding
roadside parking (`parking=lane`, `street_side`, `on_kerb`, `half_on_kerb`,
`shoulder`). Ways are reduced to the arithmetic centroid of their nodes.
Multipolygon relations are not included.

## Fields

| field | origin |
| --- | --- |
| `id` | `node/<id>` or `way/<id>` — the OSM element |
| `source` | always `osm` |
| `name` | `name`, else `operator:short`, else `ref` |
| `capacity` | first integer found in `capacity` |
| `fee` | `charge` if present, else `fee` |
| `surface` | `surface` |
| `access` | `access` |
| `operator` | `operator` |
| `usage` | `hiking`/`ski`/`parking`/`tourism` tags, comma-joined |
| `payment` | `payment:*=yes` keys, comma-joined |
| `maxstay` | `maxstay` |

## Rebuilding

```sh
pip install osmium
curl -O {source_url}
python scripts/parking/build_parking_extract.py norway-latest.osm.pbf \\
    --sql-out migrations/data/parking.sql \\
    --publish-dir public/data/parking
```
""",
        encoding="utf-8",
    )


def report(handler: ParkingHandler) -> None:
    """What the pass actually saw, in enough detail to argue with.

    The "seen" total should equal taginfo's national amenity=parking count for
    the same day — that equality is the cheapest available check that the
    filter is reading the whole extract and not a subset of it."""
    total_seen = handler.seen_nodes + handler.seen_ways + handler.skipped_relations
    print(
        f"  amenity=parking seen: {handler.seen_nodes} nodes, {handler.seen_ways} ways, "
        f"{handler.skipped_relations} relations = {total_seen} total\n"
        f"    (should equal taginfo's national amenity=parking count)\n"
        f"  relations skipped (multipolygon, not resolved): {handler.skipped_relations}\n"
        f"  ways with no resolvable geometry: {handler.no_geometry}",
        flush=True,
    )
    for reason, count in sorted(handler.dropped.items(), key=lambda kv: -kv[1]):
        print(f"  dropped, {reason}: {count}", flush=True)
    print(f"  rows kept: {len(handler.rows)}", flush=True)


def read_published_geojson(path: Path) -> list[dict]:
    """Reverse of write_publish_bundle(): the published ODbL copy back into
    rows, so the D1 loader can be regenerated from what is in the repository.

    This exists because the 6 MB GeoJSON is committed (it has to be — it is
    what /data/parking serves) and the 4 MB SQL is not, and a deploy should not
    have to fetch 1.4 GB of Geofabrik to rebuild a table."""
    with path.open(encoding="utf-8") as fh:
        doc = json.load(fh)
    rows: list[dict] = []
    for feature in doc.get("features", []):
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coords) != 2:
            continue
        props = feature.get("properties") or {}
        row = {c: props.get(c) for c in COLUMNS}
        row["lon"], row["lat"] = coords[0], coords[1]
        if not row["id"]:
            continue
        row["source"] = "osm"
        rows.append(row)
    if not rows:
        sys.exit(f"no usable features in {path}")
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract amenity=parking from an OSM PBF into D1-loadable SQL.",
    )
    parser.add_argument(
        "pbf",
        type=Path,
        nargs="?",
        help="OSM .pbf extract (e.g. norway-latest.osm.pbf)",
    )
    parser.add_argument(
        "--from-geojson",
        type=Path,
        default=None,
        help=(
            "rebuild the SQL from a previously published bundle instead of a "
            "PBF. The 6 MB GeoJSON is in the repo and the 1.4 GB PBF is not, "
            "so this is how a deploy reproduces the loader without a download."
        ),
    )
    parser.add_argument(
        "--sql-out",
        type=Path,
        default=Path("parking.sql"),
        help="path for the generated SQL loader",
    )
    parser.add_argument(
        "--ndjson-out",
        type=Path,
        default=None,
        help="path for the normalised NDJSON dump (default: alongside --sql-out)",
    )
    parser.add_argument(
        "--publish-dir",
        type=Path,
        default=None,
        help="directory for the ODbL redistribution bundle (required for release builds)",
    )
    parser.add_argument(
        "--source-url",
        default="https://download.geofabrik.de/europe/norway-latest.osm.pbf",
        help="URL the PBF came from, recorded in the published bundle",
    )
    parser.add_argument(
        "--batch",
        type=int,
        default=200,
        help="rows per INSERT statement (D1 has a per-statement size limit)",
    )
    args = parser.parse_args()

    if bool(args.pbf) == bool(args.from_geojson):
        sys.exit("give exactly one of: a .pbf path, or --from-geojson")

    built_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if args.from_geojson:
        rows = read_published_geojson(args.from_geojson)
        print(f"read {len(rows)} rows from {args.from_geojson}", flush=True)
    else:
        if not args.pbf.exists():
            sys.exit(f"no such file: {args.pbf}")
        print(
            f"reading {args.pbf} ({args.pbf.stat().st_size / 1e9:.2f} GB)...",
            flush=True,
        )
        handler = ParkingHandler()
        # locations=True needs a node-location index for the whole extract, not
        # just the parking ways — pyosmium cannot know which nodes matter until
        # it reaches the ways that use them. Norway costs roughly 4 GB of RAM
        # and eight minutes this way. "sparse_file_array,<path>" trades that
        # for disk if the machine cannot spare it.
        handler.apply_file(str(args.pbf), locations=True, idx="flex_mem")
        rows = handler.rows
        report(handler)

    # Deterministic order: makes the SQL diffable between monthly rebuilds.
    rows.sort(key=lambda r: r["id"])
    named = sum(1 for r in rows if r["name"])
    with_capacity = sum(1 for r in rows if r["capacity"])
    with_fee = sum(1 for r in rows if r["fee"])
    print(
        f"  named: {named} ({named * 100 // max(len(rows), 1)}%)  "
        f"capacity: {with_capacity}  fee: {with_fee}",
        flush=True,
    )

    write_sql(rows, args.sql_out, args.batch, built_at)
    print(f"wrote {args.sql_out} ({args.sql_out.stat().st_size / 1e6:.1f} MB)")

    ndjson_out = args.ndjson_out or args.sql_out.with_suffix(".ndjson")
    write_ndjson(rows, ndjson_out)
    print(f"wrote {ndjson_out}")

    if args.publish_dir:
        write_publish_bundle(rows, args.publish_dir, built_at, args.source_url)
        print(f"wrote ODbL bundle to {args.publish_dir}/")
    else:
        print(
            "NOTE: --publish-dir not given, so no ODbL redistribution bundle was\n"
            "      written. Release builds must publish one (ODbL section 4.6).",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
