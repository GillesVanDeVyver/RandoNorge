// The route's elevation profile, drawn with react-native-svg.
//
// The parity plan calls this "the single highest-value item in the whole plan",
// and it is also the smallest: `computeProfile` is core's and already written,
// the colour rule is core's `segmentStyle`, the axis rounding is core's
// `ticks`, the vertical domain is core's `elevationExtent` and the earth ramp
// under the line is core's `ELEV_FILL_STOPS`. What is left here is turning
// those into <Path> and <Line>, which is the only part that could not have been
// written anywhere but in an app.
//
// MODELLED ON apps/web/src/briefing/ProfileSvg.tsx rather than on the planner's
// on-screen chart, because the briefing draws this same picture by hand in SVG
// while the planner draws it in Recharts, and Recharts renders DOM. Element for
// element the two files are close enough that a change to the shape of the
// chart should be made in both; what differs is listed where it happens.
//
// THE ONE REAL DIVERGENCE IS RUNOUT, and it is not a shortcut. NVE's runout
// zones are read by fetching an /export PNG and sampling its pixels, which
// needs a canvas; `hasRasterSampler()` is false on React Native, so every point
// arrives as RUNOUT_UNKNOWN. Passing that through `segmentStyle` unchanged
// would dash every stretch flat enough for runout to matter — several hundred
// dashes along a valley floor, all saying the same thing, none of them
// readable as saying anything. So this passes `runout: false` and states the
// gap once, in a sentence under the chart. See SegmentStyleOptions.runout,
// which was written for exactly this caller.
//
// NOT MEASURED IN A viewBox. The briefing scales a fixed 1000-unit viewBox to
// whatever width the page turns out to be, with preserveAspectRatio="none",
// and takes distorted axis text as the price of not knowing the width in
// advance. Here the width is knowable — one onLayout — so the chart is drawn in
// real points and the labels come out the size the type scale says they are.

import { Fragment, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Line,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { useT } from '@fjellrute/core/i18n';
import type { ProfileData } from '@fjellrute/core/elevation/profile';
import {
  elevationExtent,
  ELEV_FILL_STOPS,
  segmentStyle,
} from '@fjellrute/core/elevation/profileChart';
import { ticks } from '@fjellrute/core/chart/axis';
import { colors, fontSize, space } from './theme';

/**
 * Height of the plot itself, in points.
 *
 * The briefing's fixed strip is 174 units of a 1000-unit-wide viewBox — a
 * little under a fifth of the width. A phone is around 360 wide, so the same
 * proportion would be 63 points, which is a thread. The strip is instead sized
 * against the sheet: `SHEET_PEEK` (64) plus a heading plus this has to leave
 * room for the cards below it in an expanded sheet of at most 560, and 120 is
 * what that allows while still showing a col as a col. Proportion is not
 * carried across here, and deliberately — see routeStyle's thumbnail note for
 * the same argument at the other end of the size range.
 */
const PLOT_H = 120;

/** Room for the elevation labels down the left. Four digits of `fontSize.xs`
 *  plus the gap to the gridline; a 4-digit summit is Galdhøpiggen and fits. */
const PAD_L = 34;
const PAD_R = space.s2;
const PAD_T = space.s2;
/** Room under the plot for the distance labels and their unit. */
const PAD_B = 18;

/** Stroke width of the profile line. Heavier than the briefing's, because a
 *  phone is held at arm's length and printed paper is not, and because the
 *  colour IS the information — a hairline in #ffaa00 and a hairline in #ff5500
 *  are the same hairline at this distance. */
const LINE_WIDTH = 2.5;

/** Dash for a stretch whose slope could not be measured: short mark, long gap,
 *  so it reads as absence rather than as a different kind of line. */
const UNKNOWN_DASH = [2, 3];

/** Target tick counts. Fewer than the briefing's 4 and 6 — the same number of
 *  labels in a third of the width is a smudge, which is the thinning problem
 *  ProfileSvg solves after the fact with pickEvenly and this solves by asking
 *  for less. */
const Y_TICKS = 3;
const X_TICKS = 4;

/** Gradient id. One per module is enough: react-native-svg scopes ids per
 *  <Svg>, and there is one chart. */
const FILL_ID = 'elevFill';

interface Props {
  profile: ProfileData;
  /**
   * Colour the line by slope angle.
   *
   * Driven by the map's own steepness toggle rather than by a second switch of
   * its own, which is a deliberate difference from the web. There the profile
   * carries its own steepness checkbox because the panel is a column beside the
   * map and both controls are visible at once; here the toggle is on the map
   * and the chart is inside a sheet, so two independent switches for one idea
   * would be two switches the user can never see together. One toggle, and the
   * overlay and the line always agree about what they are saying.
   */
  steepness?: boolean;
}

export function ElevationProfile({ profile, steepness = true }: Props) {
  const t = useT();
  // Zero until the first layout pass. Rendering an SVG with a zero width is
  // harmless — it draws nothing and is replaced a frame later — and it is the
  // only way to know the width without hard-coding a screen size.
  const [width, setWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  // Only segments with two or more usable elevations can be drawn. Kartverket
  // returns NaN over the sea and outside its coverage, and a single point is a
  // dot, not a line.
  const segs = profile.segments
    .map((seg) => seg.filter((p) => Number.isFinite(p.elevation)))
    .filter((seg) => seg.length >= 2);

  const height = PAD_T + PLOT_H + PAD_B;

  if (segs.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <Text style={styles.empty}>
          {t(
            'Høydeprofil utilgjengelig for denne ruta.',
            'Elevation profile unavailable for this route.',
          )}
        </Text>
      </View>
    );
  }

  const maxD = profile.stats.distance || 1;
  // Core's, and the briefing's: a flat route widened to a sane span instead of
  // dividing by zero, then 8% of headroom so the summit never touches the top
  // edge and read as clipped.
  const { min: yMin, max: yMax } = elevationExtent(
    segs.flatMap((seg) => seg.map((p) => p.elevation)),
  );

  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const x = (d: number) => PAD_L + (d / maxD) * plotW;
  const y = (e: number) =>
    PAD_T + PLOT_H - ((e - yMin) / (yMax - yMin)) * PLOT_H;

  const yTicks = ticks(yMin, yMax, Y_TICKS);
  const xTicks = ticks(0, maxD, X_TICKS);
  // Kilometres once the route is long enough that metres would be four digits
  // per label. The briefing's threshold, so the two axes read alike.
  const inKm = maxD >= 3000;

  // Does anything on this route have an unmeasurable slope? Asked so the note
  // under the chart appears only when there is something to note — a caveat
  // printed under every route is a caveat nobody reads under the one route
  // where it mattered.
  const anyUnknownSlope =
    steepness &&
    segs.some((seg) => seg.some((p) => !Number.isFinite(p.slopeDeg)));

  return (
    <View onLayout={onLayout}>
      <Svg width="100%" height={height}>
        <Defs>
          {/* Pinned to the plot's own top and bottom in user space, not to each
              path's bounding box. A route with eraser gaps is several area
              paths, and a bounding-box gradient would restart the ramp inside
              each of them — so a short segment over a narrow height range would
              show the full ramp in a few points while the long one beside it
              spread it over a hundred. ProfileSvg says the same thing at
              greater length; the failure is identical on both platforms. */}
          <LinearGradient
            id={FILL_ID}
            gradientUnits="userSpaceOnUse"
            x1={0}
            y1={PAD_T}
            x2={0}
            y2={PAD_T + PLOT_H}
          >
            {ELEV_FILL_STOPS.map((s) => (
              <Stop
                key={s.at}
                offset={`${s.at * 100}%`}
                stopColor={s.color}
                stopOpacity={s.opacity}
              />
            ))}
          </LinearGradient>
        </Defs>

        {/* Elevation gridlines and their labels. Dashed and faint: they are
            furniture, and the line on top of them is not. */}
        {yTicks.map((e) => (
          <Line
            key={`yl${e}`}
            x1={PAD_L}
            x2={PAD_L + plotW}
            y1={y(e)}
            y2={y(e)}
            stroke={colors.hairline}
            strokeWidth={StyleSheet.hairlineWidth}
            strokeDasharray={[2, 3]}
          />
        ))}
        {yTicks.map((e) => (
          <SvgText
            key={`yt${e}`}
            x={PAD_L - 5}
            // +4 rather than a vertical alignment prop: `alignmentBaseline` is
            // one of the attributes react-native-svg maps unevenly across
            // iOS and Android, and half the type size is the same nudge on
            // both.
            y={y(e) + 4}
            fontSize={fontSize.xs}
            fill={colors.textFaint}
            textAnchor="end"
          >
            {Math.round(e)}
          </SvgText>
        ))}

        {/* Distance along the base, and its unit where the elevation labels
            end — the same place the briefing puts it, so the corner of the
            chart always says what the numbers above it are counting. */}
        {xTicks.map((d) => (
          <SvgText
            key={`xt${d}`}
            x={x(d)}
            y={height - 4}
            fontSize={fontSize.xs}
            fill={colors.textFaint}
            textAnchor="middle"
          >
            {inKm ? (d / 1000).toFixed(1) : Math.round(d)}
          </SvgText>
        ))}
        <SvgText
          x={PAD_L - 5}
          y={height - 4}
          fontSize={fontSize.xs}
          fill={colors.textFaint}
          textAnchor="end"
        >
          {inKm ? 'km' : 'm'}
        </SvgText>

        {segs.map((seg, si) => {
          const area =
            `M ${x(seg[0].distance)} ${y(seg[0].elevation)} ` +
            seg
              .slice(1)
              .map((p) => `L ${x(p.distance)} ${y(p.elevation)}`)
              .join(' ') +
            ` L ${x(seg[seg.length - 1].distance)} ${PAD_T + PLOT_H}` +
            ` L ${x(seg[0].distance)} ${PAD_T + PLOT_H} Z`;
          return (
            <Fragment key={si}>
              <Path d={area} fill={`url(#${FILL_ID})`} />
              {seg.slice(1).map((p, i) => {
                const a = seg[i];
                // Core's rule, with runout off — see the header. `dashed` here
                // therefore only ever means "slope unknown", which is the one
                // thing this platform can still tell the truth about.
                const { color, dashed } = segmentStyle(a, p, {
                  steepness,
                  runout: false,
                });
                return (
                  <Line
                    key={i}
                    x1={x(a.distance)}
                    y1={y(a.elevation)}
                    x2={x(p.distance)}
                    y2={y(p.elevation)}
                    stroke={color}
                    strokeWidth={LINE_WIDTH}
                    strokeLinecap="round"
                    strokeDasharray={dashed ? UNKNOWN_DASH : undefined}
                  />
                );
              })}
            </Fragment>
          );
        })}
      </Svg>

      {steepness && (
        <Text style={styles.note}>
          {/* The honest sentence the header promised, in place of several
              hundred dashes. It says what is missing and does not apologise:
              the terrain colours are real, the runout overlay is not on this
              chart, and the map has NVE's own layer a tap away. */}
          {t(
            'Fargene viser terrenghelling. Utløpssoner vises ikke i profilen på mobil — slå på bratthetslaget på kartet.',
            'Colours show terrain steepness. Runout zones are not drawn in the profile on mobile — turn on the steepness layer on the map.',
          )}
          {anyUnknownSlope
            ? t(
                ' Stiplet strek betyr ukjent helling.',
                ' A dashed stretch means the slope is unknown.',
              )
            : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyBox: { paddingVertical: space.s3 },
  empty: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
  note: {
    marginTop: space.s2,
    fontSize: fontSize.xs,
    color: colors.textFaint,
    lineHeight: 15,
  },
});
