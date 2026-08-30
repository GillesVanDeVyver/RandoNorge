// The hourly forecast, as the phone's half of apps/web's WeatherPanel.
//
// PHASE 3 OF docs/mobile-web-parity-plan.md, whose description of this work was
// "useWeather from core plus a React Native view — genuinely zero new logic",
// and that is what this file is: `weatherCandidates` picks the two anchor
// points, `useWeather` fetches, `groupByDay` buckets, `fmtPrecip` decides what
// a precipitation cell says and `windArrowRotation` decides where the arrow
// points. All five are core's, and three of them became core's in this commit
// by being lifted out of WeatherPanel.tsx — where they had been sitting beside
// the JSX that used them, which is why the phone would otherwise have needed
// its own copy of MET's six-hourly-total rule.
//
// WHAT THE WEB HAS THAT THIS DOES NOT: the frozen-snapshot path. The web reads
// `ForecastContext` so that opening a saved or shared route shows the forecast
// its owner saw rather than a live one, and publishes the selected anchor and
// day back so a save captures exactly what is on screen. The phone cannot save
// or share a route yet — that is not in Phases 0-3 — so wiring the context here
// would be plumbing with nothing on either end of it. `useWeather` takes the
// frozen data as an optional argument, so it is one prop away when the phone
// grows a save button.

import { startTransition, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ProfileData } from '@fjellrute/core/elevation/profile';
import { useWeather, weatherCandidates } from '@fjellrute/core/weather/useWeather';
import {
  fmtPrecip,
  groupByDay,
  windArrowRotation,
} from '@fjellrute/core/weather/format';
import { pad2, toYMD } from '@fjellrute/core/time/calendar';
import { useT } from '@fjellrute/core/i18n';
import { DayChips } from './DayChips';
import { WeatherSymbol, WindArrowIcon } from './WeatherIcons';
import { colors, fontSize, radius, space, TOUCH_TARGET } from './theme';

type LocationKey = 'lowest' | 'highest';

/**
 * How many hours are shown before the "show all" control appears.
 *
 * The web shows the whole day in a panel with its own scrollbar. That does not
 * port: this card lives inside the sheet's single vertical scroll, and a nested
 * scroll view would mean two surfaces competing for the same drag — the gesture
 * arbitration React Native does there is exactly as confusing as it sounds, and
 * on a sheet that itself opens and closes by dragging it is worse.
 *
 * So the card grows instead of scrolling, and starts short enough that the snow
 * and avalanche cards below it are still reachable without twenty-four rows of
 * scrolling first. Eight is roughly a waking half-day.
 */
const COLLAPSED_ROWS = 8;

export function WeatherCard({ profile }: { profile: ProfileData }) {
  const t = useT();
  const candidates = useMemo(() => weatherCandidates(profile), [profile]);
  const [locKey, setLocKey] = useState<LocationKey>('lowest');
  const [showAll, setShowAll] = useState(false);

  // `candidates` is null for a route with no usable elevations, and the hook
  // takes null happily (it simply fetches nothing). Calling it unconditionally
  // matters more than the branch is worth: hooks may not be skipped, and an
  // early return above this line is the bug that would cause.
  const point = candidates ? candidates[locKey] : null;
  const { hours, loading, error } = useWeather(point);

  const today = useMemo(() => toYMD(new Date()), []);
  const grouped = useMemo(() => (hours ? groupByDay(hours) : null), [hours]);
  const days = useMemo(() => (grouped ? [...grouped.keys()].sort() : []), [grouped]);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  useEffect(() => {
    // Two cases, and the second is the one that is easy to miss: no day chosen
    // yet, and a day that has fallen off the end of MET's window while the card
    // was open. Both land on something that exists.
    //
    // `startTransition` for the same reason WeatherPanel.tsx uses it here — the
    // day this chooses decides which twenty-four rows render, and committing
    // that synchronously from an effect is a cascading render that lands in the
    // same frame as the forecast arriving. react-hooks/set-state-in-effect
    // flags the unwrapped form, correctly.
    if (days.length === 0) return;
    if (!selectedDay) {
      startTransition(() => setSelectedDay(days.includes(today) ? today : days[0]));
    } else if (!days.includes(selectedDay)) {
      startTransition(() => setSelectedDay(days[0]));
    }
  }, [days, selectedDay, today]);

  const rows = useMemo(() => {
    if (!grouped || !selectedDay) return [];
    return grouped.get(selectedDay) ?? [];
  }, [grouped, selectedDay]);

  const shown = showAll ? rows : rows.slice(0, COLLAPSED_ROWS);

  if (!candidates) {
    return (
      <Text style={styles.note}>
        {t(
          'Ingen høydedata for denne ruta, så værstedet kan ikke velges.',
          'No elevation data for this route, so no forecast point can be chosen.',
        )}
      </Text>
    );
  }

  const locSwitch = (
    <View
      style={styles.locSwitch}
      accessibilityRole="radiogroup"
      accessibilityLabel={t('Værsted', 'Forecast location')}
    >
      {(['lowest', 'highest'] as LocationKey[]).map((k) => {
        const active = k === locKey;
        return (
          <Pressable
            key={k}
            onPress={() => setLocKey(k)}
            style={[styles.locOption, active && styles.locOptionActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.locLabel, active && styles.locLabelActive]}>
              {k === 'lowest'
                ? t('Laveste punkt', 'Lowest point')
                : t('Høyeste punkt', 'Highest point')}
            </Text>
            <Text style={[styles.locElev, active && styles.locElevActive]}>
              {Math.round(candidates[k].elevation)} m
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  let body: React.ReactNode;
  if (error && !hours) {
    body = <Text style={styles.note}>{t('Vær utilgjengelig', 'Weather unavailable')}</Text>;
  } else if (!hours || days.length === 0) {
    // `loading` is false and `hours` null in one more case than the obvious
    // one — a route whose anchor point MET has no forecast for — so this is the
    // spinner OR the empty statement, not the spinner alone.
    body = loading ? (
      <ActivityIndicator color={colors.accent} />
    ) : (
      <Text style={styles.note}>{t('Ingen værdata', 'No forecast data')}</Text>
    );
  } else {
    body = (
      <>
        <DayChips
          days={days}
          selected={selectedDay}
          onSelect={(ymd) => {
            setSelectedDay(ymd);
            // Collapse again on a new day. Leaving it expanded means tapping a
            // chip scrolls the card's own heading off the top of the sheet,
            // which reads as the app having jumped somewhere.
            setShowAll(false);
          }}
          today={today}
          label={t('Værdag', 'Forecast day')}
        />

        <View style={styles.header}>
          <Text style={[styles.headerCell, styles.colTime]}>{t('Tid', 'Time')}</Text>
          <View style={styles.colSky} />
          <Text style={[styles.headerCell, styles.colTemp]}>{t('Temp.', 'Temp.')}</Text>
          <Text style={[styles.headerCell, styles.colPrecip]}>{t('mm', 'mm')}</Text>
          <Text style={[styles.headerCell, styles.colWind]}>{t('m/s', 'm/s')}</Text>
        </View>

        {shown.map((h) => {
          // The hour is read in the device's local time, which is what the rest
          // of the app does and what a user on a Norwegian mountain means by
          // "14:00". MET's timestamps are UTC; core's grouping is local for the
          // same reason (see time/calendar.ts).
          const hh = pad2(new Date(h.time).getHours());
          const precip = fmtPrecip(h);
          const cold = h.temperature <= 0;
          return (
            <View key={h.time} style={styles.row}>
              <Text style={[styles.cell, styles.colTime]}>{hh}</Text>
              <View style={styles.colSky}>
                <WeatherSymbol code={h.symbolCode} size={26} />
              </View>
              <Text
                style={[styles.cell, styles.colTemp, cold && styles.tempCold]}
              >
                {Math.round(h.temperature)}°
              </Text>
              <Text
                style={[
                  styles.cell,
                  styles.colPrecip,
                  precip ? styles.precip : styles.precipEmpty,
                ]}
              >
                {precip ?? '—'}
              </Text>
              <View style={styles.colWind}>
                <Text style={styles.cell}>
                  {Math.round(h.windSpeed)}
                  {h.windGust != null && (
                    <Text style={styles.gust}> ({Math.round(h.windGust)})</Text>
                  )}
                </Text>
                <View
                  style={{
                    transform: [
                      { rotate: `${windArrowRotation(h.windFromDeg)}deg` },
                    ],
                  }}
                >
                  <WindArrowIcon color={colors.textMuted} />
                </View>
              </View>
            </View>
          );
        })}

        {rows.length > COLLAPSED_ROWS && (
          <Pressable
            onPress={() => setShowAll((on) => !on)}
            style={styles.more}
            accessibilityRole="button"
          >
            <Text style={styles.moreText}>
              {showAll
                ? t('Vis færre timer', 'Show fewer hours')
                : t(
                    `Vis alle ${rows.length} timer`,
                    `Show all ${rows.length} hours`,
                  )}
            </Text>
          </Pressable>
        )}
      </>
    );
  }

  return (
    <View style={styles.card}>
      {locSwitch}
      {body}
      {/* MET's terms require the credit wherever the data is shown, which
          includes a phone screen. The web renders this through
          SourceAttribution; there is one caller here, so it is written out. */}
      <Text style={styles.attribution}>
        {t('Værvarsel fra', 'Forecast from')} MET Norway,{' '}
        {t('lisensiert under', 'licensed under')} NLOD.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s2 },

  locSwitch: {
    flexDirection: 'row',
    gap: space.s1,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    padding: 2,
  },
  locOption: {
    flex: 1,
    minHeight: TOUCH_TARGET - 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: space.s1,
    borderRadius: radius.sm - 2,
  },
  locOptionActive: { backgroundColor: colors.surface },
  locLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  locLabelActive: { color: colors.text, fontWeight: '600' },
  locElev: {
    fontSize: fontSize.xs,
    color: colors.textFaint,
    fontVariant: ['tabular-nums'],
  },
  locElevActive: { color: colors.textMuted },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: space.s1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  headerCell: { fontSize: fontSize.xs, color: colors.textFaint },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 30,
  },
  cell: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  // Column widths, not a grid: React Native has no `grid-template-columns`, so
  // the web's five-column template becomes five fixed-or-flexed cells. The
  // numbers are chosen so the widest realistic value in each (−28°, 12.5, 18
  // (24)) still fits without wrapping, because a row that wraps is a row that
  // is twice as tall as its neighbours.
  colTime: { width: 26 },
  colSky: { width: 32, alignItems: 'center' },
  colTemp: { width: 42, textAlign: 'right' },
  colPrecip: { width: 52, textAlign: 'right' },
  colWind: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.s1,
  },

  tempCold: { color: colors.snow },
  precip: { color: colors.snow },
  precipEmpty: { color: colors.textFaint },
  gust: { color: colors.textMuted, fontSize: fontSize.xs },

  more: {
    minHeight: TOUCH_TARGET - 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },

  note: { fontSize: fontSize.sm, color: colors.textMuted },
  attribution: { fontSize: fontSize.xs, color: colors.textFaint },
});
