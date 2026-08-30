#!/bin/sh
# Install the Expo-managed dependencies for the mobile app, at the versions this
# SDK requires, and check the app is ready to build.
#
# WHY THIS EXISTS AND ISN'T JUST package.json. Every package below is either a
# native module or tied to the Expo SDK's own release train, and the correct
# version of each is a function of the SDK version — not something a human should
# type. `expo install` asks Expo which version goes with the installed SDK;
# `pnpm add` would take the newest published, which for a native module means a
# build that compiles and then fails on the device. The four versions that ARE
# pinned in package.json (expo, react, react-native, typescript) were read off a
# real SDK 57 scaffold rather than inferred.
#
# Usage:
#
#   pnpm install                # from the repository root, once
#   apps/mobile/setup.sh
#
# Then build. There is no Expo Go path for this app: the MapLibre native module
# is not in Expo Go, and Expo Go tracks one SDK chosen by the app stores — the
# same ceiling that cost an evening in spikes/webview-3d/setup.sh. Either:
#
#   npx eas-cli@latest build --profile development --platform android   # cloud
#   npx expo run:android                                                # local SDK
#
# `eas-cli`, with the suffix. `npx eas` asks npm for a package called `eas`,
# which is not this CLI and has no executable, so npm fails with "could not
# determine executable to run" — a message that says nothing about the cause.
# The binary it installs IS called `eas`; only the package name differs.
#
# and then `pnpm start` to serve JS to the installed development build.

set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
	echo "node_modules/ is missing. Run 'pnpm install' at the repository root first:"
	echo "  cd ../.. && pnpm install"
	exit 1
fi

# The development client. This is the package that makes eas.json's
# `developmentClient: true` mean anything: it is what lets the installed binary
# connect to a Metro server instead of running a frozen bundle, and it is the
# replacement for Expo Go, whose SDK ceiling is documented in spikes/README.md.
npx expo install expo-dev-client

# Expo Router and its peers. react-native-screens and safe-area-context are
# native; expo-linking is what makes the auth scheme resolvable.
npx expo install expo-router react-native-screens react-native-safe-area-context expo-linking expo-constants expo-status-bar

# Authentication. expo-secure-store is where the session lives so it survives
# the app being killed — the acceptance criterion for Phase 2. expo-network is
# required by @better-auth/expo's client.
npx expo install expo-secure-store expo-network

# The map (Phase 3) and the live position marker. MapLibre React Native is a
# native module with an Expo config plugin, already declared in app.json.
npx expo install @maplibre/maplibre-react-native expo-location

# The renderer for the elevation profile, and later for the snow chart beneath
# it. Also native, which is the part that surprises people: adding it changes
# what has to be in the binary, so an existing development build on a device
# will redbox on RNSVGSvgView until it is rebuilt once. Nothing about the
# JavaScript is unusual — apps/web draws the same chart with the same elements
# for the printed briefing, and the shape rules both of them follow live in
# packages/core.
npx expo install react-native-svg

# Better Auth's client half. Not an Expo package, so a plain add — but the
# version must match the `better-auth` and `@better-auth/expo` in the ROOT
# package.json, which is where the Worker's server half lives.
root_version=$(node -p "require('../../package.json').dependencies['better-auth']" 2>/dev/null || echo "")
if [ -z "$root_version" ]; then
	echo "Could not read better-auth's version from the root package.json." >&2
	exit 1
fi
echo "Matching better-auth ${root_version} from the root package.json."
pnpm add "better-auth@${root_version}" "@better-auth/expo@${root_version}"

# Finally, let Expo correct anything the steps above left inconsistent. This is
# the authoritative check: it compares every installed package against what the
# SDK expects and rewrites the ones that disagree.
npx expo install --fix

echo
echo "Done. Next, build a development build once:"
echo "  npx eas-cli@latest build --profile development --platform android   # cloud"
echo "  npx expo run:android                                                # local SDK"
echo
echo "Then serve JS to it with:  pnpm start"
echo
echo "Set the API host first if you are pointing at a laptop — see src/config/api.ts."
