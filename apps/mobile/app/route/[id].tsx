// `/route/:id` — one saved route, opened in the planner.
//
// EVERYTHING THIS SCREEN DOES IS IN src/ui/Planner.tsx, and that is the point.
// This file was the planner, all thirteen hundred lines of it, until `/planner`
// needed the same map, the same layer pill, the same pencil and eraser, the same
// elevation profile and the same forecast cards over an empty canvas. The choice
// then was a second copy or a shared component, and a second copy of a screen
// that size is a copy that stops matching the first time either half is touched.
//
// So the body moved out and both routes render it: `/planner` with
// `routeId={null}`, this one with the id from the URL. It is the shape the web
// already has — one App.tsx serving both, keyed on the route id — and it means
// "the planner" is one file to read and one file to change.
//
// WHAT IS LEFT HERE is the one thing a shared component cannot own: reading this
// route's parameter, and saying so when it is missing. Everything downstream
// (loading the route, the camera framing it, the unsaved-changes guard, the
// header title) belongs to the planner, because none of it differs between
// arriving here from the saved list and arriving from a deep link.

import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useT } from '@fjellrute/core/i18n';
import { Planner } from '../../src/ui/Planner';
import { colors, fontSize, space } from '../../src/ui/theme';

export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();

  // Reachable in practice: a deep link with a trailing slash, or a link built
  // from a route that was deleted between the list rendering and the tap. The
  // planner takes a `string`, so this is resolved before it is mounted rather
  // than inside it.
  if (!id) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>
          {t('Mangler tur-id.', 'Missing route id.')}
        </Text>
      </View>
    );
  }

  return <Planner routeId={id} />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.s6,
    gap: space.s4,
    backgroundColor: colors.background,
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
});
