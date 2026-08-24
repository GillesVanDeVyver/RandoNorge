#!/bin/sh
# Scaffold the throwaway Expo app for spike 0b.
#
# IMPORTANT, AND THE THING THAT WASTES AN EVENING IF MISSED: this spike cannot
# run in Expo Go. Background location needs the platform entitlements (iOS) and
# the foreground-service declaration (Android) that only a development build of
# your own app has. Expo Go will happily grant foreground permission and then
# record nothing once the screen locks — which looks exactly like the failure the
# spike is hunting for, and would give a false FAIL.
#
# So: scaffold, prebuild, and install a development build on the device.
#
# Spike 0a builds a development build too, as of 2026-08-24, though it arrived
# there for a different reason: Expo Go can only load the one SDK currently in
# the app stores, so anything depending on it breaks whenever either release
# train moves. Its setup.sh tells that story. The practical upshot for this
# script is that no Expo SDK is pinned here — a development build compiles the
# SDK in, so there is no ceiling to name — and that staying current also avoids
# the SDK 56 Hermes memory regression (expo/expo#46519, fixed in expo@57.0.9),
# which a multi-hour background recording is precisely the workload to be killed
# by.
#
#   ./setup.sh
#   cd app
#   npx expo run:android          # or: npx expo run:ios (needs Xcode)
#
# Android needs Android Studio's SDK and an unlocked phone with USB debugging.
# For iOS, `eas build --profile development --platform ios` works without a Mac
# but needs the paid Apple developer programme, so Android first is cheaper.

set -e
cd "$(dirname "$0")"

if [ -d app ]; then
	echo "app/ already exists; refreshing App.tsx and app.json only."
else
	npx create-expo-app@latest app --template blank-typescript
	cd app
	npx expo install \
		expo-location \
		expo-task-manager \
		expo-file-system \
		expo-battery \
		expo-sharing
	cd ..
fi

cp template/App.tsx app/App.tsx
cp template/app.json app/app.json

echo
echo "Ready. Next:"
echo "  cd $(pwd)/app && npx expo run:android"
echo
echo "Then follow the protocol in README.md. Afterwards:"
echo "  node analyse.mjs ~/Downloads/spike-fixes.jsonl"
