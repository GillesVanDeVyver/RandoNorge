// Spike 0b — does free background location survive a real tour?
//
// THE QUESTION. Phase 4 records a tour with the screen off and the phone in a
// pocket for hours. `expo-location` plus `expo-task-manager` can do this for
// nothing; `react-native-background-geolocation` does it reliably for money.
// Which one Phase 4 needs is not a code question, it is an empirical one about
// Samsung's and Xiaomi's battery managers, and it can only be answered by
// walking around for six hours.
//
// WHY IT WRITES A FILE AND NOT A LOG. The failure this is hunting for is a gap:
// the OS quietly stopping the task for forty minutes on a hillside. A console
// log cannot be read from a pocket and is gone when the app is killed, which is
// precisely the event worth measuring. So every fix is appended to a JSON file
// on the device as it arrives, the file survives the app being killed, and
// `analyse.mjs` finds the gaps afterwards rather than trusting anyone's memory
// of when the screen was last checked.
//
// WHY BATTERY IS SAMPLED HERE TOO. "It worked" is only half an answer: a
// recording that costs 25%/hour is unusable on a tour whatever its fix rate. The
// battery level is stamped on every fix, so cost per hour falls out of the same
// file, with no separate note-taking.
//
// WHAT MAKES A GAP REAL. A stationary phone legitimately produces fewer fixes,
// so `distanceInterval` is set to 0 and `timeInterval` drives the schedule: the
// recorder is asked for a fix every 10 seconds whether or not you moved, and
// anything longer than a minute between fixes is the OS interfering. That is the
// signal. It costs more battery than a production recorder would use, which is
// the right trade for a measurement.

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
// Expo reworked this module's API mid-SDK-54 and kept the old one at
// 'expo-file-system/legacy'. If `documentDirectory` is undefined on the SDK the
// scaffold picked, switch this import to the legacy path — the spike wants the
// simplest possible file write, not the current API.
import * as FileSystem from 'expo-file-system';
import * as Battery from 'expo-battery';
import * as Sharing from 'expo-sharing';

const TASK = 'fjellrute-spike-recording';
const LOG = `${FileSystem.documentDirectory}spike-fixes.jsonl`;

// One line of JSON per fix. JSONL rather than a JSON array so an append is a
// single write with no read-modify-write, and so a recording killed mid-write
// loses one line instead of the file.
async function append(line: Record<string, unknown>): Promise<void> {
  const text = `${JSON.stringify(line)}\n`;
  const existing = await FileSystem.getInfoAsync(LOG);
  if (!existing.exists) {
    await FileSystem.writeAsStringAsync(LOG, text);
    return;
  }
  // Expo's FileSystem has no append, so read-and-rewrite is the portable way.
  // At one line per 10 s a six-hour recording is ~2,200 lines, small enough that
  // this is cheap; a production recorder would batch into SQLite instead.
  const prev = await FileSystem.readAsStringAsync(LOG);
  await FileSystem.writeAsStringAsync(LOG, prev + text);
}

// The task must be defined at module scope, before React renders: after a
// process death the OS restarts the app headless and only this registration
// exists. Defining it inside a component would mean the restarted process has
// no task to run, which looks exactly like a battery-manager gap and would send
// you chasing the wrong cause.
TaskManager.defineTask(TASK, async ({ data, error }) => {
  if (error) {
    await append({ t: Date.now(), kind: 'error', message: error.message });
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] } | null)
    ?.locations;
  if (!locations?.length) return;
  let battery: number | null = null;
  try {
    battery = await Battery.getBatteryLevelAsync();
  } catch {
    battery = null;
  }
  for (const l of locations) {
    await append({
      t: l.timestamp,
      kind: 'fix',
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      acc: l.coords.accuracy,
      alt: l.coords.altitude,
      speed: l.coords.speed,
      battery,
      received: Date.now(),
    });
  }
});

export default function App() {
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState(0);
  const [battery, setBattery] = useState<number | null>(null);
  const [note, setNote] = useState<string>('');
  // Seconds since the last fix, computed when the file is read rather than
  // during render: a clock read while rendering makes the number depend on when
  // React happened to re-render, which is exactly the reading you would not want
  // to trust when it says "GAP".
  const [sinceLast, setSinceLast] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setRunning(await Location.hasStartedLocationUpdatesAsync(TASK));
    const info = await FileSystem.getInfoAsync(LOG);
    if (!info.exists) {
      setLines(0);
      setSinceLast(null);
      return;
    }
    const text = await FileSystem.readAsStringAsync(LOG);
    const rows = text.trim().split('\n').filter(Boolean);
    setLines(rows.length);
    const lastRow = rows[rows.length - 1];
    try {
      const t = (JSON.parse(lastRow) as { t: number }).t;
      setSinceLast(Math.round((Date.now() - t) / 1000));
    } catch {
      setSinceLast(null);
    }
    try {
      setBattery(await Battery.getBatteryLevelAsync());
    } catch {
      setBattery(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const start = useCallback(async () => {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      Alert.alert('Foreground location denied');
      return;
    }
    // Background permission must be asked for separately and, on Android 11+,
    // only after foreground has been granted. A recorder that skips this appears
    // to work until the screen locks.
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') {
      Alert.alert(
        'Background location denied',
        'On Android choose "Allow all the time". Without it this spike measures nothing.',
      );
      return;
    }
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 10_000,
      distanceInterval: 0,
      // Batching would hide gaps: fixes deferred by the OS and delivered
      // together look like a stall that resolved itself. Ask for them as they
      // happen so the file records when the OS actually produced each one.
      deferredUpdatesInterval: 0,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Fitness,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Fjellrute spike is recording',
        notificationBody: 'Tap to see fix count. Keep this running.',
        notificationColor: '#2b6cb0',
        // A sticky notification is what buys survival on Android. If the OEM
        // kills the task anyway, that is the finding.
        killServiceOnDestroy: false,
      },
    });
    setNote(`started ${new Date().toLocaleTimeString()}`);
    await refresh();
  }, [refresh]);

  const stop = useCallback(async () => {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) {
      await Location.stopLocationUpdatesAsync(TASK);
    }
    setNote(`stopped ${new Date().toLocaleTimeString()}`);
    await refresh();
  }, [refresh]);

  const share = useCallback(async () => {
    const info = await FileSystem.getInfoAsync(LOG);
    if (!info.exists) {
      Alert.alert('Nothing recorded yet');
      return;
    }
    // AirDrop / Files / Drive — anything that gets the file onto the machine
    // running analyse.mjs.
    await Sharing.shareAsync(LOG, { mimeType: 'application/json' });
  }, []);

  const clear = useCallback(async () => {
    await FileSystem.deleteAsync(LOG, { idempotent: true });
    setNote('cleared');
    await refresh();
  }, [refresh]);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.h1}>Background recording spike</Text>
        <Text style={styles.p}>
          {Platform.OS} · task {running ? 'RUNNING' : 'stopped'}
        </Text>

        <View style={styles.card}>
          <Text style={styles.big}>{lines}</Text>
          <Text style={styles.label}>fixes on disk</Text>
          <Text style={styles.p}>
            last fix{' '}
            {sinceLast === null
              ? '—'
              : `${sinceLast} s ago${sinceLast > 60 ? '  ← GAP' : ''}`}
          </Text>
          <Text style={styles.p}>
            battery {battery === null ? '—' : `${Math.round(battery * 100)}%`}
          </Text>
        </View>

        <View style={styles.row}>
          <Pressable
            style={[styles.button, running && styles.buttonOff]}
            onPress={() => void (running ? stop() : start())}
          >
            <Text style={styles.buttonText}>{running ? 'Stop' : 'Start'}</Text>
          </Pressable>
          <Pressable style={styles.buttonAlt} onPress={() => void share()}>
            <Text style={styles.buttonText}>Export</Text>
          </Pressable>
          <Pressable style={styles.buttonAlt} onPress={() => void clear()}>
            <Text style={styles.buttonText}>Clear</Text>
          </Pressable>
        </View>

        {note ? <Text style={styles.note}>{note}</Text> : null}

        <Text style={styles.help}>
          Start it, note the battery percentage, lock the screen, put the phone in
          a pocket and walk. Do not open the app again until you are back — every
          check re-foregrounds it and can revive a task the OS had killed, which
          is the one thing that would falsify the result.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1018' },
  body: { padding: 16, gap: 12 },
  h1: { color: '#e7ecf3', fontSize: 20, fontWeight: '700' },
  p: { color: '#9fb0c6', fontSize: 13 },
  card: {
    backgroundColor: '#161d29',
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  big: {
    color: '#e7ecf3',
    fontSize: 40,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  label: { color: '#5b6472', fontSize: 12, textTransform: 'uppercase' },
  row: { flexDirection: 'row', gap: 8 },
  button: {
    flex: 1,
    backgroundColor: '#2b6cb0',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonOff: { backgroundColor: '#a33' },
  buttonAlt: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a3341',
  },
  buttonText: { color: '#e7ecf3', fontWeight: '600' },
  note: { color: '#7f8c9f', fontSize: 12 },
  help: { color: '#7f8c9f', fontSize: 12, lineHeight: 18, marginTop: 8 },
});
