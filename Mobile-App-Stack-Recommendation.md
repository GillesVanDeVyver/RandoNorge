# Fjellrute Mobile — Stack Recommendation

*Written 11 August 2026, based on a read of the current codebase at `src/` (26,124 lines TS/TSX/JS) and `worker/` (3,483 lines).*

## The recommendation

**React Native with Expo, written in TypeScript.** Same language, same React model, same team of one. MapLibre React Native for the map, `expo-location` plus a background task for GPS recording, and the existing Cloudflare Worker backend left completely untouched.

This is not the obvious answer for every web-app-goes-mobile project, but it is the right one for Fjellrute given the constraints you set: both platforms in the app stores, background GPS recording as a v1 must-have, 3D terrain in the app, the web app staying alive long-term, and Claude doing the bulk of the coding.

On 3D specifically: no cross-platform framework has native 3D terrain today, because the gap is in MapLibre Native's C++ core rather than in any language binding — Flutter hits exactly the same wall. The answer is a WebView screen running your existing `Map3DView.tsx`, backed by the same tile cache the native map uses. That section is below, and it's the part of this document worth reading most carefully.

## Why this fits what you've already built

The single most important fact about your codebase is that the backend doesn't move at all. All 3,483 lines in `worker/` — auth, routes, tracks, sharing, invites, rate limiting, policy acceptance, the MET/NVE proxies, the terrain-DEM endpoint — are just HTTP behind `/api/*`. A React Native app is another HTTP client. Two changes are needed: `baseURL` must be set explicitly (the web client relies on same-origin — see `src/auth/client.ts`, which passes no options at all), and the Worker currently sends no `Access-Control-Allow-Origin` headers anywhere, because until now every caller was same-origin. Both are configuration, not architecture.

Better Auth, which you're on at `^1.6.23`, ships an official Expo integration (`@better-auth/expo`, currently 1.6.26). It handles the part that usually hurts: cookie storage moves to `expo-secure-store`, OAuth flows run through the Expo system browser, and session reactivity works with React Native's lifecycle. Your `useSession`-based routing in `Root.tsx` translates almost directly. This one library alignment removes what is normally weeks of authentication rework.

On the frontend, I measured how much of `src/` is actually tied to the browser. Excluding anything that imports Leaflet, MapLibre GL JS, or touches `document`/`window`/`localStorage`/`indexedDB`:

**4,762 lines are pure TypeScript that move across essentially unchanged.** This is your real intellectual property — `geometry/` (Haversine, RDP simplification), the `routes/fit.ts` and `routes/tcx.ts` parsers and the GPX serialiser, `elevation/profile.ts` and `elevation/runout.ts`, `offline/tileMath.ts`, `offline/layers.ts`, `offline/maskGeometry.ts`, the API clients for avalanche, weather, snow, elevation and search, `terms/` content, and the `i18n` locale store. Roughly a hundred hours of careful work that you simply do not do again. The one caveat: a few of these files take browser `File` objects at their entry points (`importRouteFile`, `importGpxFile`), so file import needs a thin adapter over `expo-document-picker` — but the parsers underneath don't change.

**A further 2,788 lines are components whose logic ports but whose JSX and CSS Modules must be rewritten** — `AvalancheRisk.tsx`, `WeatherIcons.tsx`, `PacePanel.tsx`, `Toolbar.tsx`, `SnowDateBar.tsx` and similar. The data flow, the hooks, the conditional rendering rules all survive; `<div className={styles.x}>` becomes `<View style={styles.x}>`. This is mechanical work, which is exactly the kind of work Claude is fast and reliable at.

**15,091 lines across 51 files are genuinely coupled to Leaflet, MapLibre GL JS or the DOM** and get rewritten. That's the honest cost, and it's concentrated in a few large files: `DrawingHandler.tsx` (909 lines), `Map3DView.tsx` (1,272), `ProfilePanel.tsx` (1,285), `LoginPage.tsx` (1,309), `App.tsx` (1,529). The 8,038 lines of CSS Modules are discarded entirely.

So: about 7,500 lines of head start, 15,000 lines of rewrite, and a backend that doesn't move.

## The stack, concretely

Expo SDK 55 or later (React Native 0.83, React 19.2 — the same React version your web app already targets, so hooks and patterns match). Expo Router for navigation, since its file-based routing will feel familiar coming from your route structure. For the map, `@maplibre/maplibre-react-native`, which wraps MapLibre Native for both platforms and keeps you in the MapLibre style-spec world you already know from `Map3DView.tsx` and `offline/layers.ts`.

For GPS recording, `expo-location` with `expo-task-manager` gives you real background tracking: an Android foreground service with a persistent notification, and iOS background location modes declared in `app.json`. The tuning knobs you'll want — `pausesUpdatesAutomatically`, deferred updates, distance filters — map cleanly onto the gating logic already in `useTracking.ts` (your `MAX_ACCURACY_M`, `MIN_STEP_M`, `MAX_PLAUSIBLE_SPEED_MPS` thresholds carry over unchanged). If Expo's implementation proves flaky on specific Android OEMs — and aggressive battery killers on Samsung and Xiaomi are a real problem for a Norwegian ski-touring audience — the fallback is `react-native-background-geolocation` from Transistor Software, which is paid but is the most battle-hardened option in the ecosystem and is what most serious tracking apps use.

Styling: plain React Native `StyleSheet`, or NativeWind if you'd rather write Tailwind-ish classes. Either is fine; don't spend long on the decision.

## Two things that will actually be hard

(3D terrain is a third, and it gets its own section further down.)

**Your offline tile cache needs re-architecting.** `offline/db.ts` stores tile blobs in IndexedDB, which doesn't exist in React Native. Two options. The cleaner one for your case: keep your own downloader — the bbox/zoom/multi-layer/snow-date logic in `offline/download.ts` and `offline/tileMath.ts` is more sophisticated than what MapLibre's `OfflineManager` gives you — but write tiles into an MBTiles SQLite file via `expo-sqlite` and `expo-file-system`, then point a raster source at `mbtiles://<absolute-path>` in the style JSON. MapLibre React Native supports that scheme. The alternative is MapLibre's built-in `OfflineManager.createPack()`, which is less code but ties you to per-style bbox/zoom packs and gives you less control over your layered downloads. Your `RegionMeta` shape and the whole "downloaded areas" UI survive either way. Note that moving off IndexedDB onto the native filesystem is a genuine upgrade for field reliability — no browser storage eviction to worry about when you're four hours from the trailhead.

**Route drawing on a touchscreen is a different design problem, not a port.** `DrawingHandler.tsx` is 909 lines of mouse-oriented interaction: freehand strokes, a pixel-radius eraser, draggable vertices. On a phone there's no hover, fingers are ~44pt wide, and pan/zoom gestures compete with draw gestures. Don't port this file — redesign the interaction, then implement. The RDP simplification and the `Segment`/`Route` data model underneath it are untouched.

## Getting 3D terrain onto the phone

The constraint to internalise: **no cross-platform framework gives you native 3D terrain today, because the gap is in MapLibre Native's C++ core, not in any binding.** React Native, Flutter and Kotlin/Swift all sit on top of that same core and all lack it equally. MapLibre GL JS has had `setTerrain` since 2022; the native engine still doesn't. MapLibre's own roadmap lists Terrain3D under **Partially Funded**, a `feature/terrain-3d` branch exists, and the foundation has said it isn't funding the work directly but is looking for co-funding partners. There is no announced release date. So "which framework" is the wrong question for 3D — the right question is which of these four routes you take.

**Route 1 — a WebView screen for 3D, native for everything else. This is what I'd do.** `react-native-webview` runs WKWebView on iOS and Chromium's WebView on Android, both of which support WebGL. Your existing `Map3DView.tsx` runs inside it close to unchanged, which means the 1,272 lines you've already written keep earning. Crucially, 3D is a *planning* feature — you use it at the kitchen table or in the hut, upright, plugged in, for a few minutes at a time. It is not the six-hour-in-a-pocket screen. That usage pattern is exactly where a WebView is fine, and it leaves the safety-critical path (background recording, offline 2D map, live position) fully native.

The one piece of design work this needs is avoiding two separate tile caches. Don't let the WebView keep its own IndexedDB copy while the native side keeps MBTiles — users would download Jotunheimen twice. Instead run a tiny localhost HTTP tile server in the app, reading from the single MBTiles store, and have both consumers hit `http://127.0.0.1:<port>/<layer>/{z}/{x}/{y}`. The native 2D map points a raster source at it, and the WebView's MapLibre GL JS points at the same URL — which means `maplibreOffline.ts` gets *simpler*, since the custom `fjellrute-offline://` protocol collapses into a plain HTTP template. One downloader, one cache, two renderers. Worth noting that MapLibre React Native v11 overhauled its API specifically to align with MapLibre GL JS, so the 2D and 3D sides of your app will read more alike than they do today.

**Route 2 — Mapbox Maps SDK via `@rnmapbox/maps`.** This is the only mainstream option with real, shipping, native 3D terrain on both platforms, and it accepts custom raster sources plus `raster-dem` with `encoding: "terrarium"`, which is exactly what your `/terrain-dem` Worker route already serves. The problem is offline. Mapbox's offline tile store only accepts tile endpoints matching Mapbox's own v4 raster/vector or v1 raster-DEM URL schemas, so it will not manage your Kartverket or NVE tiles — you'd be building your own cache anyway, and then fighting the SDK to serve from it. Add MAU-based pricing on top of a product whose whole pitch is free-and-open Norwegian data, plus a proprietary dependency in an otherwise vendor-neutral stack. Given that offline is arguably your most important feature, I don't think this trade is worth it.

**Route 3 — co-fund Terrain3D in MapLibre Native.** The branch exists, the foundation is explicitly seeking co-funders, and you would get genuinely native 3D shared with the whole ecosystem. It's also unbounded in cost and timeline, and you cannot plan a launch around it. Worth an email to MapLibre to find out what the number and the timeline actually look like — if other backcountry and outdoor companies are circling the same gap, a shared cheque might be smaller than you'd expect. Treat it as a bet on 2027, not a v1 plan.

**Route 4 — Capacitor for the whole app.** If 3D is non-negotiable and you also want it *now*, this becomes much more attractive than it was before, because it gives you 3D and everything else for free. Read the paragraph below on why I'd still avoid it — but the gap between it and Route 1 has narrowed, since Route 1 also puts 3D in a WebView. The difference is that Route 1 keeps the recording path native and Capacitor doesn't, and for a backcountry safety app that's the distinction I'd protect.

## What I considered and rejected

**Capacitor** deserves a serious mention because it's the tempting answer: wrap your existing Vite build in a native WebView shell and ship it in weeks with near-100% code reuse, 3D terrain included. I'd steer away for two reasons specific to Fjellrute. First, this is a safety-adjacent app used in cold, no-signal terrain — a WebView backgrounded by iOS under memory pressure while you're recording a six-hour tour is a failure mode you don't want, and battery draw through a WebView is worse. Second, the app is gesture-heavy and map-heavy, which is precisely where WebView overhead is most visible. There's also a modest App Store review risk under Apple's minimum-functionality rule, though a feature-rich app like yours would very likely clear it. If your priority were "in the stores before the ski season regardless of ceiling," Capacitor would be the answer. Given the web app stays alive as the desktop planner, I don't think you need that shortcut.

**Flutter** does not solve the 3D problem, which is the main reason someone would reach for it here. `flutter-maplibre-gl` binds to the same MapLibre Native C++ core as the React Native package, so it inherits exactly the same gap: its documentation exposes `RasterDemSourceProperties` — the DEM *source*, which drives hillshade — but there is no terrain-mesh API, no `setTerrain`, no exaggeration control. Beware of summaries that conflate the two; a raster-DEM source is not 3D terrain. You would throw away 26,000 lines of TypeScript, learn Dart, and arrive at the same missing feature — and you'd solve it the same way, with a WebView. Flutter's binding is also less actively maintained than the React Native one, which just shipped a v11 API overhaul.

**Native Swift and Kotlin** gives the best possible result and means two separate codebases plus two languages, maintained by one person alongside a web app. For a solo founder this is how you end up shipping nothing. The one scenario where it wins is if native map performance turns out to be the entire product differentiator — and MapLibre Native under React Native is already native rendering, so you'd be paying a very high price for a small delta.

**A PWA** is ruled out by your own answer: background GPS with the screen off is exactly the thing a browser cannot do, especially on iOS. Worth noting the codebase currently has no service worker or web manifest at all, so this would also be net-new work rather than a small step.

## Suggested repository shape

Convert the repo to a pnpm workspace — you're already on pnpm 10 with `only-allow` enforcement, so this is a natural move:

```
packages/core/      the 4,762 portable lines: geometry, gpx/tcx/fit,
                    elevation, tile math, api clients, i18n, types
apps/web/           the existing Vite + React + Leaflet app
apps/mobile/        the new Expo app
worker/             unchanged
```

Extracting `packages/core` first, before any mobile code exists, is worth doing as a standalone step. It's low-risk, it's verifiable against your existing test scripts (`pnpm test`), and it means every subsequent bug fix in the FIT parser or the runout calculation lands in both apps at once. Given that you're keeping web and mobile alive together long-term, this shared package is what stops the two from drifting apart over the next few years.

## A rough sequence

Extract `packages/core` and confirm the web app still passes `pnpm test`. Then stand up a bare Expo app that authenticates against the existing Worker via `@better-auth/expo` and lists the user's saved routes — that proves the whole backend integration end to end with almost no UI. Then the 2D map with the Kartverket base layer and the steepness overlay, read-only. Then GPS recording with background tracking, which is the feature that justifies the app existing at all, and which needs the most real-world testing on actual hardware in actual terrain. Then offline downloads onto MBTiles. Then route drawing, redesigned for touch. Then the weather, avalanche and snow panels, which are largely a restyle of already-portable components. The 3D WebView screen comes last, because it depends on the localhost tile server, which depends on the MBTiles store existing.

Test background recording on a real Android device early. It's the single highest-risk item — OEM battery optimisation on Samsung and Xiaomi kills background services aggressively, and you will not discover this in a simulator.

## Open questions worth deciding before writing code

Whether the mobile app can create and edit routes in v1 or is initially a "plan on web, follow on phone" companion — the latter cuts the hardest 900 lines out of scope and would get you to the stores considerably faster. Whether 3D on the phone needs to work fully offline, or whether "3D needs signal, 2D always works" is an acceptable v1 limitation — that answer determines whether the localhost tile server is required up front or can wait. And whether you're willing to pay for `react-native-background-geolocation` up front rather than discovering `expo-location`'s limits after the fact.

One thing worth doing this week, before any of the above: build a throwaway Expo app with nothing in it but `react-native-webview` pointing at your existing 3D view on fjellrute, and open it on the oldest Android phone you can find. Terrain meshes plus draped raster over Norwegian relief is a heavy WebGL workload, and if it stutters badly on mid-range hardware, that single test invalidates Route 1 and reframes the whole decision. It's an afternoon's work to de-risk the biggest assumption in this document.
