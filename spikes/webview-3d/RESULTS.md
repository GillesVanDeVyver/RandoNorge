# Spike 0a results — MapLibre GL JS in a WebView

Status: **not yet run.**

Fill this in on the day you run it, phone by phone. An empty row is more useful
than a remembered one.

| Date | Device | OS | Price bracket | webgl | median ms | worst ever ms | got hot? | Would a paying user accept it? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |

Aim for at least: one mid-range Android roughly three years old, one current
mid-range iPhone. A flagship result tells you nothing about the audience.

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
