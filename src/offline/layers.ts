// Descriptors for every map layer that can be taken offline.
//
// The SAME descriptor drives both sides of the feature, which is what keeps
// downloaded tiles and runtime requests in lockstep:
//   - the downloader calls `tileUrl`/`storageKey` to fetch and store tiles;
//   - the runtime offline layer (OfflineTileLayer) calls the identical
//     functions to look a tile up in the cache before hitting the network.
// If the URL scheme ever changes, changing it here fixes both at once.

import { tileBBox3857 } from './tileMath';

export type OfflineLayerId = 'topo' | 'steepness' | 'snowdepth' | 'terrain';

export interface TileUrlOpts {
  /** Snapshot date (YYYY-MM-DD) — only meaningful for the snow-depth layer. */
  snowDate?: string;
}

export interface OfflineLayer {
  id: OfflineLayerId;
  label: string;
  description: string;
  /**
   * Highest zoom the source actually renders. We never download or request
   * beyond this; the map upsamples these tiles for deeper zooms instead. Also
   * the natural cap on how big a download can get.
   */
  maxNativeZoom: number;
  /**
   * Legal cap on how deep the *offline downloader* may copy tiles into
   * IndexedDB, independent of `maxNativeZoom` (which still governs live
   * display and overzoom). Defaults to `maxNativeZoom` when omitted.
   *
   * This exists because copying and storing tiles is a different right from
   * displaying them live. Kartverket's terms of use state that the topo
   * cache/WMS tiles at zoom levels 12–20 carry Geovekst-cooperation data that
   * "must [not] be copied or used in other ways" without separate permission
   * from the licensees — live display is fine, bulk copying to a local store
   * is not. Until that permission is granted, topo is capped at z11 so the
   * offline cache never persists Geovekst-restricted tiles.
   *
   * A permission request to cache z12+ offline has been submitted to Kartverket
   * (post@kartverket.no) and is PENDING — under handling. Raise this cap only
   * once written permission is on file. See docs/DATA_LICENSES.md §1.
   */
  maxDownloadZoom?: number;
  /** True when tiles are tied to a date (snow depth) and the key must encode it. */
  needsDate: boolean;
  /**
   * True when a tile stores *encoded data* rather than a picture — currently
   * only the Terrarium-encoded terrain DEM, whose RGB channels pack an
   * elevation, not a colour. Overzoom reconstruction must upsample these with
   * nearest-neighbour sampling: bilinear smoothing would blend the encoded
   * bytes and invent garbage elevations (a spike at every 256 m contour where
   * the green channel wraps). Omitted/false for ordinary raster imagery, which
   * is smoothed for a cleaner blur.
   */
  encoded?: boolean;
  /** Full request URL for one tile. */
  tileUrl: (z: number, x: number, y: number, opts?: TileUrlOpts) => string;
  /** Stable IndexedDB key for one tile. */
  storageKey: (z: number, x: number, y: number, opts?: TileUrlOpts) => string;
}

// --- Kartverket topographic base map (WMTS, {z}/{y}/{x} order) --------------
const topo: OfflineLayer = {
  id: 'topo',
  label: 'Topographic base map (finest detail 25 cm)',
  description: 'Kartverket topo — the main map. Essential for offline use.',
  // Kartverket's webmercator matrix set publishes tiles to z18 — that is the
  // ceiling for live display and overzoom.
  maxNativeZoom: 18,
  // ...but the offline downloader is capped at z11: z12+ topo tiles contain
  // Geovekst data that Kartverket's terms forbid copying into a local store
  // without separate permission (see maxDownloadZoom doc above). A permission
  // request is pending with Kartverket (under handling); raise this only once
  // that written permission is on file.
  maxDownloadZoom: 11,
  needsDate: false,
  tileUrl: (z, x, y) =>
    `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/${z}/${y}/${x}.png`,
  storageKey: (z, x, y) => `topo/${z}/${x}/${y}`,
};

// --- NVE steepness / runout overlay (ArcGIS tile cache, {z}/{y}/{x}) --------
const steepness: OfflineLayer = {
  id: 'steepness',
  label: 'Steepness (finest detail 1 m)',
  description: 'NVE bratthet med utløp — slope-angle shading for avalanche terrain.',
  // The ArcGIS tiling scheme defines LODs to z19, but the cache is only built to
  // maxLOD 16 (tiles above that 404), so z16 is the real ceiling for this layer.
  maxNativeZoom: 16,
  needsDate: false,
  tileUrl: (z, x, y) =>
    `https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/tile/${z}/${y}/${x}`,
  storageKey: (z, x, y) => `steepness/${z}/${x}/${y}`,
};

// --- seNorge snow depth (WMS GetMap, per-tile bbox) -------------------------
// The live overlay in Map.tsx uses a tuned 512px WMS layer to spare the
// un-cached seNorge server; for offline we use plain 256px Web-Mercator tiles
// so the coords match the standard XYZ grid the downloader enumerates. Snow
// depth is date-specific, so both the URL (TIME) and the key encode the date.
const SNOW_WMS_BASE =
  'https://kart.nve.no/enterprise/services/seNorgeGrid_png/ImageServer/WMSServer';

const snowdepth: OfflineLayer = {
  id: 'snowdepth',
  label: 'Snow depth',
  description:
    'seNorge snow depth for a chosen date. Only that day’s snapshot is stored.',
  // seNorge is a 1 km grid — beyond zoom 9 it is already oversampled, so we
  // cap the cache there and let the client upscale, matching the live layer.
  maxNativeZoom: 9,
  needsDate: true,
  tileUrl: (z, x, y, opts) => {
    const [minX, minY, maxX, maxY] = tileBBox3857(z, x, y);
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.1.1',
      REQUEST: 'GetMap',
      LAYERS: 'sd',
      STYLES: '',
      FORMAT: 'image/png',
      TRANSPARENT: 'TRUE',
      SRS: 'EPSG:3857',
      WIDTH: '256',
      HEIGHT: '256',
      BBOX: `${minX},${minY},${maxX},${maxY}`,
    });
    if (opts?.snowDate) params.set('TIME', opts.snowDate);
    return `${SNOW_WMS_BASE}?${params.toString()}`;
  },
  storageKey: (z, x, y, opts) =>
    `snowdepth/${opts?.snowDate ?? 'latest'}/${z}/${x}/${y}`,
};

// --- Terrain elevation mesh (Terrarium-encoded DEM, {z}/{x}/{y}) ------------
// The 3D view drapes the map over a terrain mesh built from these elevation
// tiles, served same-origin by our Worker (worker/terrain.js): Kartverket's
// 1 m national LiDAR DTM (NDH, CC BY 4.0) out of R2 where generated, falling
// back to the AWS Open Data Terrarium set elsewhere. Unlike the picture layers
// this stores *encoded* data (see `encoded` above), and it only matters for the
// 3D map — downloading it is what makes offline 3D show real relief instead of
// flat ground.
const terrain: OfflineLayer = {
  id: 'terrain',
  label: '3D terrain relief (finest detail 2 m)',
  description:
    'Kartverket LiDAR elevation mesh. Only used by the 3D map — adds real relief offline.',
  // Both terrain sources top out at z15 (~2.4 m/px at 60°N); the mesh is
  // overzoomed beyond that. No maxDownloadZoom cap: the DEM is openly licensed
  // (CC BY 4.0 / AWS Open Data), so unlike topo it may be cached in full.
  maxNativeZoom: 15,
  needsDate: false,
  encoded: true,
  // Absolute (same-origin) URL: the Worker route lives at /terrain-dem/*.
  tileUrl: (z, x, y) => `${location.origin}/terrain-dem/${z}/${x}/${y}.png`,
  storageKey: (z, x, y) => `terrain/${z}/${x}/${y}`,
};

/**
 * The deepest zoom the *offline downloader* will actually persist for a layer,
 * given the finest zoom the user asked for. Clamped by the layer's download
 * ceiling: `maxDownloadZoom` when set (a legal cap on copying tiles to disk —
 * e.g. topo stops at z11 below the Geovekst-restricted z12+ range), otherwise
 * the source's native max. When the slider asks for more detail than this,
 * the extra is silently dropped, so the UI uses this to tell the truth about
 * what a layer will really store offline.
 */
export function effectiveDownloadZoom(
  layer: OfflineLayer,
  requestedZoom: number,
): number {
  return Math.min(requestedZoom, layer.maxDownloadZoom ?? layer.maxNativeZoom);
}

export const OFFLINE_LAYERS: Record<OfflineLayerId, OfflineLayer> = {
  topo,
  steepness,
  snowdepth,
  terrain,
};

export const OFFLINE_LAYER_LIST: OfflineLayer[] = [
  topo,
  steepness,
  snowdepth,
  terrain,
];

// Layers offered in the download UI. Snow depth is intentionally excluded: it is
// a date-specific 1 km overlay best used live, not stored offline. It still
// exists in OFFLINE_LAYERS above so the live map and any previously downloaded
// snow tiles keep working. Terrain is included so users can opt into offline 3D
// relief and choose its detail like any other layer.
export const DOWNLOADABLE_LAYER_LIST: OfflineLayer[] = [topo, steepness, terrain];
