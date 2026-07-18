# Winter satellite imagery — evaluated and rejected (July 2026)

Decision: fjellrute does **not** ship a winter satellite imagery layer. The
freely available data is too low-resolution to put in front of customers — it
reads as cheap next to the rest of the app, and a weak flagship layer hurts
the product more than the missing feature does. Better to not include it.

This document records what was evaluated, why it was rejected, and what it
would take to revisit the decision, so the work does not have to be redone.

## Background

FATMAP's signature feature was high-resolution *winter* imagery (snow on the
ground) draped over 3D terrain. Since its shutdown no app has replaced it,
because FATMAP flew its own aerial photography (~0.5 m/px) over selected
massifs — nobody sells that data, and no open source comes close.

## What was evaluated

A complete winter layer was built and working end to end (July 2026, since
removed):

- **Imagery**: Copernicus/CDSE **Sentinel-2 Level-3 quarterly cloudless
  mosaic**, Q1 (Jan–Mar) — genuine winter conditions, 10 m/px, whole of
  Norway. License CC BY 4.0 ("Contains modified Copernicus Sentinel data
  [year] processed by Sentinel Hub"); free for commercial use. Collection id
  `byoc-5460de54-082e-473a-b6ea-d5cbe3c17cca` on sh.dataspace.copernicus.eu.
- **Access**: free CDSE account → Sentinel Hub OGC (WMTS) instance; free tier
  is 50 000 OGC requests + 10 000 processing units per month.
- **Architecture**: Worker route `/winter-tiles/{z}/{x}/{y}.jpg` with a
  permanent R2 write-through cache (same pattern as `/terrain-dem/*`), so
  each tile hits the CDSE quota exactly once, ever. Usable zoom range z7
  (collection rejects requests coarser than 1600 m/px) to z14 (10 m data is
  already oversampled).
- **Quality mitigations tried**: highlight-preserving tone-map evalscript
  (snow reflectance ≈ 1.0 clips to pure white with a naive gain — the tone
  curve recovers real snow texture), Kartverket *fjellskygge* (1 m DTM
  hillshade) multiply-blended over the imagery in 2D, and a DEM hillshade
  layer over the drape in 3D.

## Why it was rejected

10 m/px is the hard ceiling of free winter imagery, and it shows. Even with
the tone-map and hillshade improvements the layer goes soft past ~z13 —
exactly the zoom range where users inspect a couloir or a summit slope. Next
to the crisp Kartverket topo, the 1 m terrain mesh, and NVE's data layers,
the imagery looked out of place: a blurry feature in a sharp product. The
comparison it invites is FATMAP, and at 20× coarser resolution it loses that
comparison instantly.

Paid alternatives don't change the calculus at fjellrute's scale (July 2026
list prices): country-wide Pléiades Neo 30 cm archive ≈ €5.8 M (≈ €18/km²,
mainland Norway ≈ 324 000 km²); Norge i bilder orthophotos are summer-only
and licensed per km² (≈ 650 kr/km² outside urban areas) plus negotiated web
distribution terms; streaming subscriptions (OneAtlas, SecureWatch, from
~$30 k/yr) do not license public tile republishing at entry tiers.

## If we revisit

Two paths were identified that could clear the quality bar:

1. **AI super-resolution** (e.g. Gamma Earth S2DR3, Sentinel-2 10 m → ~1 m)
   run as a one-off batch over the top touring regions (Lyngen, Jotunheimen,
   Sunnmøre, Romsdalen, Lofoten — order 10–20 000 km²), cached into R2.
   Ballpark hundreds to low thousands of euros. Verify output quality and
   redistribution license before committing.
2. **Per-massif Pléiades winter archive scenes** (€10–18/km², 25 km²
   minimum, plus web-distribution licensing) as a premium feature for a
   handful of marquee destinations.

The complete removed implementation is preserved as
`docs/winter-imagery.patch` — restore it with
`git apply docs/winter-imagery.patch`. It comprises: `worker/winter.js`, the
`'winter'` overlay in `src/types/index.ts`, layers in `Map.tsx` /
`Map3DView.tsx`, picker entries in `MapControls.tsx`, credit in
`MapAttribution.tsx`, plus wiring in `worker/index.js`, `wrangler.jsonc`
(`run_worker_first`) and `vite.config.ts`. A working CDSE OGC configuration
("fjellrute-winter", layer `WINTER`, tone-map evalscript) exists on the CDSE
account; the instance id was kept out of the repo (Worker secret
`CDSE_WINTER_INSTANCE_ID` / `.dev.vars`).
