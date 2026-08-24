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

A **No** here deletes Phase 6 and the whole 3D-on-mobile approach, so the runtime
under the measurement has to be above suspicion. Two things to check, and record
the SDK for every row so a surprising number can be re-examined later:

**Use a development build.** `setup.sh` does this now. It is not only about Expo
Go's SDK ceiling — SDK 56 shipped a Hermes memory regression
([expo/expo#46519](https://github.com/expo/expo/issues/46519), fixed in
`expo@57.0.9` / RN 0.86.2), and being forced onto a runtime with a known memory
bug is how a performance spike on a cheap phone produces a false No. The script
enforces a floor of SDK 57 for that reason. If the WebView is killed or reloaded
under memory pressure, check the installed `expo` version before believing it.

**Measure a real device, warm.** A development build on a flagship, or a cold
phone, will pass anything. The protocol in `README.md` exists because the
interesting number is the worst frame on a three-year-old mid-range Android after
two minutes of dragging.

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
