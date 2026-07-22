// The MapLibre (3D) counterpart to OfflineTileLayer (the 2D Leaflet layer).
//
// MapLibre fetches raster tiles itself straight from the source URL, so — unlike
// the 2D map — the 3D view never consulted the IndexedDB tile cache and went
// blank the moment there was no network, even over an area the user had
// downloaded. This registers a custom MapLibre protocol (`fjellrute-offline://`)
// that routes every tile request through the same cache the downloader fills, so
// downloaded areas render in 3D with zero connectivity exactly like they do in
// 2D.
//
// A source using this protocol declares its tiles as
//   fjellrute-offline://<layerId>/{z}/{x}/{y}
// (snow depth appends ?date=YYYY-MM-DD). MapLibre substitutes {z}/{x}/{y} and
// hands us the resulting URL; we look the tile up in IndexedDB first, fall back
// to the network when online, and — offline, on a cache miss — synthesise the
// tile from the nearest cached ancestor so the map degrades gracefully instead
// of blanking. This mirrors OfflineTileLayer's cache→network→overzoom cascade
// so both views behave identically; the shared layer descriptors
// (offline/layers.ts) keep the request URLs and cache keys in lockstep with the
// downloader.

import maplibregl, { type AddProtocolAction } from 'maplibre-gl';
import { getTile } from './db';
import { OFFLINE_LAYERS, type OfflineLayerId, type TileUrlOpts } from './layers';
import { isForcedOffline } from './networkMode';

export const OFFLINE_PROTOCOL = 'fjellrute-offline';

// Every source that uses this protocol serves 256px tiles (topo, steepness, and
// the 256px snow-depth WMS tiles the downloader enumerates), matching the tiles
// stored in IndexedDB.
const TILE_SIZE = 256;

/**
 * Tile-URL template for a MapLibre raster source that reads through the offline
 * cache. Snow depth is date-specific, so its date rides along as a query param
 * (the {z}/{x}/{y} placeholders are filled in by MapLibre per tile).
 */
export function offlineTileTemplate(
  layerId: OfflineLayerId,
  snowDate?: string,
): string {
  const suffix = snowDate ? `?date=${encodeURIComponent(snowDate)}` : '';
  return `${OFFLINE_PROTOCOL}://${layerId}/{z}/{x}/{y}${suffix}`;
}

interface ParsedTile {
  layerId: OfflineLayerId;
  z: number;
  x: number;
  y: number;
  snowDate?: string;
}

// fjellrute-offline://topo/11/1090/577            → { layerId, z, x, y }
// fjellrute-offline://snowdepth/9/.../..?date=... → also carries snowDate
function parseTileUrl(url: string): ParsedTile {
  const withoutProto = url.slice(`${OFFLINE_PROTOCOL}://`.length);
  const [path, queryStr] = withoutProto.split('?');
  const [layerId, z, x, y] = path.split('/');
  const snowDate = queryStr
    ? new URLSearchParams(queryStr).get('date') ?? undefined
    : undefined;
  return {
    layerId: layerId as OfflineLayerId,
    z: Number(z),
    x: Number(x),
    y: Number(y),
    snowDate,
  };
}

// Decode a stored tile blob into something drawable. Prefer createImageBitmap
// (fast, off the main thread, disposable) and fall back to an <img>. The caller
// closes an ImageBitmap. Mirrors OfflineTileLayer.decodeTile.
async function decodeTile(
  blob: Blob,
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('failed to decode cached tile'));
    };
    image.src = objectUrl;
  });
}

// Draw one 1/factor-sized sub-square of `source` scaled up to a full tile.
// Mirrors OfflineTileLayer.cropAndScale. `smooth` is disabled for encoded DEM
// tiles so their packed elevation bytes are copied, not blended (see the
// `encoded` note in offline/layers.ts).
async function cropAndScale(
  source: Blob,
  subCol: number,
  subRow: number,
  factor: number,
  smooth: boolean,
): Promise<Blob | null> {
  const image = await decodeTile(source);
  try {
    const srcSize =
      image instanceof HTMLImageElement ? image.naturalWidth : image.width;
    const sub = srcSize / factor;

    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = smooth;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      image,
      subCol * sub,
      subRow * sub,
      sub,
      sub,
      0,
      0,
      TILE_SIZE,
      TILE_SIZE,
    );

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
  } finally {
    if ('close' in image && typeof image.close === 'function') image.close();
  }
}

// Walk up the tile pyramid from the requested tile toward the world tile,
// stopping at the first cached ancestor, and return a tile blob showing just the
// quadrant that ancestor covers for the request, scaled to full size. Resolves
// null when nothing along the way is cached. Mirrors OfflineTileLayer.overzoomTile.
async function overzoomTile(
  layerId: OfflineLayerId,
  opts: TileUrlOpts,
  z: number,
  x: number,
  y: number,
): Promise<Blob | null> {
  const layer = OFFLINE_LAYERS[layerId];
  const smooth = !layer.encoded;
  for (let dz = 1; z - dz >= 0; dz++) {
    const factor = 1 << dz; // 2^dz child tiles per ancestor tile per axis
    const ax = Math.floor(x / factor);
    const ay = Math.floor(y / factor);
    const ancestor = await getTile(layer.storageKey(z - dz, ax, ay, opts));
    if (!ancestor) continue;
    return cropAndScale(ancestor, x - ax * factor, y - ay * factor, factor, smooth);
  }
  return null;
}

// Serve a tile: cache first, then either the network (online) or a synthesised
// ancestor (offline), matching OfflineTileLayer.createTile. Errors so MapLibre
// keeps whatever parent coverage it already has instead of overwriting it.
const loadOfflineTile: AddProtocolAction = async (params, abortController) => {
  const { layerId, z, x, y, snowDate } = parseTileUrl(params.url);
  const layer = OFFLINE_LAYERS[layerId];
  if (!layer) throw new Error(`unknown offline layer: ${layerId}`);
  const opts: TileUrlOpts = { snowDate };

  const cached = await getTile(layer.storageKey(z, x, y, opts)).catch(
    () => undefined,
  );
  if (cached) return { data: await cached.arrayBuffer() };

  const overzoom = async (): Promise<{ data: ArrayBuffer }> => {
    const blob = await overzoomTile(layerId, opts, z, x, y).catch(() => null);
    if (blob) return { data: await blob.arrayBuffer() };
    throw new Error('offline: no cached tile or ancestor');
  };

  // Forced-offline (dev simulator): never touch the network, synthesise or blank.
  if (isForcedOffline()) return overzoom();

  // Online: fetch the source tile; on any failure (a real dead zone, or a zoom
  // the source lacks) fall back to the cached-ancestor upscale before blanking.
  try {
    const res = await fetch(layer.tileUrl(z, x, y, opts), {
      mode: 'cors',
      signal: abortController.signal,
    });
    if (res.ok) return { data: await res.arrayBuffer() };
    return await overzoom();
  } catch (err) {
    if (abortController.signal.aborted) throw err;
    return overzoom();
  }
};

let registered = false;

/**
 * Register the offline tile protocol with MapLibre. Idempotent, so it is safe
 * to call from a component that may mount more than once.
 */
export function registerOfflineMapProtocol(): void {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol(OFFLINE_PROTOCOL, loadOfflineTile);
}
