#!/bin/sh
# Scaffold the throwaway Expo app for spike 0a and drop the spike's App.tsx in.
#
# The Expo SDK is not pinned here on purpose. This spike may be run months after
# it was written, and a pinned SDK would send you into an upgrade before you
# could answer the question it exists to answer. So the scaffold is created at
# whatever version is current on the day you run this, and the only file this
# repo owns is template/App.tsx.
#
# Usage:  ./setup.sh && cd app && npx expo start
#
# Then open it with Expo Go on the phone. Note that Expo Go is enough for this
# spike — react-native-webview ships inside it, so no development build and no
# Xcode/Android Studio are needed.

set -e
cd "$(dirname "$0")"

if [ -d app ]; then
	echo "app/ already exists; refreshing App.tsx only."
else
	npx create-expo-app@latest app --template blank-typescript
	cd app
	# expo install, not pnpm add: it picks the version of the native module that
	# matches the SDK the scaffold just chose.
	npx expo install react-native-webview
	cd ..
fi

cp template/App.tsx app/App.tsx
echo
echo "Ready. Next:"
echo "  cd $(pwd)/app && npx expo start"
echo
echo "Then follow the protocol in README.md and write the answer in RESULTS.md."
