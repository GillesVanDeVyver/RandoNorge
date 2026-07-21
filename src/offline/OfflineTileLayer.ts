// A Leaflet TileLayer that serves cached tiles from IndexedDB first, then
// falls back to the network. This is the runtime half of offline maps: once an
// area is downloaded, its tiles render instantly and keep working with no
// connectivity; anything not cached loads normally when online.
//
// It deliberately reuses the shared layer descriptor (offline/layers.ts) for
// both the request URL and the cache key, so the tiles the downloader stored
// are exactly the ones this layer looks up.
//
// Overzoom: a region is only downloaded to the detail level the user picked
// (the slider tops out at z16 and defaults to z14), while Leaflet is happy to
// display up to the source's maxNativeZoom. That gap is exactly where the map
// used to go blank offline — Leaflet requests a z15/z16 tile that was never
// downloaded, the cache misses, and there is nothing to draw. To fix it we
// synthesise the missing tile from the nearest cached *ancestor*: crop the
// quadrant that corresponds to the requested tile and scale it up onto a
// canvas. The result is progressively blurrier the further past the downloaded
// detail you zoom, but it never blanks — it degrades gracefully all the way
// down to the always-downloaded overview levels.

import L from 'leaflet';
import { getTile } from './db';
import { OFFLINE_LAYERS, type OfflineLayerId, type TileUrlOpts } from './layers';
import { isForcedOffline, subscribeNetworkMode } from './networkMode';

export interface OfflineTileLayerOptions extends L.TileLayerOptions {
  layerId: OfflineLayerId;
  snowDate?: string;
}

// Leaflet's typings don't expose the protected members we override; declare the
// shape we rely on so the subclass stays type-checked without `any`.
interface DoneFn {
  (error: Error | undefined, tile: HTMLImageElement): void;
}

// Decode a stored tile blob into something drawable. Prefer createImageBitmap
// (fast, off the main thread, and disposable) and fall back to an <img> for
// engines that lack it. The caller is responsible for closing an ImageBitmap.
async function decodeTile(
  blob: Blob,
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('failed to decode cached tile'));
    };
    image.src = url;
  });
}

export class OfflineTileLayer extends L.TileLayer {
  declare options: OfflineTileLayerOptions & L.TileLayerOptions;
  private unsubscribeNetworkMode?: () => void;

  constructor(options: OfflineTileLayerOptions) {
    // The URL is generated per-tile in getTileUrl(); pass an empty template so
    // Leaflet's own {z}/{x}/{y} substitution never runs.
    super('', options);
  }

  // Redraw whenever the forced-offline flag flips so cached tiles stay and
  // uncached ones blank out immediately (dev offline simulator).
  override onAdd(map: L.Map): this {
    this.unsubscribeNetworkMode = subscribeNetworkMode(() => this.redraw());
    return super.onAdd(map);
  }

  override onRemove(map: L.Map): this {
    this.unsubscribeNetworkMode?.();
    this.unsubscribeNetworkMode = undefined;
    return super.onRemove(map);
  }

  private urlOpts(): TileUrlOpts {
    return { snowDate: this.options.snowDate };
  }

  // Build the network URL for a tile from the shared descriptor rather than a
  // URL template, so the WMS (snow depth) case works the same as plain XYZ.
  override getTileUrl(coords: L.Coords): string {
    const layer = OFFLINE_LAYERS[this.options.layerId];
    return layer.tileUrl(coords.z, coords.x, coords.y, this.urlOpts());
  }

  private cacheKey(coords: L.Coords): string {
    const layer = OFFLINE_LAYERS[this.options.layerId];
    return layer.storageKey(coords.z, coords.x, coords.y, this.urlOpts());
  }

  override createTile(coords: L.Coords, done: DoneFn): HTMLImageElement {
    const img = document.createElement('img');
    img.setAttribute('role', 'presentation');
    img.alt = '';

    const url = this.getTileUrl(coords);
    const key = this.cacheKey(coords);

    let objectUrl: string | null = null;
    const cleanup = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };
    const showBlob = (blob: Blob) => {
      cleanup();
      objectUrl = URL.createObjectURL(blob);
      img.src = objectUrl;
    };
    const succeed = () => {
      cleanup();
      done(undefined, img);
    };
    const fail = (message: string) => {
      cleanup();
      done(new Error(message), img);
    };

    img.onload = succeed;

    // Last resort before blanking: rebuild this tile by upscaling the nearest
    // cached ancestor. Returns true if it managed to draw something.
    const tryOverzoom = async (): Promise<boolean> => {
      const blob = await this.overzoomTile(coords).catch(() => null);
      if (!blob) return false;
      img.onerror = () => fail('overzoom render failed');
      showBlob(blob);
      return true;
    };

    // Try the exact cache tile first. On a hit, serve the stored blob. On a
    // miss, either go to the network (online) or synthesise the tile from a
    // cached ancestor (offline). The network path also falls back to overzoom
    // if the request fails — e.g. a real dead zone or a zoom the source lacks.
    const useNetworkThenOverzoom = () => {
      img.onerror = () => {
        void tryOverzoom().then((ok) => {
          if (!ok) fail('tile failed to load');
        });
      };
      img.src = url;
    };
    const overzoomOrBlank = () => {
      void tryOverzoom().then((ok) => {
        if (!ok) fail('offline (no cached tile or ancestor)');
      });
    };

    getTile(key)
      .then((blob) => {
        if (blob) {
          img.onerror = () => fail('tile failed to load');
          showBlob(blob);
        } else if (isForcedOffline()) {
          overzoomOrBlank();
        } else {
          useNetworkThenOverzoom();
        }
      })
      .catch(() => {
        if (isForcedOffline()) overzoomOrBlank();
        else useNetworkThenOverzoom();
      });

    return img;
  }

  // Walk up the tile pyramid from the requested tile toward the world tile,
  // stopping at the first cached ancestor, and return a new tile blob showing
  // just the quadrant that ancestor covers for `coords`, scaled to full size.
  // Resolves null when nothing along the way is cached.
  private async overzoomTile(coords: L.Coords): Promise<Blob | null> {
    const layer = OFFLINE_LAYERS[this.options.layerId];
    const opts = this.urlOpts();

    for (let dz = 1; coords.z - dz >= 0; dz++) {
      const factor = 1 << dz; // 2^dz child tiles per ancestor tile per axis
      const ax = Math.floor(coords.x / factor);
      const ay = Math.floor(coords.y / factor);
      const ancestor = await getTile(
        layer.storageKey(coords.z - dz, ax, ay, opts),
      );
      if (!ancestor) continue;

      const subCol = coords.x - ax * factor; // 0..factor-1
      const subRow = coords.y - ay * factor;
      return this.cropAndScale(ancestor, subCol, subRow, factor);
    }
    return null;
  }

  // Draw one 1/factor-sized sub-square of `source` scaled up to a full tile.
  private async cropAndScale(
    source: Blob,
    subCol: number,
    subRow: number,
    factor: number,
  ): Promise<Blob | null> {
    const image = await decodeTile(source);
    try {
      // Cached tiles are square; use the decoded size so this holds even if the
      // source ever changes tile size.
      const srcSize =
        image instanceof HTMLImageElement ? image.naturalWidth : image.width;
      const sub = srcSize / factor;
      const tile = this.getTileSize();

      const canvas = document.createElement('canvas');
      canvas.width = tile.x;
      canvas.height = tile.y;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        image,
        subCol * sub,
        subRow * sub,
        sub,
        sub,
        0,
        0,
        tile.x,
        tile.y,
      );

      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
    } finally {
      if ('close' in image && typeof image.close === 'function') image.close();
    }
  }
}
