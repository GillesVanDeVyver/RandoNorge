// Orchestrates downloading a rectangular area for offline use: enumerate every
// tile for the chosen layers and zoom range, fetch them with bounded
// concurrency, store the blobs in IndexedDB, and record the region's metadata.
// Also owns safe deletion (tiles shared by overlapping regions are kept).

import {
  deleteRegion,
  deleteTiles,
  getRegions,
  putRegion,
  putTile,
  type RegionMeta,
} from './db';
import { OFFLINE_LAYERS, type OfflineLayerId } from './layers';
import {
  countTiles,
  enumerateTiles,
  type Bounds,
  type TileCoord,
} from './tileMath';

// Zoom-out should keep working offline, so we always include coarse overview
// levels down to this floor (they cost only a handful of tiles).
export const OVERVIEW_MIN_ZOOM = 5;

// Concurrent tile fetches. Kept modest to stay friendly to the public
// Kartverket/NVE endpoints and to avoid saturating a phone's connection.
const CONCURRENCY = 6;

export interface DownloadPlan {
  bounds: Bounds;
  layerIds: OfflineLayerId[];
  /** Max detail zoom the user asked for. */
  maxZoom: number;
  minZoom?: number;
  snowDate?: string;
  name: string;
}

export interface DownloadProgress {
  completed: number;
  total: number;
  failed: number;
  bytes: number;
}

/** Effective zoom span for a layer within a plan (never above the source's native max). */
function layerZoomRange(
  plan: DownloadPlan,
  layerId: OfflineLayerId,
): { min: number; max: number } {
  const native = OFFLINE_LAYERS[layerId].maxNativeZoom;
  const min = Math.min(plan.minZoom ?? OVERVIEW_MIN_ZOOM, plan.maxZoom);
  const max = Math.min(plan.maxZoom, native);
  return { min, max };
}

/** Total tiles a plan will fetch (sum across layers, honouring native caps). */
export function estimateTiles(plan: DownloadPlan): number {
  let total = 0;
  for (const layerId of plan.layerIds) {
    const { min, max } = layerZoomRange(plan, layerId);
    if (max < min) continue;
    total += countTiles(plan.bounds, min, max);
  }
  return total;
}

interface Task {
  layerId: OfflineLayerId;
  coord: TileCoord;
  url: string;
  key: string;
}

function* planTasks(plan: DownloadPlan): Generator<Task> {
  const opts = { snowDate: plan.snowDate };
  for (const layerId of plan.layerIds) {
    const layer = OFFLINE_LAYERS[layerId];
    const { min, max } = layerZoomRange(plan, layerId);
    if (max < min) continue;
    for (const coord of enumerateTiles(plan.bounds, min, max)) {
      yield {
        layerId,
        coord,
        url: layer.tileUrl(coord.z, coord.x, coord.y, opts),
        key: layer.storageKey(coord.z, coord.x, coord.y, opts),
      };
    }
  }
}

/**
 * Download and cache a region. Resolves with the saved region metadata.
 * Individual tile failures (offline gaps, CORS hiccups, 404s over sea) are
 * tolerated and counted, not fatal — a mostly-complete area is still useful.
 * Aborting via `signal` rejects with an AbortError and saves nothing.
 */
export async function downloadRegion(
  plan: DownloadPlan,
  opts: { signal?: AbortSignal; onProgress?: (p: DownloadProgress) => void } = {},
): Promise<RegionMeta> {
  const { signal, onProgress } = opts;
  const total = estimateTiles(plan);
  const progress: DownloadProgress = { completed: 0, total, failed: 0, bytes: 0 };

  const iterator = planTasks(plan);

  const worker = async () => {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const next = iterator.next();
      if (next.done) return;
      const task = next.value;
      try {
        const res = await fetch(task.url, { mode: 'cors', signal });
        if (res.ok) {
          const blob = await res.blob();
          // Ignore empty/error placeholder responses (some WMS servers return
          // a 200 with a tiny transparent PNG for out-of-range tiles).
          await putTile(task.key, blob);
          progress.bytes += blob.size;
        } else {
          progress.failed += 1;
        }
      } catch (err) {
        if (signal?.aborted) throw abortError();
        progress.failed += 1;
        void err;
      } finally {
        progress.completed += 1;
        onProgress?.({ ...progress });
      }
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, total || 1) }, () =>
    worker(),
  );
  await Promise.all(workers);

  const region: RegionMeta = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: plan.name,
    bounds: plan.bounds,
    minZoom: Math.min(plan.minZoom ?? OVERVIEW_MIN_ZOOM, plan.maxZoom),
    maxZoom: plan.maxZoom,
    layerIds: plan.layerIds,
    snowDate: plan.layerIds.includes('snowdepth') ? plan.snowDate : undefined,
    tileCount: progress.completed - progress.failed,
    bytes: progress.bytes,
    createdAt: Date.now(),
  };
  await putRegion(region);
  return region;
}

function abortError(): DOMException {
  return new DOMException('Download cancelled', 'AbortError');
}

/** Every tile key a region occupies (used for reference-counted deletion). */
function regionTileKeys(region: RegionMeta): Set<string> {
  const keys = new Set<string>();
  const snowDate = region.snowDate;
  for (const layerId of region.layerIds) {
    const layer = OFFLINE_LAYERS[layerId as OfflineLayerId];
    if (!layer) continue;
    const max = Math.min(region.maxZoom, layer.maxNativeZoom);
    const min = Math.min(region.minZoom, max);
    for (const c of enumerateTiles(region.bounds, min, max)) {
      keys.add(layer.storageKey(c.z, c.x, c.y, { snowDate }));
    }
  }
  return keys;
}

/**
 * Delete a region's metadata and only the tiles no other remaining region
 * still needs, so removing one downloaded area never blanks out another where
 * the two rectangles overlap.
 */
export async function removeRegion(id: string): Promise<void> {
  const regions = await getRegions();
  const target = regions.find((r) => r.id === id);
  if (!target) return;

  const targetKeys = regionTileKeys(target);
  const keep = new Set<string>();
  for (const other of regions) {
    if (other.id === id) continue;
    for (const key of regionTileKeys(other)) keep.add(key);
  }

  const toDelete: string[] = [];
  for (const key of targetKeys) if (!keep.has(key)) toDelete.push(key);

  await deleteTiles(toDelete);
  await deleteRegion(id);
}
