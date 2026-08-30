// The horizontal row of day chips that sits above a forecast.
//
// One component, two callers — the weather card and the avalanche card — which
// is the arrangement apps/web does NOT have: WeatherPanel.module.css and
// AvalancheRisk.module.css each define `.dayBar`, `.dayBtn`, `.dayBtnActive`,
// `.dayLabel` and `.dayDate`, with the same values, twice. The labels inside
// them had already drifted apart before Phase 3 (one knew about "Yesterday" and
// the other did not, so the same date read differently on two panels of the
// same screen), which is why `dayLabel` is now core's. This file is the same
// consolidation applied to the chip itself rather than to its text.
//
// The chips are a tablist, not a group of buttons: they are a single choice
// among visible alternatives, and the accessibility semantics for that are what
// tell a screen reader "3 of 7" instead of reading out seven separate buttons.
// React Native's `accessibilityRole="tab"` maps to the platform equivalents.

import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { dayDate, dayLabel } from '@fjellrute/core/time/calendar';
import { colors, fontSize, radius, space } from './theme';

interface Props {
  /** The days to offer, as YYYY-MM-DD, in the order they should appear. */
  days: string[];
  /** Which one is shown. Not required to be in `days` — an avalanche date the
   *  user picked outside the window would simply leave no chip highlighted. */
  selected: string | null;
  onSelect: (ymd: string) => void;
  /** Today, so the chips can say "Today" and "Tomorrow". Passed in rather than
   *  computed here because both callers already hold it, and a component that
   *  reads the clock itself is a component that cannot be tested at a date. */
  today: string;
  /** The row's accessible name — "Forecast day" for both callers today, but
   *  they are separate lists on the same screen and a screen reader announcing
   *  two unnamed tablists is not usable. */
  label: string;
}

export function DayChips({ days, selected, onSelect, today, label }: Props) {
  return (
    // Horizontal scroll rather than wrapping or squeezing. The weather card
    // offers up to ten days and a phone fits about four; wrapping would make
    // the card twice as tall inside a sheet that is already the shorter half of
    // the screen, and shrinking the chips to fit ten would put them below the
    // 44pt touch target.
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.bar}
      accessibilityRole="tablist"
      accessibilityLabel={label}
    >
      {days.map((ymd) => {
        const active = ymd === selected;
        return (
          <Pressable
            key={ymd}
            onPress={() => onSelect(ymd)}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipActive,
              pressed && !active && styles.chipPressed,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, active && styles.labelActive]}>
              {dayLabel(ymd, today)}
            </Text>
            <Text style={[styles.date, active && styles.dateActive]}>
              {dayDate(ymd)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { gap: space.s1, paddingVertical: space.s1 },
  chip: {
    minWidth: 62,
    paddingVertical: space.s1,
    paddingHorizontal: space.s2,
    borderRadius: radius.sm,
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  chipPressed: { opacity: 0.7 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { fontSize: fontSize.xs, fontWeight: '600', color: colors.text },
  labelActive: { color: colors.accentContrast },
  date: { fontSize: fontSize.xs, color: colors.textMuted },
  // Not `textMuted` over the accent fill: the muted token is an alpha over the
  // cream page and turns muddy over teal. The contrast colour at reduced
  // opacity keeps the same relationship the web's `.dayBtnActive .dayDate` has.
  dateActive: { color: colors.accentContrast, opacity: 0.75 },
});
