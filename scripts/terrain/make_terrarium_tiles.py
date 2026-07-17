#!/usr/bin/env python3
"""Generate Terrarium-encoded terrain-RGB tiles from Kartverket DTM GeoTIFFs.

This is the offline half of the 3D-terrain upgrade: it turns the national
1 m / 10 m LiDAR elevation model (NDH) into the same 256x256 PNG "Terrarium"
tiles the AWS Open Data tileset uses, so the Worker (worker/terrain.js) can
serve them interchangeably — high-res Kartverket terrain where tiles exist,
AWS fallback everywhere else. The MapLibre client needs no changes per region.

Data source (open, unlike the Geovekst topo *tiles* — see docs/DATA_LICENSES.md):
    https://hoydedata.no  →  export "DTM" (terrengmodell, NOT DOM) as GeoTIFF.
    License: CC BY 4.0 (© Kartverket). Bulk download and derived products are
    explicitly permitted; attribution is shown in the app's map credits.
    DTM 10 m nationwide is a single manageable download; DTM 1 m is exported
    per region — start with the topptur areas (Lyngen, Tromsø, Sunnmøre,
    Romsdal, Lofoten, Jotunheimen).

Usage:
    pip install rasterio numpy pillow
    python make_terrarium_tiles.py DTM_*.tif -o tiles/ --zooms 8-15

    # optional: fill pixels outside DTM coverage from the AWS tile instead
    # of leaving them void (recommended for edge tiles along the coast):
    python make_terrarium_tiles.py DTM_*.tif -o tiles/ --zooms 8-15 --fill-aws

Output layout matches the R2 key layout the Worker expects:
    tiles/terrarium/{z}/{x}/{y}.png

Upload to R2 (bucket "fjellrute-terrain"; create once with
`npx wrangler r2 bucket create fjellrute-terrain`). rclone is far faster than
per-object wrangler puts — configure an R2 S3 remote, then:
    rclone copy tiles/terrarium/ r2:fjellrute-terrain/terrarium/ \
        --transfers 32 --checksum

Encoding (Terrarium, must match worker/terrain.js and Map3DView.tsx):
    value = elevation_m + 32768
    R = floor(value / 256);  G = floor(value) % 256;  B = frac(value) * 256
    decode: elevation = (R * 256 + G + B / 256) - 32768

Sizing notes: z15 is the client's maxzoom (≈2.4 m/px at 60°N; MapLibre
overzooms beyond it). A z8–15 pyramid costs ~110 KB/tile worst case and
roughly 1.4 GB per 100x100 km region — well within R2's free tier for the
priority regions, and generation is embarrassingly parallel (--workers).
"""

from __future__ import annotations

import argparse
import io
import math
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

try:
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.vrt import WarpedVRT
    from rasterio.windows import from_bounds
    from PIL import Image
except ImportError as e:  # pragma: no cover
    sys.exit(f"missing dependency: {e.name} — run: pip install rasterio numpy pillow")

TILE_SIZE = 256
WEB_MERCATOR = "EPSG:3857"
# Web-Mercator world extent (meters).
ORIGIN = 20037508.342789244
AWS_TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium"

# Globals re-initialized in each worker process (rasterio datasets are not
# picklable, so each process opens its own handles).
_SRC_PATHS: list[str] = []
_VRTS: list = []
_FILL_AWS = False


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Web-Mercator bounds (minx, miny, maxx, maxy) of XYZ tile z/x/y."""
    span = 2 * ORIGIN / (2**z)
    minx = -ORIGIN + x * span
    maxy = ORIGIN - y * span
    return minx, maxy - span, minx + span, maxy


def mercator_tile_range(
    bounds: tuple[float, float, float, float], z: int
) -> tuple[int, int, int, int]:
    """Inclusive XYZ tile range (xmin, ymin, xmax, ymax) covering bounds."""
    minx, miny, maxx, maxy = bounds
    n = 2**z
    span = 2 * ORIGIN / n
    x0 = max(0, int((minx + ORIGIN) // span))
    x1 = min(n - 1, int((maxx + ORIGIN) // span))
    y0 = max(0, int((ORIGIN - maxy) // span))
    y1 = min(n - 1, int((ORIGIN - miny) // span))
    return x0, y0, x1, y1


def encode_terrarium(elev: np.ndarray) -> np.ndarray:
    """Float32 elevation (m) → uint8 RGB array, Terrarium encoding."""
    v = np.clip(elev + 32768.0, 0.0, 65535.996)
    whole = np.floor(v)
    rgb = np.empty((*elev.shape, 3), dtype=np.uint8)
    rgb[..., 0] = whole // 256
    rgb[..., 1] = whole % 256
    rgb[..., 2] = np.floor((v - whole) * 256.0)
    return rgb


def _init_worker(paths: list[str], fill_aws: bool) -> None:
    """Open per-process WarpedVRTs reprojecting each source to EPSG:3857."""
    global _SRC_PATHS, _VRTS, _FILL_AWS
    _SRC_PATHS = paths
    _FILL_AWS = fill_aws
    _VRTS = []
    for p in paths:
        ds = rasterio.open(p)
        _VRTS.append(
            WarpedVRT(
                ds,
                crs=WEB_MERCATOR,
                resampling=Resampling.bilinear,
                src_nodata=ds.nodata,
                nodata=float("nan"),
                dtype="float32",
            )
        )


def _read_tile(z: int, x: int, y: int) -> np.ndarray:
    """Mosaic all sources into one 256x256 float32 array (NaN = no data).

    WarpedVRT does not permit boundless reads, so for tiles that only
    partially overlap a source we read the intersection window and paste it
    into the matching pixel slice of the output tile.
    """
    bounds = tile_bounds(z, x, y)
    span = bounds[2] - bounds[0]
    out = np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype=np.float32)
    for vrt in _VRTS:
        vb = vrt.bounds
        ix0 = max(bounds[0], vb.left)
        ix1 = min(bounds[2], vb.right)
        iy0 = max(bounds[1], vb.bottom)
        iy1 = min(bounds[3], vb.top)
        if ix0 >= ix1 or iy0 >= iy1:
            continue
        # Pixel slice of the 256x256 tile covered by the intersection.
        col0 = int(round((ix0 - bounds[0]) / span * TILE_SIZE))
        col1 = int(round((ix1 - bounds[0]) / span * TILE_SIZE))
        row0 = int(round((bounds[3] - iy1) / span * TILE_SIZE))
        row1 = int(round((bounds[3] - iy0) / span * TILE_SIZE))
        if col1 <= col0 or row1 <= row0:
            continue
        window = from_bounds(ix0, iy0, ix1, iy1, transform=vrt.transform)
        data = vrt.read(
            1,
            window=window,
            out_shape=(row1 - row0, col1 - col0),
            resampling=Resampling.bilinear,
        ).astype(np.float32)
        region = out[row0:row1, col0:col1]
        mask = np.isnan(region) & ~np.isnan(data)
        region[mask] = data[mask]
    return out


def _fetch_aws_elevation(z: int, x: int, y: int) -> np.ndarray | None:
    """Decode the AWS Terrarium tile for void-filling, or None on failure."""
    import urllib.request

    url = f"{AWS_TERRARIUM}/{z}/{x}/{y}.png"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            img = Image.open(io.BytesIO(r.read())).convert("RGB")
    except Exception:
        return None
    a = np.asarray(img, dtype=np.float32)
    return a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0 - 32768.0


def _build_tile(args: tuple[int, int, int, str]) -> tuple[str, bool]:
    """Generate one tile. Returns (path, written)."""
    z, x, y, out_dir = args
    elev = _read_tile(z, x, y)
    void = np.isnan(elev)

    if void.all():
        return (f"{z}/{x}/{y}", False)  # entirely outside coverage — skip

    if void.any():
        if _FILL_AWS:
            aws = _fetch_aws_elevation(z, x, y)
            if aws is not None:
                elev[void] = aws[void]
                void = np.isnan(elev)
        # Anything still void (AWS miss, or --fill-aws off): sea level.
        # Norwegian DTM voids are overwhelmingly ocean, so 0 m is the
        # honest default and matches what AWS encodes offshore.
        elev[void] = 0.0

    rgb = encode_terrarium(elev)
    path = Path(out_dir) / "terrarium" / str(z) / str(x) / f"{y}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb, "RGB").save(path, optimize=True)
    return (f"{z}/{x}/{y}", True)


def parse_zooms(spec: str) -> list[int]:
    if "-" in spec:
        a, b = spec.split("-", 1)
        return list(range(int(a), int(b) + 1))
    return [int(z) for z in spec.split(",")]


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Kartverket DTM GeoTIFF → Terrarium XYZ tiles"
    )
    ap.add_argument("sources", nargs="+", help="input DTM GeoTIFF(s)")
    ap.add_argument("-o", "--out", required=True, help="output directory")
    ap.add_argument("--zooms", default="8-15", help='zoom levels, e.g. "8-15" or "12,13"')
    ap.add_argument("--workers", type=int, default=4, help="parallel processes")
    ap.add_argument(
        "--fill-aws",
        action="store_true",
        help="fill pixels outside DTM coverage from the AWS Terrarium tile",
    )
    args = ap.parse_args()

    zooms = parse_zooms(args.zooms)
    paths = [str(Path(p).resolve()) for p in args.sources]

    # Union of source bounds in EPSG:3857 (open once in the parent just to
    # compute the tile list; workers reopen their own handles).
    _init_worker(paths, args.fill_aws)
    minx = min(v.bounds.left for v in _VRTS)
    miny = min(v.bounds.bottom for v in _VRTS)
    maxx = max(v.bounds.right for v in _VRTS)
    maxy = max(v.bounds.top for v in _VRTS)
    for v in _VRTS:
        v.close()

    jobs: list[tuple[int, int, int, str]] = []
    for z in zooms:
        x0, y0, x1, y1 = mercator_tile_range((minx, miny, maxx, maxy), z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                jobs.append((z, x, y, args.out))

    print(f"{len(paths)} source(s), zooms {zooms}, {len(jobs)} candidate tiles")

    written = skipped = 0
    with ProcessPoolExecutor(
        max_workers=args.workers,
        initializer=_init_worker,
        initargs=(paths, args.fill_aws),
    ) as pool:
        for i, (_, ok) in enumerate(pool.map(_build_tile, jobs, chunksize=16)):
            written += ok
            skipped += not ok
            if (i + 1) % 500 == 0 or i + 1 == len(jobs):
                print(f"  {i + 1}/{len(jobs)}  written={written} skipped={skipped}")

    print(f"done: {written} tiles → {args.out}/terrarium/  ({skipped} empty skipped)")
    print("upload:  rclone copy "
          f"{args.out}/terrarium/ r2:fjellrute-terrain/terrarium/ --transfers 32")


if __name__ == "__main__":
    main()
