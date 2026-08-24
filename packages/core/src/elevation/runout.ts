import type { LatLng } from '../types';
import { sampleRaster } from './raster.ts';

// Classifies route points by snow-avalanche runout severity using NVE's
// Bratthet_med_utlop_2024 service. The MapServer's /identify endpoint
// is broken for this dataset (returns pixel=1 for any geometry inside
// the raster extent, regardless of the actual pixel value), so we
// instead fetch a single /export PNG covering the route bbox, draw it
// to a canvas, and read each point's pixel directly. This guarantees
// the chart sees the exact color rendered on the map, in one HTTP call.
//
// Everything here is arithmetic on the returned pixels; fetching and decoding
// them is the platform's job and lives in ./raster.ts.

const EXPORT_URL =
  'https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/export';

// Severity scale:
// 0 = outside all runout zones
// 1 = inside "long" runout (lightest blue, layer 4)
// 2 = inside "medium" runout (layer 3)
// 3 = inside "short" runout (darkest blue, layer 2 — closest to release)
export type RunoutLevel = 0 | 1 | 2 | 3;

// Sentinel for "runout data could not be fetched/decoded". This is
// deliberately distinct from 0 ("verified to be outside all runout
// zones"): a failed lookup must never render as safe terrain. Consumers
// must treat RUNOUT_UNKNOWN as "no information" and display it as such.
export const RUNOUT_UNKNOWN = -1;
export type RunoutSample = RunoutLevel | typeof RUNOUT_UNKNOWN;

// NVE Norway runout colors decoded from the service legend. Order matters:
// when multiple layers cover a pixel, NVE renders the darkest on top, so
// the rendered pixel color identifies the innermost layer.
const COLOR_TABLE: { r: number; g: number; b: number; level: RunoutLevel }[] = [
  { r: 0x00, g: 0x4d, b: 0xa8, level: 3 }, // sh
  { r: 0x4c, g: 0x9b, b: 0xff, level: 2 }, // me
  { r: 0x9a, g: 0xb1, b: 0xe6, level: 1 }, // lo
];
// Max squared RGB distance for a pixel to be classified as a runout color.
// PNG decoding is lossless, but anti-aliased edges between zones can mix
// colors; this keeps the classification snapped to the nearest band.
const COLOR_TOLERANCE_SQ = 40 * 40;
// Below this alpha the pixel is treated as transparent (no runout).
const MIN_ALPHA = 32;

// Target ~5 m per pixel resolution; cap so we don't ask for huge images
// on continent-scale bboxes. A 2048x2048 PNG is ~1–3 MB which is fine.
const TARGET_M_PER_PX = 5;
const MAX_PIXELS = 2048;
const MIN_PIXELS = 64;
// Half a tile (~ a few hundred meters) of padding so route points near
// the bbox edge don't end up at literal pixel 0.
const PADDING_DEG = 0.002;

function classify(r: number, g: number, b: number, a: number): RunoutLevel {
  if (a < MIN_ALPHA) return 0;
  let best: RunoutLevel = 0;
  let bestDist = COLOR_TOLERANCE_SQ;
  for (const c of COLOR_TABLE) {
    const dr = r - c.r;
    const dg = g - c.g;
    const db = b - c.b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) {
      bestDist = d;
      best = c.level;
    }
  }
  return best;
}

export async function fetchRunoutLevels(
  points: LatLng[],
  signal?: AbortSignal,
): Promise<RunoutSample[]> {
  if (points.length === 0) return [];

  // Fail SAFE, not open: every failure path below returns RUNOUT_UNKNOWN
  // for all points, never 0, so a network/decode error can't masquerade
  // as "outside all runout zones".
  const unknown = () =>
    new Array<RunoutSample>(points.length).fill(RUNOUT_UNKNOWN);

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  minLat -= PADDING_DEG;
  maxLat += PADDING_DEG;
  minLng -= PADDING_DEG;
  maxLng += PADDING_DEG;

  const midLat = (minLat + maxLat) / 2;
  const widthM = (maxLng - minLng) * 111320 * Math.cos((midLat * Math.PI) / 180);
  const heightM = (maxLat - minLat) * 111320;
  const width = Math.max(
    MIN_PIXELS,
    Math.min(MAX_PIXELS, Math.ceil(widthM / TARGET_M_PER_PX)),
  );
  const height = Math.max(
    MIN_PIXELS,
    Math.min(MAX_PIXELS, Math.ceil(heightM / TARGET_M_PER_PX)),
  );

  const params = new URLSearchParams({
    bbox: `${minLng},${minLat},${maxLng},${maxLat}`,
    bboxSR: '4326',
    size: `${width},${height}`,
    imageSR: '4326',
    layers: 'show:2,3,4',
    format: 'png32',
    transparent: 'true',
    f: 'image',
  });
  const url = `${EXPORT_URL}?${params.toString()}`;

  // Null covers every failure the decode used to catch inline — a non-200, a
  // network error, a canvas the platform would not give up, and now also a
  // platform with no decoder at all. All of them land on RUNOUT_UNKNOWN.
  const pixels = await sampleRaster(url, width, height, signal);
  if (!pixels) return unknown();

  const dLng = maxLng - minLng;
  const dLat = maxLat - minLat;
  const result: RunoutSample[] = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const [lat, lng] = points[i];
    const px = Math.min(
      width - 1,
      Math.max(0, Math.floor(((lng - minLng) / dLng) * width)),
    );
    // Image y=0 is at maxLat (north up).
    const py = Math.min(
      height - 1,
      Math.max(0, Math.floor(((maxLat - lat) / dLat) * height)),
    );
    const idx = (py * width + px) * 4;
    result[i] = classify(
      pixels[idx],
      pixels[idx + 1],
      pixels[idx + 2],
      pixels[idx + 3],
    );
  }
  return result;
}
