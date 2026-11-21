#!/bin/bash
# Builds Istiqamah.app (Apple silicon + Intel) and a zip to share.
set -euo pipefail
cd "$(dirname "$0")"

APP=build/Istiqamah.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

FLAGS=(-swift-version 5 -O -parse-as-library
  -framework Cocoa -framework WebKit -framework SwiftUI -framework AVFoundation
  -framework ServiceManagement -framework UniformTypeIdentifiers)

swiftc "${FLAGS[@]}" -target arm64-apple-macos13.0 mac/Sources/*.swift -o build/Istiqamah-arm64
if swiftc "${FLAGS[@]}" -target x86_64-apple-macos13.0 mac/Sources/*.swift -o build/Istiqamah-x86_64 2>/dev/null; then
  lipo -create build/Istiqamah-arm64 build/Istiqamah-x86_64 -output "$APP/Contents/MacOS/Istiqamah"
  rm build/Istiqamah-x86_64
else
  echo "note: Intel build skipped; app is Apple silicon only"
  cp build/Istiqamah-arm64 "$APP/Contents/MacOS/Istiqamah"
fi
rm build/Istiqamah-arm64

cp mac/Info.plist "$APP/Contents/Info.plist"
cp mac/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
rsync -a --exclude '.DS_Store' web/ "$APP/Contents/Resources/web/"
codesign --force --deep --sign - "$APP"

rm -f build/Istiqamah-mac.zip
(cd build && ditto -c -k --keepParent Istiqamah.app Istiqamah-mac.zip)
echo "Built $APP and build/Istiqamah-mac.zip"
