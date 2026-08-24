#!/bin/sh
# Scaffold the throwaway Expo app for spike 0a and drop the spike's App.tsx in.
#
# THE SDK IS PINNED, AND THAT IS THE POINT. This script used to scaffold at
# whatever version was current, on the reasoning that a pin would send you into
# an upgrade before you could answer the question. That was wrong, and it failed
# exactly once in the way it was supposed to prevent: on 2026-08-24 the current
# scaffold was SDK 57, the Expo Go in the Play Store was 56, and the phone said
# "Project is incompatible with this version of Expo Go" with a suggested fix
# (update Expo Go) that could not work. An unpinned scaffold does not avoid the
# upgrade detour; it just moves the detour onto the device, where the error
# message points the wrong way.
#
# Spike 0a must run in Expo Go — that is what makes it cheap, no Android Studio
# and no Xcode — and Expo Go only ever supports the SDK that is currently in the
# app stores. So this spike is capped by whatever Expo Go can load, and the cap
# has to be named here rather than discovered by QR code.
#
# EXPO_SDK below is that cap, chosen 2026-08-24 against the Play Store build of
# Expo Go on that date. To bump it: install the current Expo Go on the phone,
# read the SDK it reports on its own home screen, set EXPO_SDK to that number,
# delete app/ and re-run. Raising it is safe; the only failure mode is the error
# above, which this script now catches before you pick up the phone.
#
# One known cost of the 56 pin, worth reading before you trust a slow result:
# SDK 56 shipped a Hermes memory regression (expo/expo#46519, arrived with React
# Native 0.85, fixed in expo@57.0.9 / RN 0.86.2) that raises baseline memory
# noticeably. This spike measures frame times in a WebView rather than JS heap
# churn, so it is not the thing being measured — but if the verdict comes out
# marginal, or the WebView is killed for memory, re-run on a development build
# at the latest SDK before writing "No" in RESULTS.md. A false No here deletes
# Phase 6.
#
# Usage:  ./setup.sh && cd app && npx expo start
#
# Then open it with Expo Go on the phone. Expo Go is enough for this spike —
# react-native-webview ships inside it.

set -e
cd "$(dirname "$0")"

# The Expo SDK this spike targets, because it is the one Expo Go can open.
EXPO_SDK=56

if [ -d app ]; then
	echo "app/ already exists; refreshing App.tsx only."
else
	npx create-expo-app@latest app --template blank-typescript
	cd app
	# create-expo-app always scaffolds the newest SDK, which is usually ahead of
	# Expo Go. Pin expo itself, then let `expo install --fix` pull every other
	# package — react, react-native, expo-status-bar — back to the versions that
	# SDK expects. Doing it in that order matters: --fix reads the installed expo
	# version to decide what "correct" means.
	npm install "expo@^${EXPO_SDK}.0.0"
	npx expo install --fix
	# expo install, not npm install: it picks the version of the native module
	# that matches the pinned SDK, and this module has to be the one baked into
	# Expo Go or the WebView will not exist at runtime.
	npx expo install react-native-webview
	cd ..
fi

cp template/App.tsx app/App.tsx

# Preflight. Report the SDK that is actually installed and name the remedy when it
# is not the pinned one — that mismatch is the on-device error above, and it is far
# cheaper to read here. It warns rather than exits: the pin is a guess about a
# phone this script cannot see, so someone whose Expo Go is genuinely newer should
# be able to raise EXPO_SDK and carry on, not be blocked by a stale number.
installed=$(node -p "require('./app/node_modules/expo/package.json').version" 2>/dev/null || echo unknown)
case "$installed" in
	"${EXPO_SDK}."*)
		echo
		echo "Expo SDK ${installed} installed — matches the pin, so Expo Go should open it."
		;;
	unknown)
		echo
		echo "WARNING: could not read app/node_modules/expo/package.json."
		echo "Run 'npm install' in app/ and re-run this script before scanning any QR code."
		;;
	*)
		echo
		echo "WARNING: expo ${installed} is installed but this spike is pinned to SDK ${EXPO_SDK}."
		echo "Expo Go will most likely refuse the project with 'incompatible with this"
		echo "version of Expo Go'. Fix it here rather than on the phone:"
		echo "  cd app && npm install expo@^${EXPO_SDK}.0.0 && npx expo install --fix"
		;;
esac

echo
echo "Ready. Next:"
echo "  cd $(pwd)/app && npx expo start"
echo
echo "On the phone, Expo Go's home screen names the SDK it supports. If that is"
echo "not ${EXPO_SDK}, change EXPO_SDK at the top of this script to match, delete"
echo "app/, and re-run — do not update Expo Go and hope."
echo
echo "Then follow the protocol in README.md and write the answer in RESULTS.md."
