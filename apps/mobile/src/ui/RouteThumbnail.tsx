// The mini-map that leads every row of the saved-routes list — the phone's
// counterpart to apps/web/src/components/RouteThumbnail.tsx.
//
// WHAT IS THE SAME. The tile is 64×64 with the web's radius and hairline, the
// proportions of the drawing are the web's own thumbnail numbers (a 2.5 line
// under a 5 halo, 12% padding on each side), the colours come from
// @fjellrute/core/routes/style like every other renderer of a route, gaps
// between segments are bridged with the same dotted grey leg, and a route with
// fewer than two points degrades to the generic RouteIcon on a tinted square
// exactly as `.fallback` does.
//
// WHAT IS NOT, AND WHY. The web draws this shape ON a stitched steepness map:
// renderStaticMap fetches up to sixteen 256px tiles, composites the steepness
// overlay onto them and traces the route over the result. This draws the shape
// alone on `.thumb`'s flat placeholder colour. That is a deliberate stop, not
// an unfinished port:
//
//   - a list of twenty saved routes would be up to 320 tile requests, on a
//     connection that is frequently the reason someone opened this app at all,
//     for a picture 64 points across;
//   - the tile cache and the compositing live in apps/web/src/briefing/
//     staticMap.ts, which is a 2D-canvas renderer. React Native has no canvas.
//     Porting it means either a new native dependency or a WebView per row.
//
// The shape is the part that identifies the route in a list — which tour is
// this, roughly where does it go — and the terrain under it is the part the
// route screen shows in full. So the phone renders the first and leaves the
// second to the tap.
//
// The projection and the fit are NOT here: they are the same arithmetic on both
// platforms and live in @fjellrute/core/routes/thumbnail, per the parity plan's
// rule. This file is the drawing only.

import { StyleSheet, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import type { Route } from '@fjellrute/core/types';
import { routeConnectors } from '@fjellrute/core/geometry';
import {
  fitRouteToBox,
  type BoxPoint,
} from '@fjellrute/core/routes/thumbnail';
import {
  CONNECTOR_COLOR,
  HALO_COLOR,
  HALO_OPACITY,
  ROUTE_COLOR,
  connectorDash,
  connectorWeight,
} from '@fjellrute/core/routes/style';
import { useT } from '@fjellrute/core/i18n';
import { RouteIcon } from './icons';
import { colors, radius } from './theme';

/** `.thumb` / `.fallback` in RouteThumbnail.module.css are both 64×64. */
const SIZE = 64;

/** The thumbnail's own weights, which are deliberately not the planner's: a
 *  4-point line on a 64-point tile is a blob. Same two numbers apps/web's
 *  RouteThumbnail passes to renderStaticMap. */
const ROUTE_WEIGHT = 2.5;
const HALO_WEIGHT = 5;
const PADDING = 0.12;

const GAP_WEIGHT = connectorWeight(ROUTE_WEIGHT);
/** react-native-svg's strokeDasharray takes the pattern in stroke units, the
 *  same form canvas's setLineDash wants — so this is connectorDash's output
 *  unchanged, not a conversion. */
const GAP_DASH = connectorDash(GAP_WEIGHT);

type Props = {
  /** The saved route's geometry; falls back to the generic icon if absent. */
  route?: Route;
};

/**
 * North-up shape of a route, used as the row "icon" in the saved list.
 *
 * Connectors are fitted through the SAME call as the route rather than a second
 * one, by appending them as extra segments: every connector endpoint is already
 * a point of some segment, so the bounding box — and therefore the scale and
 * the centring — is identical either way, and one call cannot disagree with
 * itself about where the shape sits. The two halves are told apart on the way
 * out by index, since `fitRouteToBox` preserves segment order.
 */
export function RouteThumbnail({ route }: Props) {
  const t = useT();

  const gaps = route ? routeConnectors(route) : [];
  const fitted = route
    ? fitRouteToBox({
        route: [...route, ...gaps.map(([from, to]) => [from, to])],
        width: SIZE,
        height: SIZE,
        padding: PADDING,
      })
    : null;

  if (!fitted) {
    return (
      <View
        style={styles.fallback}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <RouteIcon color={colors.textMuted} size={20} />
      </View>
    );
  }

  const drawn = fitted.slice(0, route ? route.length : 0);
  const legs = fitted.slice(route ? route.length : 0);

  return (
    <View
      style={styles.thumb}
      accessibilityRole="image"
      accessibilityLabel={t('Ruteoversikt, nord opp', 'Route overview, north up')}
    >
      <Svg width={SIZE} height={SIZE}>
        {/* Halo first, as one pass over every segment rather than halo-then-line
            per segment: drawn the second way, a segment's own line would be
            painted over by the NEXT segment's halo wherever two segments touch,
            which is a white notch at every join. */}
        {drawn.map((seg, i) => (
          <Polyline
            key={`halo-${i}`}
            points={points(seg)}
            fill="none"
            stroke={HALO_COLOR}
            strokeOpacity={HALO_OPACITY}
            strokeWidth={HALO_WEIGHT}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {legs.map((seg, i) => (
          <Polyline
            key={`gap-${i}`}
            points={points(seg)}
            fill="none"
            stroke={CONNECTOR_COLOR}
            strokeWidth={GAP_WEIGHT}
            strokeDasharray={GAP_DASH}
            strokeLinecap="butt"
          />
        ))}
        {drawn.map((seg, i) => (
          <Polyline
            key={`route-${i}`}
            points={points(seg)}
            fill="none"
            stroke={ROUTE_COLOR}
            strokeWidth={ROUTE_WEIGHT}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </View>
  );
}

/** SVG's `points` attribute: "x,y x,y …", rounded to a tenth of a point.
 *  Rounding is not cosmetic — these strings cross the bridge to the native
 *  renderer on every row, and fifteen significant figures per coordinate is
 *  bytes spent below the resolution of the screen. */
function points(seg: BoxPoint[]): string {
  return seg.map(({ x, y }) => `${round(x)},${round(y)}`).join(' ');
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

const styles = StyleSheet.create({
  thumb: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.mapTile,
    // The route is fitted to the full box and padded inside it, so nothing
    // should reach the corners — but a rounded tile with a line running to its
    // edge is a rendering bug waiting for one route shaped wrongly, and this
    // View has no shadow to lose by clipping.
    overflow: 'hidden',
  },
  fallback: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.iconTile,
  },
});
