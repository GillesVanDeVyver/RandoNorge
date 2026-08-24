# Spike 0a — MapLibre GL JS in a WebView

**Question.** Will the existing `Map3DView` — a terrain mesh with draped
Kartverket raster over Norwegian relief — render acceptably inside
`react-native-webview` on the phones this audience actually carries?

**Why it matters.** Phase 6 of the mobile plan reuses the 1,272 lines of
`Map3DView` in a WebView instead of rewriting them, because MapLibre Native has
no terrain and no binding fixes that. If a WebView cannot carry that workload,
Phase 6 is built on sand, and the honest options are shipping mobile without 3D
or paying for a native terrain renderer. Both are decisions to take now, not
after Phases 1–5.

## Run it

```sh
./setup.sh
cd app && npx expo run:android          # or: npx expo run:ios (needs Xcode)
```

This needs a **development build**, not Expo Go. `react-native-webview` is
bundled in Expo Go, so Expo Go looks like the cheap option and this spike was
written that way — but Expo Go only loads the one SDK currently shipped to the
app stores, and `create-expo-app` scaffolds the next one, so the phone refuses
the project with an error telling you to update an Expo Go that is already
current. Pinning the SDK to whatever Expo Go supports works right up until
either side ships. A development build compiles the SDK in and has no such
ceiling; `setup.sh` explains the whole detour at the top.

To measure several phones without plugging in each one, build a shareable APK:
`npx eas build --profile development --platform android`.

Three presets are wired into the app: the production planner (needs a login,
which the WebView will keep for the session), a public share URL, and a LAN
address for `pnpm dev --host` if you want an unreleased change under test. Edit
the LAN preset in `template/App.tsx` to your machine's address.

## Protocol

Do this identically on every phone, or the numbers cannot be compared.

1. Load the planner, sign in if asked, and open a route in **Jotunheimen** —
   the steepest relief the app will ever be asked to draw, and therefore the
   fair test. Galdhøpiggen or Store Skagastølstind.
2. Switch to 3D and wait for the terrain to settle. Tap **reset meter**; the
   load spike is not what we are measuring.
3. For two minutes, do only what a user does: drag to pan, two-finger drag to
   tilt, pinch to zoom, then follow the route from valley to summit.
4. Read the HUD. `median` is the typical frame; `worst ever` is the finding.
5. Repeat once with the phone warm (straight after step 3, no cooling) — thermal
   throttling on a cheap Android is the difference between a demo and a tour.

Record in `RESULTS.md`: device, Android/iOS version, price bracket, median fps,
worst frame, whether `webgl` said yes, whether it got hot, and one plain sentence
on whether a paying user would accept it.

## Reading the numbers

Frame time, not fps, is what a hand feels. Rough thresholds for a map you drag:

- **median under 33 ms** (30 fps) — acceptable for terrain on a budget phone.
- **worst frame over 250 ms** — reads as a stall, even if the median is fine.
  Occasional stalls during tile loads are tolerable; stalls while panning are not.
- **`webgl NO`** — a different failure entirely. The WebView has no GL context,
  which is a configuration or device-policy problem, not a performance one.
  Check hardware acceleration and whether the device is in a battery saver mode.

## Honest answer, written down

The point of the spike is a decision, so `RESULTS.md` must end with one of:

- **Yes** — Phase 6 proceeds as planned.
- **Yes, with limits** — e.g. cap the terrain exaggeration or the mesh zoom on
  low-end devices. Say which limit; it becomes a Phase 6 requirement.
- **No** — then Phase 6 changes shape before anything is built on it, and the
  mobile app ships 2D-only first. That is a perfectly good product; a stuttering
  3D screen is not.
