// Inline SVG icons, the React Native half of apps/web/src/components/icons.tsx.
//
// The same Lucide-style strokes at the same 24-unit grid, so a control that
// exists on both clients wears the same glyph. Only the icons the phone
// actually renders are here — the web file has around thirty, and copying the
// rest would be a pile of things to keep in sync that nothing on this platform
// draws. Phase 4 added the four the edit toolbar needs, and the account
// overview added five more when it grew the web's icon tiles; the twenty-odd
// for controls the phone still does not have (import, export, print, 3D, the
// draw-style pair, the folded map for an offline store that does not exist yet)
// are still not here, for the same reason. The web's `ArrowRightIcon` is one of
// them: its cards carry a chevron that slides and turns teal on `:hover`, and a
// hover affordance drawn static on a touch screen is decoration — see the note
// in app/index.tsx.
//
// `currentColor` does not exist in React Native — there is no cascade for a
// stroke to inherit through — so colour is a required prop rather than an
// inherited one. Required, not defaulted: an icon that silently falls back to
// black is an icon that looks right on white and disappears on the accent fill,
// and the call site is the only place that knows which it is sitting on.

import Svg, { Circle, G, Line, Path, Polyline, Rect } from 'react-native-svg';

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

// ---- The account overview -------------------------------------------------
// Six more glyphs traced from apps/web/src/components/icons.tsx, for the hub's
// brand mark and its four card tiles. Same reason as the toolbar four above:
// the phone's overview is now the web's overview, and a card that wears a
// different icon from the card it mirrors is a card the user has to re-learn.
//
// These were the "twenty-odd for controls the phone still does not have" the
// note at the top of this file kept out. They are here because the hub now
// draws them, not because the list was completed for its own sake — the rest
// (import, export, print, 3D, the draw-style pair) are still absent.

export function MountainIcon({ color, size = SIZE }: IconProps) {
  // The Fjellrute mark: a three-peak skyline (tall left peak, main summit, low
  // right peak) as a single filled path, with a route sweeping up the main
  // face. Kept in sync with apps/web/src/components/icons.tsx and
  // apps/web/public/favicon.svg.
  //
  // NOTE the fills. The web's `baseProps` sets `fill: none` and the skyline is
  // therefore an outline; that is the shape, and it is reproduced exactly
  // rather than "improved" into a solid silhouette, because the same mark sits
  // in a browser tab and on a phone header at the same moment.
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} fill="none">
      <Path
        d="M1.5 20 L6.5 8.5 L9.5 12.5 L13 5.5 L17.5 17 L19.5 14.5 L22.5 20 Z"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M18.5 19.9 C 13 19 10.5 16.5 12 13.8 C 13 11.9 12.9 9.6 12.95 7.8"
        stroke={color}
        // The web overrides the shared width on this stroke alone: the route is
        // a thinner line than the skyline it climbs.
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function RouteIcon({ color, size = SIZE }: IconProps) {
  // Lucide "route": waypoint circles joined by a path.
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} fill="none">
      <Circle
        cx="6"
        cy="19"
        r="3"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle
        cx="18"
        cy="5"
        r="3"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function BookmarkIcon({ color, size = SIZE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} fill="none">
      <Path
        d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CircleCheckIcon({ color, size = SIZE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} fill="none">
      <Circle
        cx="12"
        cy="12"
        r="10"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="m9 12 2 2 4-4"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function MessageIcon({ color, size = SIZE }: IconProps) {
  // Lucide "message-square" — a speech bubble, for the feedback card. Reads as
  // "write to us" rather than the envelope a mailto: link would imply, which is
  // the point on both clients: nothing leaves the app.
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} fill="none">
      <Path
        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
