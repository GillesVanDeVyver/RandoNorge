// Which backend this build of the app talks to. The single place that decides.
//
// WHY THIS FILE EXISTS AT ALL. On the web every request is same-origin: the
// same Worker serves the JS and answers /api/*, so a path is a complete
// address. React Native has no origin — `fetch('/api/routes')` throws
// "Only absolute URLs are supported" — so every request needs a host prefixed
// onto it, and something has to choose the host. Doing that at each call site
// is how you end up with a production URL hard-coded in one screen and a laptop
// IP in another. So: one constant here, installed once at startup into
// @fjellrute/core's net/base adapter, and nothing else in the app ever writes a
// host.
//
// TWO TARGETS, AND WHY THE DEFAULT IS THE LAPTOP.
//
//   LAN         `wrangler dev` on your machine, reached over Wi-Fi.
//   PRODUCTION  https://fjellrute.no, the deployed Worker.
//
// Development defaults to LAN because that is the loop that tells you
// something: a test signup lands in the local D1 copy instead of the real
// database, the Worker's log is in front of you while the phone is hitting it,
// and a change to worker/routes.js is live on the next request rather than
// after a deploy. Production is one edit away for when you want to check the
// real thing — or when you are away from the laptop.
//
// SETTING THE LAN ADDRESS. `localhost` on the phone means the phone, so it has
// to be your machine's address on the Wi-Fi network:
//
//   macOS   ipconfig getifaddr en0
//   Linux   hostname -I | awk '{print $1}'
//
// and wrangler has to be listening on more than loopback, or the phone's
// connection is refused with nothing in the log:
//
//   npx wrangler dev --ip 0.0.0.0 --port 8787
//
// Phone and laptop must be on the same network, and some guest/corporate Wi-Fi
// blocks device-to-device traffic entirely — if the request times out with no
// entry in the Worker log, suspect that before suspecting the code.

import Constants from 'expo-constants';

/** Where the deployed Worker lives. Also the host in app.json's associated domains, when there are any. */
const PRODUCTION_API = 'https://fjellrute.no';

/**
 * Your machine's address on the local network, with the port `wrangler dev`
 * serves on. EDIT THIS to match your laptop; the placeholder is a common
 * default and is almost certainly not you.
 */
const LAN_API = 'http://192.168.1.10:8787';

/**
 * Flip to 'production' to point a development build at the deployed Worker
 * without rebuilding it — this is plain JS, so it reloads.
 *
 * Release builds ignore this: see `resolveApiBase` below. That asymmetry is
 * deliberate. A `__DEV__`-only switch cannot be the thing that accidentally
 * ships a store build aimed at a laptop IP.
 */
const DEVELOPMENT_TARGET: 'lan' | 'production' = 'lan';

/**
 * Metro's own address, as reported by the development client that loaded this
 * bundle — e.g. "192.168.1.10:8081". Used only as a fallback host, on the
 * reasoning that the machine serving the JS is the machine running `wrangler
 * dev`. It saves editing LAN_API in the common case, but it is a guess about
 * your setup, so an explicit LAN_API always wins.
 */
function metroHost(): string | null {
  const url = Constants.expoConfig?.hostUri ?? null;
  if (!url) return null;
  const host = url.split(':')[0];
  return host ? host : null;
}

function resolveApiBase(): string {
  // A release build talks to production, full stop. No debug flag, no
  // network-derived host: both are ways for a shipped app to point somewhere
  // that only existed on a developer's desk.
  if (!__DEV__) return PRODUCTION_API;

  if (DEVELOPMENT_TARGET === 'production') return PRODUCTION_API;

  // An explicitly edited LAN_API is authoritative. Only when it is still the
  // untouched placeholder do we fall back to inferring the host from Metro.
  if (LAN_API !== 'http://192.168.1.10:8787') return LAN_API;
  const inferred = metroHost();
  return inferred ? `http://${inferred}:8787` : LAN_API;
}

/** The host every request in this app is made against. No trailing slash. */
export const API_BASE = resolveApiBase();

/** True when this build is talking to a machine on the local network. Screens use it to say so on-screen, so a confusing empty list is attributable. */
export const IS_LOCAL_API = API_BASE !== PRODUCTION_API;
