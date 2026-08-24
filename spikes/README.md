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

## The one difference between them: Expo Go

`webview-3d/setup.sh` **pins the Expo SDK** and `background-location/setup.sh`
deliberately does not. This is not an inconsistency to tidy up.

Spike 0a runs in Expo Go, which is the whole reason it is cheap — no Android
Studio, no Xcode, no build. But Expo Go can only open the SDK that is currently
in the app stores, so 0a is capped at that version, and `create-expo-app@latest`
is usually a version *ahead* of it. Leaving it unpinned looked like it avoided
an upgrade detour and in fact only moved the detour onto the phone, where the
error reads "Project is incompatible with this version of Expo Go" and helpfully
suggests updating Expo Go — which cannot work, because Expo Go was already
current and the project was too new. So 0a names the cap (`EXPO_SDK` at the top
of the script, currently 56, chosen 2026-08-24) and checks it on the laptop
before you pick up the phone.

Spike 0b cannot run in Expo Go at all — background location needs entitlements
only a development build has — so a development build compiles the SDK in and
there is no ceiling to respect. It stays on the latest, which is also the safer
choice for it: SDK 56 shipped a Hermes memory regression
([expo/expo#46519](https://github.com/expo/expo/issues/46519), arrived with
React Native 0.85, fixed in `expo@57.0.9` / RN 0.86.2), and a multi-hour
background recording is exactly the workload that gets killed for memory.

That regression is a caveat on 0a's result too, since 0a is pinned to 56. It is
recorded in `webview-3d/RESULTS.md` next to the decision it could distort.

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
