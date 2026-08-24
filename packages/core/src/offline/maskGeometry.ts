// Geometry for the offline gray-tint mask.
//
// Rather than punch region-shaped "holes" into one tinted div with clip-path,
// we cover only the *outside* area with plain rectangular divs — real box
// geometry, nothing to clip — and leave the downloaded rectangles as untinted
// gaps. (This also dodges a Chromium quirk we hit with the earlier grayscale
// version, where a `backdrop-filter` ignored its `clip-path` and greyed out the
// whole box, downloaded areas included.)
//
// `subtractRects` turns "the w×h box minus these hole rectangles" into a set of
// non-overlapping rectangles tiling exactly the uncovered area. It uses
// coordinate compression (partition the box along every hole edge into a grid,
// keep the cells whose centre sits in no hole) and merges the kept cells along
// each row so we emit as few rectangles as possible.

export type Rect = [number, number, number, number]; // [x1, y1, x2, y2]

// Translucent gray veil laid over the area the user can't rely on offline — a
// light ut.no-style tint that dims the map without hiding it. Shared so the 2D
// and 3D masks match exactly.
export const MASK_TINT = 'rgba(110, 118, 129, 0.4)';

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function subtractRects(w: number, h: number, holes: Rect[]): Rect[] {
  if (w <= 0 || h <= 0) return [];
  if (holes.length === 0) return [[0, 0, w, h]];

  const xsSet = new Set<number>([0, w]);
  const ysSet = new Set<number>([0, h]);
  for (const [x1, y1, x2, y2] of holes) {
    xsSet.add(x1);
    xsSet.add(x2);
    ysSet.add(y1);
    ysSet.add(y2);
  }
  const xs = [...xsSet].sort((a, b) => a - b);
  const ys = [...ysSet].sort((a, b) => a - b);

  const covered = (cx: number, cy: number): boolean => {
    for (const [hx1, hy1, hx2, hy2] of holes) {
      if (cx > hx1 && cx < hx2 && cy > hy1 && cy < hy2) return true;
    }
    return false;
  };

  const out: Rect[] = [];
  for (let j = 0; j < ys.length - 1; j++) {
    const cy = (ys[j] + ys[j + 1]) / 2;
    let runStart: number | null = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      if (!covered(cx, cy)) {
        if (runStart === null) runStart = xs[i];
      } else if (runStart !== null) {
        out.push([runStart, ys[j], xs[i], ys[j + 1]]);
        runStart = null;
      }
    }
    if (runStart !== null) out.push([runStart, ys[j], xs[xs.length - 1], ys[j + 1]]);
  }
  return out;
}
