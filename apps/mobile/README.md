# Fjellrute — mobile app

Phases 2 and 3 of `Fjellrute-Mobile-Build-Plan.docx`: sign in against the real
backend, list your saved routes, and open one on the Kartverket topo map with
the NVE steepness overlay and your live position.

There is no drawing, no recording and no offline caching. Those are Phases 4 and
later, and each needs a decision this phase does not have to make.

## What is shared with the web app, and what isn't

Everything with behaviour comes from `@fjellrute/core` and is the same code the
web app runs: the saved-routes client and its GeoJSON parsing
(`routes/api`), the display formatting (`routes/format`), the bilingual store
(`i18n`), and the tile-source descriptors for topo and steepness
(`offline/layers`). Change a tile URL or the storage format once and both apps
follow.

What is rewritten here is only the rendering — React Native views instead of
DOM and CSS — plus three things the browser used to supply for free and the
phone has to be told: the API host (`src/config/api.ts`), where the session is
stored (`src/auth/client.ts`), and where the language preference is stored
(`src/i18n/install.ts`).

## First run

There is no Expo Go path. The MapLibre native module is not in Expo Go, and
Expo Go's SDK is a ceiling set by the app stores rather than by this repository —
that ceiling already cost an evening in `spikes/webview-3d`. You build a
development build once, and after that every JS change is a reload.

```sh
pnpm install                 # from the repository root
apps/mobile/setup.sh         # installs the Expo-managed and native deps
```

`setup.sh` ends by running `npx expo install --fix`, which may leave `app.json`
modified: it re-serializes the file and appends config plugins it finds
installed. Read that diff rather than reverting it — it is Expo telling you what
the native build needs.

Then build the binary. Cloud, no local Android SDK needed:

```sh
cd apps/mobile
npx eas-cli@latest build --profile development --platform android
```

`eas-cli`, with the suffix, and it matters: `npx eas` asks npm for a package
named `eas`, which is not this CLI and ships no executable, so npm fails with
"could not determine executable to run" — a message that names nothing useful.
The binary is called `eas`; only the package name differs. `npm install -g
eas-cli` and then plain `eas build …` works too, and is worth it if you build
often; `@latest` is here because EAS declines builds from a stale CLI, which a
global install eventually becomes.

EAS will ask you to log in (an Expo account, free, separate from any account in
this app) and then to create the project on its servers. Say yes to the latter:
it writes a project ID into `app.json`, and that ID is how subsequent builds
find the same project.

EAS prints a URL when it finishes; open it on the phone and install the APK.
This step is needed again only when a native dependency is added or removed.

## What is in eas.json, and why the file has no comments in it

`eas.json` is validated against a closed schema before a build starts, and
unknown keys are rejected rather than ignored. The `"//key": "…"` convention
used in `app.json` is therefore fatal here — it fails with `"cli.//appVersionSource"
is not allowed` and six more like it, before any build happens. So the
explanations live here instead, which is the trade this file forces: prose one
directory away from the setting it describes.

Profile names are the one thing not schema-checked, which is why `base` can
exist at all. It holds what every profile shares. `node` is pinned because EAS
otherwise picks its own default, and a Node that disagrees with this workspace
resolves dependencies differently. `corepack: true` is what makes EAS honour the
`packageManager` field in the root `package.json` and use pnpm 10 rather than
npm — without it the workspace links are never created and `@fjellrute/core`
resolves to nothing.

`development` is the only profile that matters right now. `developmentClient:
true` is its whole point: the binary embeds `expo-dev-client` and loads JS from a
Metro server instead of shipping a frozen bundle, which is what replaces Expo Go
and its SDK ceiling. `android.buildType: "apk"` overrides the default app
bundle, because an `.aab` can only be installed through Play while an `.apk` can
be downloaded from the EAS build page and sideloaded — which is what testing on
your own phone means. `ios.simulator: false` signs for a real device and needs an
Apple Developer account with the device's UDID registered; Android is the
shorter path and is what the instructions above assume.

`preview` is the same build without the development client: self-contained, JS
bundled in, for handing to someone who should not have to run Metro. Nothing
needs it yet. It is kept because the delta from `development` is exactly one
flag, and that is worth recording. `production` is store-bound and untouched;
the default app-bundle output is the right one for Play.

`cli.appVersionSource: "local"` keeps the version in `app.json` authoritative
instead of letting EAS bump a counter on its servers. The app is at 0.1.0 and
nothing is in a store, so a remote source would only mean more state living
outside the repository.

## Every run after that

Point the app at a backend, start Metro, open the app.

```sh
# terminal 1 — the backend, listening on more than loopback so the phone can reach it
npx wrangler dev --ip 0.0.0.0 --port 8787

# terminal 2 — the JS
pnpm -C apps/mobile start
```

`src/config/api.ts` decides which backend the app talks to. It defaults to your
laptop over Wi-Fi, because that is the loop that tells you something: a test
signup lands in the local D1 copy, the Worker log is in front of you while the
phone is hitting it, and a change to `worker/routes.js` is live on the next
request. It tries to infer your laptop's address from Metro's; if that guess is
wrong, edit `LAN_API` in that file — the login screen prints the host it is
using, so you can see which one it picked.

To aim a development build at the deployed Worker instead, set
`DEVELOPMENT_TARGET = 'production'` in the same file. That is a reload, not a
rebuild. Release builds ignore the flag entirely and always use production.

Phone and laptop must be on the same network, and some guest and corporate Wi-Fi
blocks device-to-device traffic outright. If a request times out with nothing in
the Worker's log, suspect that before suspecting the code.

## Signing in

Sign-in only. Creating an account needs an invite code during the alpha, plus a
password policy, a username policy, terms acceptance and email verification —
`apps/web/src/components/LoginPage.tsx` is over 700 lines for those reasons.
Duplicating them here would copy rules that must not drift, for a flow each user
goes through once. Make the account at `fjellrute.no`, sign in here.

The session lives in `expo-secure-store` (Keychain on iOS,
EncryptedSharedPreferences on Android), so the phase's acceptance criterion holds
without any code on the login screen: sign in, force-quit the app, reopen it,
still signed in.

If sign-in rejects a password you know is correct, the first thing to check is
the deep-link scheme. Better Auth's Expo client sends it as the request origin,
and the Worker's `trustedOrigins` must list it; a mismatch fails the CSRF check,
which surfaces as a wrong password rather than as a configuration error. The
string appears in three files and `scripts/verify-mobile-app.mjs` asserts they
agree, so `pnpm test` catches it.

## Type-checking

```sh
pnpm -C apps/mobile typecheck
```

Deliberately not part of the root `pnpm build`. That runs `tsc -b` over the
project references, where `packages/core` compiles with `types: []` so a stray
`document` or `process` fails there. Adding this app to that solution would pull
React Native's types in and the boundary would stop meaning anything.

## What has not been verified by running it

No part of this app has been run as an app. There has been no Metro server and
no device. What it has been through is `pnpm -C apps/mobile typecheck` against
the real installed typings, `pnpm test` (which includes `test:mobile`), `pnpm
lint`, `expo config --type public` resolving `app.json`, and `setup.sh` actually
executing.

One thing beyond that has now been tested by the real service, by failing: an
EAS build was started and rejected `eas.json` outright for carrying the `//`
comment keys that `app.json` tolerates. That file is fixed and `test:mobile`
guards it, but the corrected version has not yet been past EAS's validator
itself — the next build attempt is the first real check of it, and of everything
after it.

That distinction matters most for the map. An earlier draft of this file warned
that the MapLibre prop names were taken from the library's v10 API and were the
first place to look if the map screen failed to compile. It did fail, and that
was the reason: the installed package is v11.3.7, where `MapView` is `Map`,
`ShapeSource` is `GeoJSONSource`, `RasterLayer`/`LineLayer` are `Layer` with a
`type`, and camelCased `style` props are the style spec's own hyphenated names
split across `paint` and `layout`. The screen is now written against typings
that were read rather than remembered, and it type-checks. What a compiler still
cannot tell us is whether the tiles arrive, whether the route is where it should
be on the ground, or whether the position marker points the right way.

Two smaller things to expect rather than be alarmed by.

`setup.sh` ends with three unmet-peer warnings, and all three are about packages
this app never loads. The test that settles it is the same for each: look for the
package in `apps/mobile/node_modules`, and look for an import of it in `app/` or
`src/`. None of the three is present in either place — every path to them in
`pnpm why` is a `peer` edge, meaning some dependency *declared* a version it
would like if the package were used, not that anything here uses it.

  - `react-native-worklets 0.12.1` against `^0.7.4 || ^0.8.0 || ^0.9.0 ||
    ^0.10.0`. The narrow range is `expo-modules-core`'s, and it is declared
    optional; the `0.12.1` that got resolved is what `react-native-reanimated
    4.6.0` asks for (`0.12.x`), and that one is satisfied. So the two consumers
    disagree, the unsatisfied one has said it can do without, and neither
    reanimated nor worklets is installed here — they arrive as peer edges under
    `expo-router` and `@expo/ui`.
  - `@react-native/metro-config 0.87.0` against `0.86.2`. Both sides of this are
    packages this app does not call: `metro.config.js` uses
    `expo/metro-config`, and the complaint comes from
    `@react-native/community-cli-plugin`, which also marks the peer optional.
  - `react-dom 19.2.7` wants `react@^19.2.7` and finds the `19.2.3` this app
    pins. `react-dom` reaches the graph as a peer of `better-auth` and of
    `@expo/metro-runtime` (Expo Router's web target), and resolves to
    `apps/web`'s copy. Nothing here renders to the DOM. The React and React
    Native versions were read off a working SDK 57 scaffold and `expo install
    --fix` reports them up to date, so the scaffold's pins are the authority.

If a future warning names a package that *is* in `apps/mobile/node_modules` or
*is* imported by this app, it is not in this category and should not be filed
under it.

The map screen builds its own style document instead of loading one from a URL,
so MapLibre's built-in attribution control has nothing to read and is turned
off. The Kartverket and NVE credits are rendered by the app, in the bar at the
bottom of the screen. If that bar ever disappears, the credits go with it, and
they are a licence condition rather than decoration.
