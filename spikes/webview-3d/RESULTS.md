# Spike 0a results — MapLibre GL JS in a WebView

Status: **not yet run.**

Fill this in on the day you run it, phone by phone. An empty row is more useful
than a remembered one.

| Date | Device | OS | SDK | Price bracket | webgl | median ms | worst ever ms | got hot? | Would a paying user accept it? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |

Aim for at least: one mid-range Android roughly three years old, one current
mid-range iPhone. A flagship result tells you nothing about the audience.

## Read this before writing "No"

This spike is pinned to Expo SDK 56, because that is the newest SDK Expo Go
could open on 2026-08-24 and running in Expo Go is what makes the spike cheap.
SDK 56 shipped a Hermes memory regression
([expo/expo#46519](https://github.com/expo/expo/issues/46519), arrived with
React Native 0.85, fixed in `expo@57.0.9` / RN 0.86.2) that raises baseline
memory noticeably.

The measurement here is frame time inside a WebView, which is the system
WebView's own renderer and not the JS engine, so the regression is probably not
what you are measuring. But "probably" is doing real work in that sentence, and
a **No** here deletes Phase 6 and the whole 3D-on-mobile approach. So if the
result is marginal, or the WebView is killed or reloaded under memory pressure,
re-run on a development build at the latest SDK — `npx expo run:android`, no
Expo Go and no SDK ceiling — before recording a No. Note in the table which SDK
each row was measured on.

## Decision

> One of: **Yes** / **Yes, with limits (state them)** / **No**.
>
> Not yet decided.

## Consequences of that decision

- **Yes** → Phase 6 proceeds as written in `Fjellrute-Mobile-Build-Plan.docx`.
- **Yes, with limits** → the limits become Phase 6 acceptance criteria. Write
  them here so they are not re-litigated from memory.
- **No** → Phase 6 is replaced. Ship 2D-only mobile (Phases 3–5, 7, 8), keep 3D
  as the desktop planner's advantage, and revisit when MapLibre Native gains
  terrain. Note the date you checked so the next check has a starting point.

## Notes

_Anything surprising: tile loading behaviour on cellular, whether the login
survived a backgrounding, whether pinch-zoom fought the WebView's own gestures,
memory warnings, WebView crashes._
