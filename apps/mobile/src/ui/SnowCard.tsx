// Modelled snow depth along the route, from seNorge via core's `useSnow`.
//
// PHASE 3 OF docs/mobile-web-parity-plan.md. The web shows this twice — as a
// band under the elevation profile (briefing/SnowSvg.tsx) and as a row of
// figures in the printed briefing — and the phone shows only the figures. That
// is a deliberate subtraction rather than work left undone: the depth band is
// legible on the web because it is stacked under a profile several hundred
// pixels wide and shares its x-axis, and the phone's profile is 120 points tall
// inside a sheet. A second chart of the same width, carrying one number per
// pixel column, would be a texture rather than information.
//
// What is left is exactly `summariseSnow`, which moved into core in this commit
// (packages/core/src/snow/summary.ts, from apps/web/src/briefing/) — the range,
// the mean, the two endpoint readings and the coverage. Those are the numbers
// the printed briefing puts in its key-facts panel, which is itself the
// summary-for-people-not-looking-at-a-chart, so the phone is showing the form
// that was already designed for this.
//
// SENORGE IS A MODEL, and every number here is hedged accordingly. It is an
// interpolated 1 km grid: the value for a point is the value for the square
// kilometre around it, which on a mountain contains both a wind-scoured ridge
// and a metre-deep lee slope. `coverage` below is not a diagnostic — it is the
// share of the route the grid answered for at all, and a route that is half
// outside the grid deserves to say so on the screen where somebody is deciding
// whether to bring skis.

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ProfileData } from '@fjellrute/core/elevation/profile';
import { useSnow } from '@fjellrute/core/snow/useSnow';
import { summariseSnow } from '@fjellrute/core/snow/summary';
import {
  dayDate,
  dayLabel,
  shiftYMD,
  todayLocalYMD,
} from '@fjellrute/core/time/calendar';
import { useT } from '@fjellrute/core/i18n';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { colors, fontSize, radius, space, TOUCH_TARGET } from './theme';

export function SnowCard({ profile }: { profile: ProfileData }) {
  const t = useT();
  const today = useMemo(() => todayLocalYMD(), []);
  const [date, setDate] = useState(today);

  const { snow, loading, error } = useSnow(profile, date);
  const summary = useMemo(
    () => (snow ? summariseSnow(profile, snow) : null),
    [profile, snow],
  );

  // THE PHONE'S SnowDateBar, minus four of its eight buttons — and the four
  // that went are the four the web itself hides below its own 760px breakpoint
  // (SnowDateBar.module.css's `.secondary`: ±week and ±year). So this is not a
  // reduced version of the web's control, it is the same control at the same
  // width. Stepping past today is refused for the same reason the web sets
  // `max` on its date input: seNorge is a hindcast and has nothing to say about
  // tomorrow.
  const step = (days: number) => {
    const next = shiftYMD(date, days);
    setDate(next > today ? today : next);
  };
  const atToday = date === today;

  let body: React.ReactNode;
  if (error) {
    body = (
      <Text style={styles.note}>
        {t('Snødybde utilgjengelig', 'Snow depth unavailable')}
      </Text>
    );
  } else if (loading && !snow) {
    body = <ActivityIndicator color={colors.snow} />;
  } else if (!summary) {
    // Two different nothings, said as one sentence because the user's next
    // action is the same either way: seNorge modelled no value for any point on
    // the route (outside the grid), or the route has no profile to hang the
    // depths on. Distinguishing them on screen would be reporting on our own
    // internals.
    body = (
      <Text style={styles.note}>
        {t(
          'Ingen modellerte snødybder for denne ruta på denne datoen.',
          'No modelled snow depths for this route on this date.',
        )}
      </Text>
    );
  } else {
    body = (
      <>
        <View style={styles.rangeRow}>
          <Text style={styles.range}>
            {Math.round(summary.minCm)}–{Math.round(summary.maxCm)}
          </Text>
          <Text style={styles.unit}>cm</Text>
        </View>
        <Stat
          label={t('Snitt langs ruta', 'Average along route')}
          value={`${Math.round(summary.meanCm)} cm`}
        />
        <Stat
          label={t('Ved laveste punkt', 'At lowest point')}
          value={
            summary.atLowCm != null ? `${Math.round(summary.atLowCm)} cm` : '—'
          }
        />
        <Stat
          label={t('Ved høyeste punkt', 'At highest point')}
          value={
            summary.atHighCm != null ? `${Math.round(summary.atHighCm)} cm` : '—'
          }
        />
        {/* Only when it is not the whole route. A line saying "100% covered"
            on every ordinary route trains people to stop reading it, which is
            exactly the wrong habit for the one route where it says 40%. */}
        {summary.coverage < 0.98 && (
          <Text style={styles.warning}>
            {t(
              `Modellen dekker ${Math.round(summary.coverage * 100)} % av ruta.`,
              `The model covers ${Math.round(summary.coverage * 100)}% of the route.`,
            )}
          </Text>
        )}
      </>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.dateBar}>
        <Pressable
          onPress={() => step(-1)}
          style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t('Forrige dag', 'Previous day')}
        >
          <ChevronLeftIcon color={colors.text} />
        </Pressable>

        <View style={styles.dateText}>
          <Text style={styles.dateDay}>{dayLabel(date, today)}</Text>
          <Text style={styles.dateDate}>{dayDate(date)}</Text>
        </View>

        <Pressable
          onPress={() => step(1)}
          disabled={atToday}
          style={({ pressed }) => [
            styles.stepBtn,
            pressed && styles.pressed,
            atToday && styles.disabled,
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: atToday }}
          accessibilityLabel={t('Neste dag', 'Next day')}
        >
          <ChevronRightIcon color={colors.text} />
        </Pressable>
      </View>

      {body}

      <Text style={styles.attribution}>
        {t('Modellert snødybde fra', 'Modelled snow depth from')} seNorge / NVE,{' '}
        {t('lisensiert under', 'licensed under')} NLOD.
      </Text>
    </View>
  );
}

/** Same shape as the route screen's stat row. Not imported from there because
 *  that one is a private helper of a screen; the day this appears a third time
 *  is the day it earns a file. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s2 },

  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingHorizontal: space.s1,
  },
  stepBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET - 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.3 },
  dateText: { alignItems: 'center' },
  dateDay: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  dateDate: { fontSize: fontSize.xs, color: colors.textMuted },

  rangeRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.s1 },
  range: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.snow,
    fontVariant: ['tabular-nums'],
  },
  unit: { fontSize: fontSize.sm, color: colors.textMuted },

  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 3,
  },
  statLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  statValue: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  warning: {
    fontSize: fontSize.xs,
    color: colors.warning,
    backgroundColor: colors.warningSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warningBorder,
    borderRadius: radius.sm,
    paddingVertical: space.s1,
    paddingHorizontal: space.s2,
    overflow: 'hidden',
  },

  note: { fontSize: fontSize.sm, color: colors.textMuted },
  attribution: { fontSize: fontSize.xs, color: colors.textFaint },
});
