// Minimal IndexedDB wrapper for the offline map cache.
//
// We store raw tile image blobs so downloaded areas render with zero network
// (in the mountains, out of coverage). A tiny dependency-free wrapper keeps
// the bundle small and avoids pulling in `idb`; the surface we need is just
// get/put/delete/count over two object stores:
//
//  - `tiles`   keyed by a stable string (see offline/layers.ts `storageKey`),
//              value is the PNG Blob for that tile.
//  - `regions` keyed by a generated id, value is the metadata for one
//              downloaded rectangle (bounds, zoom range, layers, size…),
//              used to render and manage the "Downloaded areas" list.

const DB_NAME = 'fjellrute-offline';
const DB_VERSION = 1;
export const TILE_STORE = 'tiles';
export const REGION_STORE = 'regions';

export interface RegionMeta {
  id: string;
  name: string;
  // [south, west, north, east] — matches Leaflet's LatLngBounds ordering when
  // read via getSouth()/getWest()/…; kept as plain numbers so it's structured
  // clonable into IndexedDB without depending on Leaflet types here.
  bounds: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  layerIds: string[];
  // Snapshot date for the snow-depth layer, when included (YYYY-MM-DD).
  snowDate?: string;
  tileCount: number;
  bytes: number;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    // `indexedDB` is unavailable in some locked-down/private modes; callers
    // treat a rejection as "offline caching not supported" and degrade to the
    // plain online map rather than crashing.
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TILE_STORE)) {
        db.createObjectStore(TILE_STORE);
      }
      if (!db.objectStoreNames.contains(REGION_STORE)) {
        db.createObjectStore(REGION_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Read a single cached tile blob, or undefined on a miss. */
export async function getTile(key: string): Promise<Blob | undefined> {
  const db = await openDb();
  const tx = db.transaction(TILE_STORE, 'readonly');
  return promisifyRequest<Blob | undefined>(
    tx.objectStore(TILE_STORE).get(key) as IDBRequest<Blob | undefined>,
  );
}

/** Store one tile blob. Overwrites any existing tile at the same key. */
export async function putTile(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(TILE_STORE, 'readwrite');
  tx.objectStore(TILE_STORE).put(blob, key);
  await txDone(tx);
}

export async function hasTile(key: string): Promise<boolean> {
  const db = await openDb();
  const tx = db.transaction(TILE_STORE, 'readonly');
  const count = await promisifyRequest(
    tx.objectStore(TILE_STORE).count(key),
  );
  return count > 0;
}

/** Delete an explicit set of tiles by key.
 *
 * Callers pass only the keys that are safe to remove — i.e. tiles that belong
 * to the region being deleted and are not still needed by another downloaded
 * region (overlapping rectangles share tile keys). Reference counting lives in
 * the offline layer, not here, so this stays a dumb batched delete. */
export async function deleteTiles(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(TILE_STORE, 'readwrite');
  const store = tx.objectStore(TILE_STORE);
  for (const key of keys) store.delete(key);
  await txDone(tx);
}

/** Wipe every cached tile and region (the "remove all offline maps" action). */
export async function clearAllOffline(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([TILE_STORE, REGION_STORE], 'readwrite');
  tx.objectStore(TILE_STORE).clear();
  tx.objectStore(REGION_STORE).clear();
  await txDone(tx);
}

export async function getRegions(): Promise<RegionMeta[]> {
  const db = await openDb();
  const tx = db.transaction(REGION_STORE, 'readonly');
  const all = await promisifyRequest<RegionMeta[]>(
    tx.objectStore(REGION_STORE).getAll() as IDBRequest<RegionMeta[]>,
  );
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putRegion(region: RegionMeta): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(REGION_STORE, 'readwrite');
  tx.objectStore(REGION_STORE).put(region);
  await txDone(tx);
}

export async function deleteRegion(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(REGION_STORE, 'readwrite');
  tx.objectStore(REGION_STORE).delete(id);
  await txDone(tx);
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Whether tile caching can work at all in this browser. */
export async function isOfflineSupported(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}
