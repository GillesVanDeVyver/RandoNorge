// Inline SVG icons, the React Native half of apps/web/src/components/icons.tsx.
//
// The same Lucide-style strokes at the same 24-unit grid, so a control that
// exists on both clients wears the same glyph. Only the icons the phone
// actually renders are here — the web file has around thirty, and copying the
// rest would be a pile of things to keep in sync that nothing on this platform
// draws. Phase 4 added the four the edit toolbar needs; the twenty-odd for
// controls the phone still does not have (import, export, print, 3D, the
// draw-style pair) are still not here, for the same reason.
//
// `currentColor` does not exist in React Native — there is no cascade for a
// stroke to inherit through — so colour is a required prop rather than an
// inherited one. Required, not defaulted: an icon that silently falls back to
// black is an icon that looks right on white and disappears on the accent fill,
// and the call site is the only place that knows which it is sitting on.

import Svg, { G, Line, Path, Polyline, Rect } from 'react-native-svg';

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

// ---- Phase 4: the edit toolbar --------------------------------------------
// Four glyphs traced from apps/web/src/components/icons.tsx, path data and all,
// so the pencil the user taps here is the pencil they clicked on the web. The
// web draws them with a shared `baseProps` spread; react-native-svg has no
// equivalent of that cascade — stroke, width, cap and join are per-element —
// so each attribute is repeated rather than inherited. Same numbers, more
// characters.

export function PencilIcon({ color, size = SIZE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} fill="none">
      <Path
        d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="m15 5 4 4"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function EraserIcon({ color, size = SIZE }: IconProps) {
  // Classic tilted school-eraser block: the short transverse line reads as the
  // colour band on a rubber, and the baseline below suggests the surface being
  // erased. The rotation is a transform on the group, exactly as on the web.
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} fill="none">
      <G transform="rotate(-30 12 12)">
        <Rect
          x="3"
          y="9"
          width="18"
          height="6"
          rx="0.8"
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          strokeLinejoin="round"
        />
        <Line
          x1="15"
          y1="9"
          x2="15"
          y2="15"
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
      </G>
      <Line
        x1="3"
        y1="21"
        x2="21"
        y2="21"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function TrashIcon({ color, size = SIZE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} fill="none">
      <Path
        d="M3 6h18"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line
        x1="10"
        x2="10"
        y1="11"
        y2="17"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
      />
      <Line
        x1="14"
        x2="14"
        y1="11"
        y2="17"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function UndoIcon({ color, size = SIZE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} fill="none">
      <Path
        d="M9 14 4 9l5-5"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4 9h11a5 5 0 0 1 0 10h-1"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
