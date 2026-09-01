// The planner's editing controls, floating over the map.
//
// PHASE 4 OF docs/mobile-web-parity-plan.md. The web's equivalent is
// apps/web/src/components/Toolbar.tsx, and the labels here are that file's
// labels character for character — "Tegn"/"Draw", "Slett"/"Erase",
// "Angre"/"Undo", "Fjern alt"/"Clear all" — because a user who plans on a
// laptop and skis with a phone should not have to learn two vocabularies for
// one tool. The tooltips became accessibility labels, which is the same string
// doing the same job through a different sense.
//
// WHAT IS NOT HERE, and is on the web: the freehand/straight-lines switch,
// import, export, print. Straight-line drawing wants draggable vertex handles
// on the map, which is its own gesture problem and not what the phase asked
// for; the other three are file pickers and a print dialog, which the plan puts
// in Phase 5 behind native modules the phone does not have yet. Each absence is
// a missing capability, not a missing button — there is nothing to wire.
//
// WHY IT COLLAPSES. The web's Toolbar already has a `collapsible` mode for
// narrow screens, and its reasoning applies here with more force: this map is
// the whole screen, and six controls parked over it cover the ground the user is
// trying to look at. So the default is one pencil, and the row appears when it
// is tapped — the same behaviour, arrived at for the same reason, and the state
// lives here rather than in the screen because nothing outside cares.

import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import type { Mode } from '@fjellrute/core/types';
import { useT } from '@fjellrute/core/i18n';
import { EraserIcon, PencilIcon, TrashIcon, UndoIcon } from './icons';
import { colors, fontSize, radius, shadow, space, TOUCH_TARGET } from './theme';

/** Side of a round tool button. TOUCH_TARGET, not a smaller number that looks
 *  tidier: these sit over a map, so a miss does not merely do nothing — it
 *  lands on the tool underneath or, worse, on the drawing surface. */
const BUTTON = TOUCH_TARGET;

interface Props {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  /** True while there is any drawn geometry — erase and clear have nothing to
   *  act on without it. */
  hasRoute: boolean;
  /** True while there is an edit to step back through. */
  canUndo: boolean;
  onUndo: () => void;
  onClear: () => void;
  /** Whether the toolbar is expanded, and the setter. Owned by the screen
   *  because the map needs the same answer: its own pan gesture stays on while
   *  the toolbar is shut, and a second copy of "is the user editing" would be
   *  the kind of state that gets out of step. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra positioning from the screen, which knows about the safe area. */
  style?: ViewStyle;
}

export function EditToolbar({
  mode,
  onModeChange,
  hasRoute,
  canUndo,
  onUndo,
  onClear,
  open,
  onOpenChange,
  style,
}: Props) {
  const t = useT();

  // Collapsed: one button, wearing the active tool's own icon. The web's
  // collapsed FAB does the same, and for the same reason — with the row hidden,
  // this glyph is the only thing on screen that says a tool is in hand, and a
  // map that has quietly stopped panning needs to say why.
  if (!open) {
    const ActiveIcon = mode === 'erase' ? EraserIcon : PencilIcon;
    return (
      <View style={[styles.bar, style]}>
        <ToolButton
          label={t('Rediger rute', 'Edit route')}
          active={mode !== 'idle'}
          onPress={() => onOpenChange(true)}
        >
          {(color) => <ActiveIcon color={color} />}
        </ToolButton>
      </View>
    );
  }

  // Picking a tool folds the row back down, so the map is uncovered for the
  // stroke that follows. Tapping the tool that is already active puts it down
  // instead of re-selecting it, which is the web's toggle behaviour and the
  // only way back to a map that pans.
  const choose = (target: Mode) => {
    onModeChange(mode === target ? 'idle' : target);
    onOpenChange(false);
  };

  return (
    <View style={[styles.bar, style]}>
      <ToolButton
        label={t('Tegn', 'Draw')}
        hint={t('Tegn rute (frihånd)', 'Draw route (freehand)')}
        active={mode === 'draw'}
        onPress={() => choose('draw')}
      >
        {(color) => <PencilIcon color={color} />}
      </ToolButton>

      <ToolButton
        label={t('Slett', 'Erase')}
        hint={t('Slett deler av ruta', 'Erase parts of the route')}
        active={mode === 'erase'}
        disabled={!hasRoute}
        onPress={() => choose('erase')}
      >
        {(color) => <EraserIcon color={color} />}
      </ToolButton>

      <ToolButton
        label={t('Angre', 'Undo')}
        disabled={!canUndo}
        // Undo does NOT collapse the row: undoing once often means undoing
        // twice, and a button that hides itself after one press makes the
        // second press a two-step operation.
        onPress={onUndo}
      >
        {(color) => <UndoIcon color={color} />}
      </ToolButton>

      <ToolButton
        label={t('Fjern alt', 'Clear all')}
        hint={t('Fjern hele ruta', 'Clear the entire route')}
        disabled={!hasRoute}
        danger
        onPress={() => {
          onClear();
          onOpenChange(false);
        }}
      >
        {(color) => <TrashIcon color={color} />}
      </ToolButton>

      <ToolButton
        label={t('Skjul redigeringsverktøy', 'Hide editing tools')}
        onPress={() => onOpenChange(false)}
      >
        {() => <Text style={styles.closeGlyph}>×</Text>}
      </ToolButton>
    </View>
  );
}

interface ToolButtonProps {
  label: string;
  /** The longer sentence the web puts in a `title` tooltip. A phone has no
   *  hover, so it becomes the accessibility hint — read after the label, by
   *  users who asked for it. */
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onPress: () => void;
  /** The glyph, as a function of the colour it has to be drawn in. Icons take
   *  their colour as a required prop on this platform (see icons.tsx), and only
   *  this component knows whether the button is filled, plain or dimmed. */
  children: (color: string) => ReactNode;
}

function ToolButton({
  label,
  hint,
  active = false,
  disabled = false,
  danger = false,
  onPress,
  children,
}: ToolButtonProps) {
  const color = disabled
    ? colors.textFaint
    : active
      ? colors.accentContrast
      : danger
        ? colors.danger
        : colors.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        active && styles.buttonActive,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      // Both, deliberately: `selected` is what a screen reader announces for a
      // tool that is in hand, and `disabled` is why nothing happened.
      accessibilityState={{ selected: active, disabled }}
    >
      {children(color)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A column, not a row. The web's toolbar is a vertical stack at the top-left
  // of the map and this is the same stack; a horizontal row would also collide
  // with the steepness pill, which already owns that corner's first line.
  bar: {
    position: 'absolute',
    left: space.s4,
    flexDirection: 'column',
    gap: space.s2,
  },
  button: {
    width: BUTTON,
    height: BUTTON,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    // Same token as the steepness pill: without a shadow, white chrome
    // disappears against a snowfield on the topo map.
    ...shadow.level2,
  },
  buttonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  buttonPressed: { opacity: 0.8 },
  // Dimmed rather than hidden. A tool that vanishes when it has nothing to act
  // on makes the row jump under the finger; a dimmed one keeps its place and
  // says the route is empty.
  buttonDisabled: { opacity: 0.55 },
  closeGlyph: {
    fontSize: fontSize.lg,
    lineHeight: fontSize.lg + 2,
    color: colors.text,
  },
});
