# Bringing apps/mobile closer to apps/web

Written 2026-08-26, after the phone first logged in against the dev Worker.

## Where the two actually stand

The web app has six signed-in views (`overview`, `planner`, `saved`,
`completed`, `track`, `offline`) plus public/shared views, and roughly
twenty-five distinct capabilities on top of them.

The phone has three screens: `login.tsx`, `index.tsx` (the saved-routes list)
and `route/[id].tsx` (a read-only MapLibre map of one saved route). That is it.

Be careful with a claim that sounds true and is not: *"mobile already has
elevation profiles, weather, snow, avalanche and GPX import."* Those live in
`packages/core` and are import-ready, but **no file under `apps/mobile`
imports any of them today**. Available and wired are different things, and
every estimate below depends on not confusing them.

The good news is the split is favourable. Around 70–80% of what the web app
does is already platform-free in `packages/core` — geometry, the routes
client, `computeProfile`, `useWeather`, `useSnow`, `useAvalanche`, the
GPX/TCX/FIT parsers, the i18n store, the Kartverket/NVE layer descriptors.
What is missing on the phone is almost entirely *view* code.

## Phase 0 — make it look like Fjellrute (small, do this first)

This is the cheapest phase by a wide margin and it is the one the complaint is
actually about. `apps/mobile/src/ui/theme.ts` opens by stating the divergence
from the web tokens was deliberate. That reasoning holds for `backdrop-filter`
and the glass tokens, which React Native has no equivalent for — but it was
applied too broadly, and the palette went with it. Revisit it.

Port the real values from `apps/web/src/index.css:7-93`:

| Token | Web | Mobile today |
|---|---|---|
| accent | `#2dd4bf` teal | `#1d6fa5` blue |
| accent contrast | `#04241f` | `#ffffff` |
| page background | `#f4f2ec` warm cream | `#f7f8fa` cool grey |
| text primary | `rgba(20,28,38,0.92)` | `#14181f` |
| text secondary | `rgba(20,28,38,0.58)` | `#5b6472` |
| danger | `#dd4a3c` | `#b3261e` |
| radii | 8 / 12 / 16 / 999 | 8 / 12 / — / 999 |
| spacing | 4 / 8 / 12 / 16 / 24 / 32 | 4 / 8 / 16 / 24 / 32 |
| font sizes | 11 / 13 / 15 / 20 / 26 | none — inline per screen |
| font | Inter | system |

Also add the semantic pair the web uses everywhere and mobile lacks entirely:
`--ascent #34c759` / `--descent #ff6b5e` (and the `-strong` variants for text
on white). Nothing on the phone can render an elevation profile in the house
style without them.

Three of these need new dependencies, so decide before starting: Inter needs
`expo-font`; the glass surfaces need `expo-blur`'s `BlurView` (or accept solid
`rgba(255,255,255,0.96)` and skip the blur); shadows need `elevation` on
Android and `shadowColor/Offset/Radius` on iOS rather than a CSS shadow string.
None of the three are currently in `apps/mobile/package.json`.

Finish the phase by extending `scripts/verify-mobile-app.mjs` with a check that
parses the hex values out of `apps/web/src/index.css` and asserts `theme.ts`
agrees. The tokens drifted silently once; a test is what stops it happening
again.

## Phase 1 — same shell, same navigation

Mirror the web's view set as `expo-router` routes. One correction falls out
immediately: on the web, `/alpha/` is `AccountOverview` — a hub with four
action cards — while on the phone `index.tsx` is the saved list. So move the
list to `/saved` and give `index.tsx` the overview treatment. Add `/completed`
and `/planner` as routes even if they start as stubs, so the information
architecture matches from the outset instead of being retrofitted.

## Phase 2 — the planner screen, read-only first

Promote `route/[id].tsx` into a full-screen planner: MapLibre full-bleed,
floating chrome over it in the web's positions (toolbar top-left, summary as a
bottom sheet). Match the sheet's real dimensions from
`SummaryPanel.module.css:19-42` — peek 64px, expanded `min(62vh, 560px)`,
rounded top corners.

Then add the elevation profile, which is the single highest-value item in the
whole plan: `computeProfile` is pure and already written, so this is rendering
only. Recharts does not work in React Native, so pick a renderer —
`react-native-svg` is the low-risk choice and lets the web's `ProfileSvg.tsx`
approach carry over almost directly. Not currently a dependency.

## Phase 3 — the data panels (best effort-to-value ratio)

Weather, snow depth and avalanche danger. All three are `useWeather` /
`useSnow` / `useAvalanche` from core plus a React Native view — genuinely zero
new logic. They reach upstream through the Worker's `/metno-api`, `/gts-api`
and `/varsom-api` proxies, which the phone already has via `API_BASE`, so
there is no new backend work either.

## Phase 4 — drawing and editing

The hardest view work in the plan: touch gestures on the MapLibre map feeding
the RDP simplifier in core (`RDP_EPSILON_M` is 8m, eraser radius 32px — keep
both identical to the web or the same drag produces different routes on the
two clients). Do not start this before Phase 2's sheet exists; it has nowhere
to put its controls otherwise.

## Phase 5 and beyond — defer deliberately

Track recording with `expo-location` background tasks, then offline tiles
(IndexedDB → SQLite/filesystem, same `tileMath` logic), then briefing export
(needs native PDF), then 3D terrain. Each is a project. The phone is more
useful with Phases 0–3 finished than with any one of these started.

## One rule throughout

Nothing non-visual gets written inside `apps/mobile`. If a phase seems to need
logic, it goes in `packages/core` and the web app switches to it in the same
commit — that is why the split works today, and the fastest way to lose it is
a "temporary" copy of a formatter or a fetch call.
