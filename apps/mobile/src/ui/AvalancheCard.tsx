// Varsom's avalanche danger for the regions the route crosses.
//
// PHASE 3 OF docs/mobile-web-parity-plan.md, and the card on this screen with
// the highest stakes: it is the only one where the difference between reading
// it and misreading it is the difference between a tour and a burial. Which is
// why the danger scale's colours and names come from
// @fjellrute/core/avalanche/dangerScale rather than from anything in this file.
// A "3" that is orange here and orange-red on the web is a "3" that somebody
// remembers wrong, and every Norwegian avalanche product uses the same red for
// a 4 on purpose.
//
// The aspect rose is core's `roseSectorPath` for the same reason one step down:
// a rose whose sectors are drawn from a second implementation of the same
// trigonometry will eventually shade a different octant than the web does for
// the same bitstring, and nobody would catch it because nobody sees both roses
// at once.
//
// WHAT THE WEB HAS THAT THIS DELIBERATELY DOES NOT:
//
//   The 0-5 reference legend under the current risk. Six rows of badge-plus-
//   name is most of a phone screen, spent restating a scale that the badge
//   above it is already showing one row of. The level's full name is on the
//   card ("Considerable avalanche danger", not just "3"), which is the part of
//   the legend a reader of one forecast actually needs.
//
//   The EAWS problem pictograms. They are five JPGs bundled into apps/web, and
//   the web already marks them `aria-hidden` and decorative because the
//   problem's type name is written beside them. Copying five binaries into
//   apps/mobile/assets/ to reproduce a decoration is not a trade worth making;
//   the type name and the rose carry the meaning.
//
//   The date popover. The web can open a month grid because it has the room.
//   Here the ±2-day window IS the control — see WINDOW_OFFSETS below, and note
//   that it is core's window, not a smaller one chosen for the phone.

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { ProfileData } from '@fjellrute/core/elevation/profile';
import type {
  AvalancheProblem,
  AvalancheWarning,
} from '@fjellrute/core/avalanche/api';
import { todayLocalYMD, useAvalanche } from '@fjellrute/core/avalanche/useAvalanche';
import {
  DANGER_LEVELS,
  dangerLevelLabel,
} from '@fjellrute/core/avalanche/dangerScale';
import {
  DIRS,
  aspectList,
  elevationText,
  roseSectorPath,
} from '@fjellrute/core/avalanche/problemText';
import { shiftYMD } from '@fjellrute/core/time/calendar';
import { useT } from '@fjellrute/core/i18n';
import { DayChips } from './DayChips';
import { colors, fontSize, radius, space, TOUCH_TARGET } from './theme';

/**
 * The selectable window: two days back through two days forward.
 *
 * Copied from AvalancheRisk.tsx along with its reason, which is a property of
 * the upstream service rather than of either client: Varsom publishes a nowcast
 * plus the next two days, so a third day forward would never be assessed. The
 * two days back are there because a forecast you are checking against what you
 * actually found on the mountain is a forecast you learn from.
 */
const WINDOW_OFFSETS = [-2, -1, 0, 1, 2];

const VARSOM_PROBLEMS_URL =
  'https://www.varsom.no/en/avalanches/about-avalanches/avalanche-problems/';

export function AvalancheCard({ profile }: { profile: ProfileData }) {
  const t = useT();
  const today = useMemo(() => todayLocalYMD(), []);
  const [selected, setSelected] = useState(today);

  // The web separates `anchor` (the day picked in the date tool, which centres
  // the window) from `selected` (the day shown). With no date tool there is
  // nothing to move the anchor, so the window is fixed around today and one
  // piece of state does the work of two.
  const days = useMemo(
    () => WINDOW_OFFSETS.map((off) => shiftYMD(today, off)),
    [today],
  );

  const { level, regions, loading, error } = useAvalanche(profile, selected);

  let body: React.ReactNode;
  if (error && level === 0 && regions.length === 0) {
    body = (
      <Text style={styles.note}>
        {t('Skredfare utilgjengelig', 'Avalanche risk unavailable')}
      </Text>
    );
  } else if (loading && level === 0) {
    body = <ActivityIndicator color={colors.accent} />;
  } else if (level === 0) {
    // No assessed region along the route. Overwhelmingly this means "out of
    // season" rather than "safe", and the wording has to carry that: an empty
    // card on a summer route and an empty card on an unassessed winter route
    // look identical, and only one of them is reassuring.
    body = (
      <View style={styles.row}>
        <View style={[styles.badge, styles.badgeUnrated]}>
          <Text style={styles.badgeTextUnrated}>?</Text>
        </View>
        <View style={styles.rowText}>
          <Text style={styles.levelLabel}>{t('Ikke vurdert', 'Not assessed')}</Text>
          <Text style={styles.regionName}>
            {t(
              'Ingen skredvarsel for dette området',
              'No avalanche warning for this area',
            )}
          </Text>
        </View>
      </View>
    );
  } else {
    // One report per assessed region, highest danger first — core's ordering,
    // so the worst number on the route is the first thing read.
    body = (
      <View style={styles.reports}>
        {regions.map((r) => (
          <RegionReport key={r.regionId} region={r} />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <DayChips
        days={days}
        selected={selected}
        onSelect={setSelected}
        today={today}
        label={t('Varseldag', 'Forecast day')}
      />
      {body}
      <Text style={styles.attribution}>
        {t(
          'Sjekk alltid det nyeste varselet før du drar ut. Skredvarsel © NVE / Varsom.no, lisensiert under NLOD. Data leveres «som de er».',
          'Always check the latest bulletin before heading out. Avalanche forecast © NVE / Varsom.no, licensed under NLOD. Data provided “as is”.',
        )}
      </Text>
    </View>
  );
}

/** One region's report: the danger badge, the forecaster's headline advisory,
 *  its avalanche problems, and a way through to the full bulletin. */
function RegionReport({ region }: { region: AvalancheWarning }) {
  const t = useT();
  const info = DANGER_LEVELS[region.dangerLevel];
  const url = `https://www.varsom.no/snoskredvarsling/varsel/${encodeURIComponent(region.regionName)}/`;

  return (
    <View style={styles.report}>
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: info.color }]}>
          <Text style={[styles.badgeText, { color: info.onColor }]}>
            {region.dangerLevel}
          </Text>
        </View>
        <View style={styles.rowText}>
          <Text style={styles.levelLabel}>
            {dangerLevelLabel(region.dangerLevel)}
          </Text>
          <Text style={styles.regionName}>{region.regionName}</Text>
        </View>
      </View>

      {/* The forecaster's own words. Never summarised, never truncated: this is
          the one piece of the bulletin written by a person for this day, and a
          shortened version of it is a different warning. */}
      {region.mainText !== '' && (
        <Text style={styles.mainText}>{region.mainText}</Text>
      )}

      {region.problems.length > 0 && (
        <View style={styles.problems}>
          <Text style={styles.problemsHeading}>
            {t('Skredproblemer', 'Avalanche problems')}
          </Text>
          {region.problems.map((p, i) => (
            <Problem key={`${p.typeId}-${i}`} problem={p} />
          ))}
          <Pressable
            onPress={() => void Linking.openURL(VARSOM_PROBLEMS_URL)}
            accessibilityRole="link"
          >
            <Text style={styles.link}>
              {t('Om skredproblemer på varsom.no', 'About avalanche problems on varsom.no')}
            </Text>
          </Pressable>
        </View>
      )}

      <Pressable
        onPress={() => void Linking.openURL(url)}
        style={styles.bulletinLink}
        accessibilityRole="link"
      >
        <Text style={styles.link}>
          {t(
            `Fullstendig varsel for ${region.regionName} →`,
            `Full bulletin for ${region.regionName} →`,
          )}
        </Text>
      </Pressable>
    </View>
  );
}

/** One avalanche problem, collapsed to a title and its rose until tapped. */
function Problem({ problem }: { problem: AvalancheProblem }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const aspects = aspectList(problem.expositions);
  const elevation = elevationText(problem);

  return (
    <View style={styles.problem}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.problemHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.problemTitleCol}>
          <Text style={styles.problemTitle}>{problem.typeName}</Text>
          {problem.cause !== '' && (
            <Text style={styles.problemCause}>{problem.cause}</Text>
          )}
        </View>
        <AspectRose expositions={problem.expositions} />
        <Text style={styles.disclosure}>{open ? '▾' : '▸'}</Text>
      </Pressable>

      {open && (
        <View style={styles.problemDetail}>
          {problem.summary !== '' && (
            <Text style={styles.problemSummary}>{problem.summary}</Text>
          )}
          <Fact
            label={t('Himmelretninger', 'Aspects')}
            value={aspects.length > 0 ? aspects.join(', ') : null}
          />
          <Fact label={t('Høyde', 'Elevation')} value={elevation} />
          <Fact
            label={t('Sannsynlighet', 'Likelihood')}
            value={problem.probability}
          />
          <Fact label={t('Utløser', 'Trigger')} value={problem.sensitivity} />
          <Fact label={t('Skredstørrelse', 'Avalanche size')} value={problem.size} />
          <Fact label={t('Utbredelse', 'Distribution')} value={problem.distribution} />
        </View>
      )}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

/**
 * The octagonal aspect rose: the sectors facing an at-risk aspect are filled.
 *
 * Geometry from core, so this rose and the web's are the same drawing — see the
 * note at the top of the file. Only the drawing primitives differ, and even
 * those barely: react-native-svg's `Path` takes the same `d` string SVG does,
 * which is the whole reason `roseSectorPath` returns a string rather than a set
 * of coordinates.
 */
function AspectRose({ expositions }: { expositions: string }) {
  const c = 13;
  const r = 11;
  return (
    <Svg width={26} height={26} viewBox="0 0 26 26">
      {DIRS.map((_, i) => (
        <Path
          key={i}
          d={roseSectorPath(i, c, r)}
          fill={expositions[i] === '1' ? colors.danger : colors.background}
        />
      ))}
      <Circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={colors.hairlineStrong}
        strokeWidth={1}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s2 },
  reports: { gap: space.s3 },
  report: { gap: space.s2 },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  rowText: { flex: 1 },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeUnrated: {
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
  },
  badgeText: { fontSize: fontSize.lg, fontWeight: '700' },
  badgeTextUnrated: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.textMuted,
  },
  levelLabel: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  regionName: { fontSize: fontSize.xs, color: colors.textMuted },

  mainText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 20 },

  problems: { gap: space.s1 },
  problemsHeading: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textMuted,
  },
  problem: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  problemHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: space.s2,
    backgroundColor: colors.background,
  },
  problemTitleCol: { flex: 1 },
  problemTitle: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  problemCause: { fontSize: fontSize.xs, color: colors.textMuted },
  disclosure: { fontSize: fontSize.sm, color: colors.textMuted },
  problemDetail: { padding: space.s2, gap: space.s1 },
  problemSummary: { fontSize: fontSize.sm, color: colors.text, lineHeight: 19 },

  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: space.s2 },
  factLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  factValue: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.text,
    textAlign: 'right',
  },

  bulletinLink: { minHeight: TOUCH_TARGET - 16, justifyContent: 'center' },
  // NOT `colors.accent`, which is the obvious choice and unreadable: #2dd4bf on
  // white is about 1.9:1, well under the 4.5:1 a body-sized run of text needs,
  // and this particular link is how somebody reaches the full bulletin. The
  // near-black teal is the palette's own answer for text that must be legible
  // and still belong to the accent, and the underline is what says "link" once
  // the colour has stopped doing it.
  link: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.accentContrast,
    textDecorationLine: 'underline',
  },

  note: { fontSize: fontSize.sm, color: colors.textMuted },
  attribution: { fontSize: fontSize.xs, color: colors.textFaint, lineHeight: 15 },
});
