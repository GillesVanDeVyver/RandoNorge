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
// THREE TARGETS.
//
//   LAN         `wrangler dev` on your machine, reached over Wi-Fi.
//   DEV_WORKER  fjellrute-dev.<subdomain>.workers.dev — the deployed dev
//               Worker (wrangler.jsonc, env.dev). Its own D1 database, so a
//               throwaway signup from the phone stays out of the real one.
//   PRODUCTION  https://fjellrute.no, the Worker holding real accounts.
//
// WHY THE DEFAULT IS THE DEV WORKER AND NOT THE LAPTOP. LAN is the better loop
// when it works — the Worker's log is in front of you while the phone hits it,
// and an edit to worker/routes.js is live on the next request instead of after
// a deploy. But it only works when the phone and the laptop share a network
// that permits device-to-device traffic, and that assumption failed on the
// first real attempt: the phone was on LTE with Wi-Fi off, so the LAN address
// was simply unroutable (ENETUNREACH), and before that the host inferred from a
// USB-tunnelled Metro was 127.0.0.1 — which on a phone means the phone. Neither
// is a code problem, and neither is visible from the laptop. The dev Worker has
// no such precondition: it is on the internet, so it answers from a train.
//
// Switch to 'lan' when you are actively changing worker/ and want the fast
// loop, and to 'production' only to confirm the real thing behaves — never as
// somewhere to create test accounts.
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
 * The deployed DEV Worker — `env.dev` in wrangler.jsonc, published with
 * `npx wrangler deploy --env dev`. Same code as production, different D1
 * database, so accounts made from the phone are throwaway.
 *
 * The hostname is `<worker name>.<your workers.dev subdomain>`, and both halves
 * are already determined: the Worker is named `fjellrute-dev` in wrangler.jsonc,
 * and the subdomain is the account's, the same one production's
 * `fjellrute.<subdomain>.workers.dev` uses. It is spelled out rather than built
 * from parts because nothing in a React Native bundle can read wrangler.jsonc;
 * scripts/verify-mobile-app.mjs compares this string to that file instead.
 *
 * If `wrangler deploy --env dev` prints a different URL than this, believe
 * wrangler and change this line.
 */
const DEV_WORKER_API = 'https://fjellrute-dev.gillesvandevyver1.workers.dev';

/**
 * Your machine's address on the local network, with the port `wrangler dev`
 * serves on. EDIT THIS to match your laptop; the placeholder is a common
 * default and is almost certainly not you.
 */
const LAN_API = 'http://192.168.1.10:8787';

/**
 * Which of the three a development build talks to. This is plain JS, so a change
 * here reloads — no rebuild.
 *
 * Release builds ignore it entirely: see `resolveApiBase` below. That asymmetry
 * is deliberate. A `__DEV__`-only switch cannot be the thing that accidentally
 * ships a store build aimed at a laptop IP or at a database full of test data.
 */
const DEVELOPMENT_TARGET: 'lan' | 'dev-worker' | 'production' = 'dev-worker';

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

/** Which target was chosen, alongside its address. The two are returned together because callers below need to distinguish "not production" from "on this Wi-Fi", and those stopped being the same question when the dev Worker was added. */
type Resolved = { base: string; kind: 'production' | 'dev-worker' | 'lan' };

function resolveApiBase(): Resolved {
  // A release build talks to production, full stop. No debug flag, no
  // network-derived host: both are ways for a shipped app to point somewhere
  // that only existed on a developer's desk.
  if (!__DEV__) return { base: PRODUCTION_API, kind: 'production' };

  if (DEVELOPMENT_TARGET === 'production') return { base: PRODUCTION_API, kind: 'production' };
  if (DEVELOPMENT_TARGET === 'dev-worker') return { base: DEV_WORKER_API, kind: 'dev-worker' };

  // An explicitly edited LAN_API is authoritative. Only when it is still the
  // untouched placeholder do we fall back to inferring the host from Metro.
  if (LAN_API !== 'http://192.168.1.10:8787') return { base: LAN_API, kind: 'lan' };
  const inferred = metroHost();
  return { base: inferred ? `http://${inferred}:8787` : LAN_API, kind: 'lan' };
}

const resolved = resolveApiBase();

/** The host every request in this app is made against. No trailing slash. */
export const API_BASE = resolved.base;

/**
 * True only when the backend is a `wrangler dev` on this network. Screens use it
 * to add "check that wrangler is running and listening on 0.0.0.0" to a network
 * error.
 *
 * NOT the same as "is not production", though it used to be defined that way —
 * `API_BASE !== PRODUCTION_API` — and that definition quietly became wrong when
 * DEV_WORKER_API arrived: a failed request to a deployed Worker would have been
 * answered with advice to go start wrangler, which is a laptop that has nothing
 * to do with it. Wrong advice on an error screen costs more than no advice,
 * because it is followed. Use IS_PRODUCTION_API for "should I show which backend
 * this is".
 */
export const IS_LOCAL_API = resolved.kind === 'lan';

/** True when this build talks to the Worker holding real accounts. Its negation is the condition for showing the backend on screen at all: any other target can produce a confusing empty list, and naming the host makes that attributable. */
export const IS_PRODUCTION_API = resolved.kind === 'production';
