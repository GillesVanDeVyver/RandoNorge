#!/bin/sh
# Scaffold the throwaway Expo app for spike 0a and drop the spike's App.tsx in.
#
# THIS SPIKE USES A DEVELOPMENT BUILD, NOT EXPO GO, AND THAT WAS LEARNED THE
# HARD WAY ON 2026-08-24. The history is worth keeping, because the obvious fix
# is the wrong one twice over:
#
#   1. The script originally scaffolded at create-expo-app@latest and said Expo
#      Go was sufficient. Expo Go only ever loads the SDK currently shipped to
#      the app stores, the scaffold came out one SDK ahead of it, and the phone
#      said "Project is incompatible with this version of Expo Go — download the
#      latest version of Expo Go", which could not help: Expo Go was already
#      current and the project was too new.
#   2. So the SDK was pinned to the version Expo Go was assumed to support. That
#      failed identically, because the assumption was inferred from "latest is
#      57, so Go must be 56" rather than read off the device. Pinning to a
#      guessed ceiling only moves the guess; the phone still gets the last word,
#      and the number goes stale the moment either side ships.
#
# A development build compiles the SDK into the app, so there is no Expo Go and
# no ceiling to guess at, now or in six months. It costs an Android SDK install
# once. Spike 0b needs that anyway, so the cost is shared, and it also frees
# this spike from Expo Go's SDK entirely — see MIN_EXPO_MAJOR below.
#
# Usage:
#
#   ./setup.sh
#   cd app
#   npx expo run:android          # or: npx expo run:ios (needs Xcode)
#
# Android needs Android Studio's SDK and an unlocked phone with USB debugging.
# For testing several phones — which this spike wants, since one device tells you
# nothing about the audience — build a shareable APK once instead of plugging in
# each handset:
#
#   npx eas-cli@latest build --profile development --platform android
#
# `eas-cli`, with the suffix: `npx eas` asks npm for an unrelated package that
# ships no executable, and npm's error names nothing useful.
#
# For iOS, `eas build --profile development --platform ios` works without a Mac
# but needs the paid Apple developer programme, so Android first is cheaper.

set -e
cd "$(dirname "$0")"

# Scaffold at the latest SDK, but not below this major. SDK 56 shipped a Hermes
# memory regression (expo/expo#46519, arrived with React Native 0.85, fixed in
# expo@57.0.9 / RN 0.86.2) that raises baseline memory noticeably. This spike
# decides whether Phase 6 exists, on the cheapest phones we care about, where
# memory pressure is exactly what kills a WebView — so measuring on a runtime
# with a known memory bug risks a false No. Raise this when a later SDK carries a
# regression that matters here; do not lower it.
MIN_EXPO_MAJOR=57

if [ -d app ]; then
	echo "app/ already exists; refreshing App.tsx only."
else
	npx create-expo-app@latest app --template blank-typescript
	cd app
	# expo install, not npm install: it picks the version of the native module
	# that matches the SDK the scaffold chose. In a development build this module
	# is compiled in, so the WebView exists on the device regardless of what any
	# store app supports.
	npx expo install react-native-webview
	cd ..
fi

cp template/App.tsx app/App.tsx

# Report the SDK actually installed, and object only to the one thing that would
# bias the measurement. This deliberately does not check against a phone: with a
# development build there is nothing on the device to be compatible with, which
# is the entire reason for the switch.
installed=$(node -p "require('./app/node_modules/expo/package.json').version" 2>/dev/null || echo unknown)
major=$(echo "$installed" | cut -d. -f1)

echo
case "$installed" in
	unknown)
		echo "WARNING: could not read app/node_modules/expo/package.json."
		echo "Run 'npm install' in app/ before building."
		;;
	*)
		if [ "$major" -lt "$MIN_EXPO_MAJOR" ] 2>/dev/null; then
			echo "WARNING: expo ${installed} is older than SDK ${MIN_EXPO_MAJOR}."
			echo "SDK 56 and earlier carry the Hermes memory regression described at the"
			echo "top of this script, which can turn an acceptable result into a false No."
			echo "This scaffold is disposable — rebuild it at a current SDK:"
			echo "  rm -rf app && ./setup.sh"
		else
			echo "Expo SDK ${installed} installed."
		fi
		;;
esac

echo
echo "Ready. Next:"
echo "  cd $(pwd)/app && npx expo run:android"
echo
echo "The first build takes a while and needs the phone plugged in with USB"
echo "debugging on. After that, 'npx expo start' reuses the installed build."
echo
echo "Then follow the protocol in README.md and write the answer in RESULTS.md."
