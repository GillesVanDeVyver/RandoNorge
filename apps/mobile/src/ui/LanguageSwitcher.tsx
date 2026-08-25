// The NO | EN toggle, ported from apps/web/src/components/LanguageSwitcher.tsx.
//
// WHAT IS SHARED AND WHAT ISN'T, because the plan asks for the switcher to be
// "ported" and it is worth being precise about what that means. Everything with
// behaviour — the locale list, the labels, the store, the persistence — comes
// from @fjellrute/core and is byte-identical to the web's. What is rewritten is
// only the rendering: `<button>` becomes Pressable, a CSS module becomes a
// StyleSheet. Add a third language to core and both apps grow a third button
// with no edit here.
//
// The web version has `variant` and `emphasis` props for the surfaces it sits
// on (a photo, a popover, map chrome). Those are not reproduced speculatively;
// `onMap` exists because there is a real second surface in Phase 3.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  useLocale,
  useT,
} from '@fjellrute/core/i18n';
import { colors, radius, spacing, TOUCH_TARGET } from './theme';

type Props = {
  /** Render for sitting on top of the map: translucent backing, tighter. */
  onMap?: boolean;
};

export function LanguageSwitcher({ onMap = false }: Props) {
  const { locale, setLocale } = useLocale();
  const t = useT();

  return (
    <View
      style={[styles.group, onMap && styles.groupOnMap]}
      // The web uses role="group" with an aria-label. React Native's nearest
      // equivalent that both platforms honour is a labelled container; the
      // individual buttons carry the state.
      accessibilityRole="radiogroup"
      accessibilityLabel={t('Velg språk', 'Choose language')}
    >
      {LOCALES.map((code) => {
        const active = code === locale;
        return (
          <Pressable
            key={code}
            onPress={() => setLocale(code)}
            style={({ pressed }) => [
              styles.option,
              active && styles.optionActive,
              pressed && !active && styles.optionPressed,
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            // Not translated, on purpose, exactly as on the web: "English"
            // has to read as English to someone who cannot read the language
            // currently on screen.
            accessibilityLabel={LOCALE_LABELS[code]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>
              {LOCALE_SHORT_LABELS[code]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    padding: 2,
  },
  groupOnMap: {
    backgroundColor: colors.overlay,
  },
  option: {
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET - 8,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  optionPressed: {
    backgroundColor: colors.background,
  },
  optionActive: {
    backgroundColor: colors.accent,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  labelActive: {
    color: colors.accentText,
  },
});
