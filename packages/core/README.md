# `@fjellrute/core`

The parts of Fjellrute that are the same on a laptop and on a phone: route
geometry, the GPX/TCX/FIT parsers, the elevation profile and avalanche runout
maths, tile arithmetic, every API client, the bilingual store, and the terms and
privacy text the user accepts.

Roughly 4,300 lines. It exists so that there is exactly one definition of each of
those functions. The alternative — a second copy in the phone app — would not
stay in step, and the way that failure shows up is a route that measures 14.2 km
on a phone and 14.4 km on a laptop, with no error anywhere and no way to tell
which number is right.

## The rule

**No platform.** Not the DOM, not React Native, not Leaflet, not MapLibre, not
Node.

This is enforced, not encouraged. `tsconfig.json` sets `lib: ["ES2023"]` and
`types: []`, so `document`, `localStorage`, `DOMParser`, `OffscreenCanvas`,
`process` and `Buffer` are all undeclared and a module that touches one fails
`tsc -b`. What the package *may* assume is written out by hand in
`src/globals.d.ts` — `fetch`, `AbortController`, `URLSearchParams`, and the four
members of a `Response` that anything here reads. Each of those exists with the
same signature in a browser, in a Cloudflare Worker, in Node 18+ and under
Hermes, which is what makes it safe to assume.

`scripts/verify-core-package.mjs`, wired into `pnpm test`, checks the same thing
from the other direction by name, so the boundary is tested and not merely
declared.

React is a *peer* dependency and is allowed. React itself is platform-free; it
is React DOM and React Native that are not. That is why `useWeather`, `useSnow`
and `useAvalanche` live here — they fetch and cache, and render nothing.

## Where the platform does leak in

Three places, each an adapter with a default that resolves from `globalThis`, so
the browser behaves exactly as it did before this package existed and nothing
has to be configured for it to work:

| File | What it abstracts | Web default | Phone (Phase 2–3) |
| --- | --- | --- | --- |
| `src/routes/xml.ts` | Parsing GPX/TCX | `globalThis.DOMParser` | `@xmldom/xmldom` via `setXmlParser()` |
| `src/i18n/environment.ts` | Remembering the language, `<html lang>` | `localStorage`, `document` | `AsyncStorage` via `setLocaleEnvironment()` |
| `src/elevation/raster.ts` | Decoding the runout PNG to pixels | `createImageBitmap` + `OffscreenCanvas` | a native decoder via `setRasterSampler()` |

A fourth kind of leak is handled without an adapter at all: `importRouteFile`
and `importGpxFile` take a structural interface (`name`, `text()`,
`arrayBuffer()`) that a browser `File` already satisfies, so the web call sites
are unchanged and there is no wrapper to keep in step.

## The one thing left undecided

Four places name a same-origin URL and let the platform resolve it:
`weather/api.ts` (`/metno-api/…`), `snow/api.ts` (`/gts-api/…`),
`routes/api.ts` (`/api/routes`) and the terrain entry in `offline/layers.ts`,
which reads `location.origin` off `globalThis` for the same reason. In a browser
all four resolve against the page. On a phone none of them do, because React
Native's `fetch` requires an absolute URL.

That is deliberately not solved here. It is one decision — which host the phone
app talks to, and how it is configured per environment — and making it four
times in four files is how the two clients end up pointed at different
deployments. Phase 2 makes it once. Until then `location.origin` is exempted by
name in `scripts/verify-core-package.mjs`, so the gate stays honest about it
instead of being widened to allow browser globals generally.

## Consuming it

There is no build step and no `dist/`. Both apps compile the TypeScript in
`src/` directly — Vite transforms it, `tsc -b` checks it as its own project. A
built artefact would be one more thing that can be stale.

Imports go through the subpaths in `package.json`, which are listed explicitly
rather than as a `./*` wildcard:

```ts
import { simplify } from '@fjellrute/core/geometry';
import type { Route } from '@fjellrute/core/types';
import { useT } from '@fjellrute/core/i18n';
```

The wildcard was rejected because it would publish every internal file,
including the private halves of the three adapters above, so a component could
reach past an entry point and nothing would notice.

## What deliberately stayed in `apps/web`

Anything that touches a map, a canvas, a worker or a DOM event:
`elevation/useElevation.ts` and `profile.worker.ts` (they own a `Worker`),
`offline/db.ts` and the download machinery (IndexedDB), `routes/download.ts`
(anchor clicks), all the Leaflet and MapLibre layers, the briefing sheet, and
the parking sign rendering. The phone app will need its own versions of most of
these, and they will look nothing like the web ones — which is the reason they
are not here.
