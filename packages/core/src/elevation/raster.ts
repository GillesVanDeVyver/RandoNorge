// Fetch a PNG and hand back its pixels.
//
// WHY THIS FILE EXISTS. ./runout.ts reads avalanche runout severity out of an
// image: it asks NVE for one PNG covering the route's bounding box and looks up
// each route point's pixel. The maths — the bbox, the resolution, the
// lat/lng-to-pixel mapping, the colour classification — is arithmetic and
// belongs in this package. Turning the PNG into bytes is not: it was
// `createImageBitmap` plus `OffscreenCanvas`, which exist in a browser window
// and a web worker and nowhere else. React Native has neither.
//
// So the seam is drawn at the one place the platforms actually differ: bytes in,
// bytes out. runout.ts keeps every decision about what the bytes mean, which is
// where the correctness lives and where a second implementation would be
// dangerous to duplicate.
//
// The browser default below is the code that used to be inline in runout.ts,
// moved rather than rewritten — same order, same guards, same silent failure
// into null. On React Native, Phase 3 supplies a decoder over
// expo-image-manipulator or a small native module and calls setRasterSampler().

/**
 * Fetch `url` and decode it to RGBA bytes, 4 per pixel, row-major from the top
 * left, `width * height * 4` long.
 *
 * Returns null for ANY failure — a non-200, a network error, an undecodable
 * body, a canvas the platform refused to give up. Callers must treat null as
 * "no information" and never as a zero reading; in runout's case a wrong answer
 * here would render avalanche terrain as safe.
 */
export type RasterSampler = (
  url: string,
  width: number,
  height: number,
  signal?: AbortSignal,
) => Promise<Uint8ClampedArray | null>;

// The browser APIs, described locally because this package compiles without the
// DOM lib. Only the members used below are named.
interface BitmapLike {
  close(): void;
}
interface Context2dLike {
  drawImage(image: BitmapLike, x: number, y: number, w: number, h: number): void;
  getImageData(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { data: Uint8ClampedArray };
}
interface OffscreenCanvasLike {
  getContext(
    id: '2d',
    options?: { willReadFrequently?: boolean },
  ): Context2dLike | null;
}
interface RasterGlobals {
  createImageBitmap?: (blob: unknown) => Promise<BitmapLike>;
  OffscreenCanvas?: new (w: number, h: number) => OffscreenCanvasLike;
}

const g = globalThis as RasterGlobals;

const browserSampler: RasterSampler | null =
  g.createImageBitmap && g.OffscreenCanvas
    ? async (url, width, height, signal) => {
        const createBitmap = g.createImageBitmap;
        const Canvas = g.OffscreenCanvas;
        if (!createBitmap || !Canvas) return null;

        // createImageBitmap and OffscreenCanvas are available in both
        // DedicatedWorkerGlobalScope and the main window, which is what lets
        // the whole runout pipeline run inside the elevation profile worker
        // without touching window-only APIs (HTMLImageElement,
        // HTMLCanvasElement).
        let bitmap: BitmapLike;
        try {
          const res = await fetch(url, { signal });
          if (!res.ok) return null;
          bitmap = await createBitmap(await res.blob());
        } catch {
          return null;
        }

        const ctx = new Canvas(width, height).getContext('2d', {
          willReadFrequently: true,
        });
        if (!ctx) {
          bitmap.close();
          return null;
        }
        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        try {
          return ctx.getImageData(0, 0, width, height).data;
        } catch {
          // A cross-origin image taints the canvas and getImageData throws.
          return null;
        }
      }
    : null;

let sampler: RasterSampler | null = browserSampler;

/** Install a decoder for platforms without OffscreenCanvas. Null restores the
 *  browser default, or none if this platform has no browser APIs. */
export function setRasterSampler(next: RasterSampler | null): void {
  sampler = next ?? browserSampler;
}

/** True when this platform can decode a raster at all. Callers that would
 *  otherwise make a pointless HTTP request should check first. */
export function hasRasterSampler(): boolean {
  return sampler !== null;
}

/** Sample a raster, or null if that is impossible on this platform. */
export function sampleRaster(
  url: string,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<Uint8ClampedArray | null> {
  if (!sampler) return Promise.resolve(null);
  return sampler(url, width, height, signal);
}
