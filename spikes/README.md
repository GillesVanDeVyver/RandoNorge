# Phase 0 spikes — throwaway, on purpose

These two apps exist to answer one question each, on real phones, before any
mobile code is written that depends on the answer. Neither is meant to ship, be
tested, be linted or be kept in step with the rest of the repo. They are
deliberately outside the pnpm workspace (`pnpm-workspace.yaml` lists only
`apps/*` and `packages/*`), so a root `pnpm install` neither installs Expo nor
notices these directories at all.

| Spike | Question | Kills | Answer goes in |
| --- | --- | --- | --- |
| `webview-3d/` | Does MapLibre GL JS in a WebView hold up on a cheap Android? | Phase 6, and the whole 3D-on-mobile approach | `webview-3d/RESULTS.md` |
| `background-location/` | Does free `expo-location` background recording survive a real tour? | Phase 4, or costs money to fix | `background-location/RESULTS.md` |

Both scaffold themselves with `create-expo-app` (`./setup.sh`). The part worth
keeping is `template/App.tsx` in each — that is the actual spike; the scaffold
around it is disposable and git-ignored.

## Both need a development build, not Expo Go

Neither spike runs in Expo Go, and both `setup.sh` scripts now build a
development build (`npx expo run:android`). For 0b that was always true —
background location needs entitlements Expo Go does not have, and Expo Go would
grant foreground permission and then record nothing, which is a false FAIL.

For 0a it was learned on 2026-08-24, and the lesson generalises. Expo Go looked
free: `react-native-webview` is bundled in it, so no Android SDK and no build.
But Expo Go only loads the single SDK currently shipped to the app stores, and
`create-expo-app@latest` scaffolds the next one, so the phone refused the project
with "incompatible with this version of Expo Go — download the latest version of
Expo Go", which cannot help when Expo Go is already current and the project is
too new. Pinning the SDK to the version Expo Go was *assumed* to support failed
in exactly the same way, because the assumption was inferred from the changelog
rather than read off the device.

The general shape: **Expo Go's SDK is a moving ceiling set by two release trains
you do not control, so anything that must run for months without maintenance
should not depend on it.** A development build compiles the SDK in and has no
ceiling. The Android SDK install it costs is a one-off, and 0b needs it anyway.

One consequence worth keeping: because 0a no longer has a ceiling, it also no
longer has to sit on SDK 56, which shipped a Hermes memory regression
([expo/expo#46519](https://github.com/expo/expo/issues/46519), arrived with
React Native 0.85, fixed in `expo@57.0.9` / RN 0.86.2). Both scripts stay on the
latest SDK for that reason — a memory bug is the last thing you want under a
performance spike on a cheap phone or a multi-hour background recording.
`webview-3d/setup.sh` enforces a floor (`MIN_EXPO_MAJOR`) rather than a pin.

The third Phase 0 item is not code: send the Kartverket letter
(`docs/kartverket-tile-cache-permission-request.md`) and log the date in
`docs/kartverket-permission-log.md`. It gates offline maps at z11 until it is
answered, and the reply time is outside our control, which is exactly why it
belongs at the very start.

## When these are done

Write the answer down in each `RESULTS.md`, even — especially — if the answer is
"no". A spike that is run but not recorded gets re-run in three months by
someone who no longer remembers which phone stuttered. Then delete the `app/`
scaffolds; the results outlive the code.
