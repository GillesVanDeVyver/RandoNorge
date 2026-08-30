// Inline SVG icons, the React Native half of apps/web/src/components/icons.tsx.
//
// The same Lucide-style strokes at the same 24-unit grid, so a control that
// exists on both clients wears the same glyph. Only the icons the phone
// actually renders are here — the web file has around thirty, most of them for
// a drawing toolbar the phone does not have until Phase 4, and copying the
// other twenty-eight now would be twenty-eight things to keep in sync that
// nothing on this platform draws.
//
// `currentColor` does not exist in React Native — there is no cascade for a
// stroke to inherit through — so colour is a required prop rather than an
// inherited one. Required, not defaulted: an icon that silently falls back to
// black is an icon that looks right on white and disappears on the accent fill,
// and the call site is the only place that knows which it is sitting on.

import Svg, { Polyline } from 'react-native-svg';

const SIZE = 20;
const VIEW_BOX = '0 0 24 24';
const STROKE_WIDTH = 2;

interface IconProps {
  color: string;
  size?: number;
}

export function ChevronLeftIcon({ color, size = SIZE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} fill="none">
      <Polyline
        points="15 5 8 12 15 19"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ChevronRightIcon({ color, size = SIZE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} fill="none">
      <Polyline
        points="9 5 16 12 9 19"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
