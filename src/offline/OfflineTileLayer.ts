// A Leaflet TileLayer that serves cached tiles from IndexedDB first, then
// falls back to the network. This is the runtime half of offline maps: once an
// area is downloaded, its tiles render instantly and keep working with no
// connectivity; anything not cached loads normally when online (and simply
// shows a blank tile when offline).
//
// It deliberately reuses the shared layer descriptor (offline/layers.ts) for
// both the request URL and the cache key, so the tiles the downloader stored
// are exactly the ones this layer looks up.

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
    img.onload = () => {
      cleanup();
      done(undefined, img);
    };
    img.onerror = () => {
      cleanup();
      done(new Error('tile failed to load'), img);
    };

    // Try the cache first. On a hit, serve the stored blob. On a miss, fall
    // back to the network — unless offline is being simulated, in which case we
    // report the tile as failed so it blanks out just like a real dead zone.
    getTile(key)
      .then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          img.src = objectUrl;
        } else if (isForcedOffline()) {
          done(new Error('offline (simulated)'), img);
        } else {
          img.src = url;
        }
      })
      .catch(() => {
        if (isForcedOffline()) done(new Error('offline (simulated)'), img);
        else img.src = url;
      });

    return img;
  }
}
