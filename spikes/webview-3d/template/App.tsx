// Spike 0a — MapLibre GL JS inside a WebView, on a real phone.
//
// THE QUESTION. Phase 6 of the mobile build plan runs the existing Map3DView
// inside react-native-webview rather than rewriting it, because MapLibre Native
// has no terrain support (the gap is in its C++ core, so Flutter and every other
// binding hit the same wall). That plan is only sound if a draped raster over a
// terrain mesh actually renders acceptably in a WebView on the cheap Android
// phones this audience carries. If it does not, Phase 6 is wrong and it is worth
// hundreds of hours to know that today.
//
// WHY THERE IS A FRAME METER RATHER THAN JUST EYES. "Feels a bit laggy" is not a
// finding you can compare between two phones a week apart, and it is not a
// finding you can defend to yourself later when you would rather the answer were
// yes. So the page is instrumented from the outside: injected JavaScript times
// every animation frame and reports, once a second, the median frame and the
// worst frame in that second. The worst frame is the honest number — a terrain
// pan that averages 45 fps but drops single 400 ms frames reads as broken to a
// user, and an average would hide exactly that.
//
// The HUD is drawn by React Native, not by the page, so it keeps updating even
// when the WebGL canvas has stalled. A HUD inside the page would freeze
// alongside the thing it is measuring, which is the one moment its reading
// matters.
//
// WHAT THIS DOES NOT DO. It does not log in for you, and it deliberately holds
// no credentials. Point it at a public share URL if you have one, otherwise sign
// in through the WebView once — the session cookie survives inside the app.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

// Presets, in the order you are likely to want them. The planner needs a login;
// a public share URL does not, which makes it the fastest way onto a borrowed
// phone. The LAN entry is for an unreleased change: run `pnpm dev --host` and
// put your machine's address in.
const PRESETS: { label: string; url: string }[] = [
  { label: 'prod planner', url: 'https://fjellrute.no/alpha/planner' },
  { label: 'prod share', url: 'https://fjellrute.no/u/' },
  { label: 'LAN dev', url: 'http://192.168.1.10:5173/alpha/planner' },
];

// Frame timings are reported per second rather than per frame: a postMessage per
// frame would itself cost frames on the phones this is meant to expose.
const FRAME_PROBE = `
(function () {
  if (window.__fjellruteFrameProbe) return;
  window.__fjellruteFrameProbe = true;
  var frames = [];
  var last = performance.now();
  var reportedAt = last;
  function send(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }
  send({ type: 'hello', ua: navigator.userAgent, dpr: window.devicePixelRatio });
  // A canvas that reports no WebGL context at all is a different failure from a
  // slow one, and worth telling apart before blaming the phone's GPU.
  try {
    var probe = document.createElement('canvas').getContext('webgl2')
      || document.createElement('canvas').getContext('webgl');
    send({ type: 'webgl', ok: !!probe });
  } catch (e) {
    send({ type: 'webgl', ok: false, error: String(e) });
  }
  function tick(now) {
    frames.push(now - last);
    last = now;
    if (now - reportedAt >= 1000) {
      frames.sort(function (a, b) { return a - b; });
      send({
        type: 'frames',
        count: frames.length,
        median: frames[Math.floor(frames.length / 2)] || 0,
        worst: frames[frames.length - 1] || 0,
      });
      frames = [];
      reportedAt = now;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
true;
`;

interface Sample {
  count: number;
  median: number;
  worst: number;
}

export default function App() {
  const [url, setUrl] = useState(PRESETS[0].url);
  const [draft, setDraft] = useState(PRESETS[0].url);
  const [sample, setSample] = useState<Sample | null>(null);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [ua, setUa] = useState<string | null>(null);
  // The running worst frame since the last reset. Kept in a ref as well as in
  // state so a burst of messages cannot lose one to a stale closure.
  const worstRef = useRef(0);
  const [worstEver, setWorstEver] = useState(0);
  const [key, setKey] = useState(0);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(event.nativeEvent.data) as Record<string, unknown>;
    } catch {
      return; // The page's own postMessage traffic, not ours.
    }
    if (payload.type === 'frames') {
      const next = payload as unknown as Sample;
      setSample(next);
      if (next.worst > worstRef.current) {
        worstRef.current = next.worst;
        setWorstEver(next.worst);
      }
    } else if (payload.type === 'webgl') {
      setWebgl(Boolean(payload.ok));
    } else if (payload.type === 'hello') {
      setUa(String(payload.ua ?? ''));
    }
  }, []);

  const reset = useCallback(() => {
    worstRef.current = 0;
    setWorstEver(0);
    setSample(null);
  }, []);

  const reload = useCallback(() => {
    reset();
    setWebgl(null);
    setKey((k) => k + 1);
  }, [reset]);

  const fps = useMemo(() => {
    if (!sample || sample.median <= 0) return null;
    return Math.round(1000 / sample.median);
  }, [sample]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.bar}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://…"
          placeholderTextColor="#5b6472"
          onSubmitEditing={() => {
            setUrl(draft.trim());
            reload();
          }}
        />
        <Pressable
          style={styles.button}
          onPress={() => {
            setUrl(draft.trim());
            reload();
          }}
        >
          <Text style={styles.buttonText}>Go</Text>
        </Pressable>
      </View>

      <View style={styles.presets}>
        {PRESETS.map((p) => (
          <Pressable
            key={p.label}
            style={styles.preset}
            onPress={() => {
              setDraft(p.url);
              setUrl(p.url);
              reload();
            }}
          >
            <Text style={styles.presetText}>{p.label}</Text>
          </Pressable>
        ))}
        <Pressable style={styles.preset} onPress={reset}>
          <Text style={styles.presetText}>reset meter</Text>
        </Pressable>
      </View>

      <View style={styles.webviewWrap}>
        <WebView
          key={`${url}#${key}`}
          source={{ uri: url }}
          injectedJavaScript={FRAME_PROBE}
          onMessage={onMessage}
          // Terrain is WebGL, and WebGL in a WebView needs hardware
          // acceleration and, on Android, a real GPU process. These are the
          // settings a production WebView screen would need too, so measuring
          // without them would measure the wrong app.
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          setSupportMultipleWindows={false}
          originWhitelist={['https://*', 'http://*']}
          // Geolocation inside the WebView is how the 3D view knows where you
          // are. Phase 6 replaces this with a position pushed in from native,
          // but for the spike the page's own request is the shortest path.
          geolocationEnabled
          style={styles.webview}
        />
        <View style={styles.hud} pointerEvents="none">
          <Text style={styles.hudBig}>{fps === null ? '—' : `${fps} fps`}</Text>
          <Text style={styles.hudLine}>
            median {sample ? sample.median.toFixed(1) : '—'} ms
          </Text>
          <Text style={styles.hudLine}>
            worst 1s {sample ? sample.worst.toFixed(0) : '—'} ms
          </Text>
          <Text style={[styles.hudLine, worstEver > 250 && styles.hudBad]}>
            worst ever {worstEver ? worstEver.toFixed(0) : '—'} ms
          </Text>
          <Text style={styles.hudLine}>
            webgl {webgl === null ? '—' : webgl ? 'yes' : 'NO'}
          </Text>
        </View>
      </View>

      <Text style={styles.foot} numberOfLines={2}>
        {Platform.OS} · {ua ?? 'waiting for the page'}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1018' },
  bar: { flexDirection: 'row', gap: 8, padding: 8 },
  input: {
    flex: 1,
    color: '#e7ecf3',
    backgroundColor: '#161d29',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  button: {
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#2b6cb0',
  },
  buttonText: { color: 'white', fontWeight: '600' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 8 },
  preset: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2a3341',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  presetText: { color: '#9fb0c6', fontSize: 12 },
  webviewWrap: { flex: 1, marginTop: 8 },
  webview: { flex: 1, backgroundColor: '#0b1018' },
  hud: {
    position: 'absolute',
    top: 10,
    left: 10,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(6,10,16,0.72)',
  },
  hudBig: { color: '#e7ecf3', fontSize: 20, fontWeight: '700' },
  hudLine: { color: '#9fb0c6', fontSize: 11, fontVariant: ['tabular-nums'] },
  hudBad: { color: '#ff8a80', fontWeight: '700' },
  foot: { color: '#5b6472', fontSize: 10, padding: 6 },
});
