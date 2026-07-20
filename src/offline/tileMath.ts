// Web-Mercator (EPSG:3857) tile math shared by the downloader and the offline
// layers. Everything here is the standard XYZ / "slippy map" scheme that
// Leaflet uses for its default CRS, so the tiles we enumerate for download line
// up 1:1 with the tiles Leaflet requests at runtime.

export const MERCATOR_EXTENT = 20037508.342789244; // half the world in metres

/** Longitude → tile X at zoom z (fractional). */
export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * Math.pow(2, z);
}

/** Latitude → tile Y at zoom z (fractional), Web-Mercator. */
export function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    Math.pow(2, z)
  );
}

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/** Bounds as [south, west, north, east] in degrees. */
export type Bounds = [number, number, number, number];

/**
 * Inclusive integer tile range covering `bounds` at zoom `z`, clamped to the
 * valid [0, 2^z − 1] grid.
 */
export function tileRange(
  bounds: Bounds,
  z: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const [south, west, north, east] = bounds;
  const max = Math.pow(2, z) - 1;
  const clamp = (v: number) => Math.min(max, Math.max(0, v));
  const minX = clamp(Math.floor(lngToTileX(west, z)));
  const maxX = clamp(Math.floor(lngToTileX(east, z)));
  // Y grows southward, so the northern edge is the smaller index.
  const minY = clamp(Math.floor(latToTileY(north, z)));
  const maxY = clamp(Math.floor(latToTileY(south, z)));
  return { minX, maxX, minY, maxY };
}

/** Count the tiles a single zoom level contributes for `bounds`. */
export function countTilesAtZoom(bounds: Bounds, z: number): number {
  const { minX, maxX, minY, maxY } = tileRange(bounds, z);
  return (maxX - minX + 1) * (maxY - minY + 1);
}

/** Total tiles across an inclusive zoom range. */
export function countTiles(
  bounds: Bounds,
  minZoom: number,
  maxZoom: number,
): number {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) total += countTilesAtZoom(bounds, z);
  return total;
}

/** Enumerate every tile coord for `bounds` across an inclusive zoom range. */
export function* enumerateTiles(
  bounds: Bounds,
  minZoom: number,
  maxZoom: number,
): Generator<TileCoord> {
  for (let z = minZoom; z <= maxZoom; z++) {
    const { minX, maxX, minY, maxY } = tileRange(bounds, z);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        yield { z, x, y };
      }
    }
  }
}

/**
 * EPSG:3857 metre bounding box for a tile, as [minX, minY, maxX, maxY].
 * Used to build WMS GetMap requests for the snow-depth layer.
 */
export function tileBBox3857(
  z: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const tilesPerSide = Math.pow(2, z);
  const size = (2 * MERCATOR_EXTENT) / tilesPerSide;
  const minX = -MERCATOR_EXTENT + x * size;
  const maxX = -MERCATOR_EXTENT + (x + 1) * size;
  // Row 0 is the top (north); metres decrease as y increases.
  const maxY = MERCATOR_EXTENT - y * size;
  const minY = MERCATOR_EXTENT - (y + 1) * size;
  return [minX, minY, maxX, maxY];
}
