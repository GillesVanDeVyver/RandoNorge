# Fjellrute parking extract

39676 parking areas in Norway, extracted from OpenStreetMap.

- **Source:** https://download.geofabrik.de/europe/norway-latest.osm.pbf
- **Built:** 2026-08-22T14:47:13Z
- **Licence:** Open Database License (ODbL) 1.0 — see `LICENSE.txt`
- **Attribution:** © OpenStreetMap contributors

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
curl -O https://download.geofabrik.de/europe/norway-latest.osm.pbf
python scripts/parking/build_parking_extract.py norway-latest.osm.pbf \
    --sql-out migrations/data/parking.sql \
    --publish-dir public/data/parking
```
