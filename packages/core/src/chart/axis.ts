// Axis tick helpers for hand-drawn charts.
//
// The web's on-screen charts get these from Recharts. The printed ones are
// plain SVG (a measured-at-screen-size chart mislays itself on paper), so they
// need their own — and they need the *same* one, or the elevation profile and
// the snow chart stacked directly beneath it would disagree about where 2 km
// is.
//
// The phone has no Recharts to fall back on: Recharts renders DOM, and Phase 2
// of docs/mobile-web-parity-plan.md therefore draws its elevation profile by
// hand over react-native-svg, exactly as the briefing does. That is the third
// hand-drawn chart and the second platform, which is why this left
// apps/web/src/briefing and came here — a tick-rounding rule copied into two
// codebases is a rule that will eventually disagree with itself.

/** "Nice" tick step (1/2/5 x 10^n) giving roughly `target` ticks over `span`. */
export function tickStep(span: number, target: number): number {
  const rough = span / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(rough));
  for (const mult of [1, 2, 5, 10]) {
    if (pow * mult >= rough) return pow * mult;
  }
  return pow * 10;
}

/** Tick values covering [min, max] on a "nice" step. */
export function ticks(min: number, max: number, target: number): number[] {
  const step = tickStep(max - min, target);
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}
