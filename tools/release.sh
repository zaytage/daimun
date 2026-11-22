#!/bin/bash
# Publish a new Da’imun version. Everyone's Mac and Windows apps update themselves, and the website updates too.
#
#   tools/release.sh 1.2 "What changed, in one short sentence"
#
# Steps: bump the version, build the app, publish the website (docs/), create the GitHub release
# with the zip, then publish update.json so the apps see the new version.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:?usage: tools/release.sh <version> \"<what changed>\"}"
NOTES="${2:-Improvements and fixes.}"
GH="${GH:-$(command -v gh || echo "$HOME/.local/bin/gh")}"
REPO="zaytage/daimun"
PLIST=mac/Info.plist
TRAILER="Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"

BUILD=$(( $(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$PLIST") + 1 ))
/usr/libexec/PlistBuddy -c "Set CFBundleShortVersionString $VERSION" -c "Set CFBundleVersion $BUILD" "$PLIST"
echo "Da’imun $VERSION (build $BUILD)"

bash build.sh
mv build/Istiqamah-mac.zip build/Daimun-mac.zip
SHA=$(shasum -a 256 build/Daimun-mac.zip | awk '{print $1}')

# Windows app (.NET Framework 4.8 + WebView2), built here with the .NET SDK.
DOTNET="${DOTNET:-$(command -v dotnet || echo "$HOME/.dotnet/dotnet")}"
IFS=. read -r MA MI PA <<< "$VERSION"
ASMV="${MA:-0}.${MI:-0}.${PA:-0}.$BUILD"
rm -rf build/win
DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 "$DOTNET" build win/Istiqamah.csproj -c Release -nologo -v q \
  -p:Version="$VERSION" -p:AssemblyVersion="$ASMV" -o build/win/Daimun
cp build/win/Daimun/runtimes/win-x64/native/WebView2Loader.dll build/win/Daimun/ 2>/dev/null || true
rsync -a --exclude '.DS_Store' web/ build/win/Daimun/web/
python3 - build/win build/Daimun-windows.zip <<'PY'
import os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(root):
        for f in files:
            full = os.path.join(d, f)
            z.write(full, os.path.relpath(full, root))
PY
WSHA=$(shasum -a 256 build/Daimun-windows.zip | awk '{print $1}')
# One-off: a copy whose program is named Istiqamah.exe, so Windows apps from before the rename can install this update.
if [ -n "${LEGACY_WIN:-}" ]; then
  python3 tools/legacy_win_zip.py build/win build/Daimun-windows-legacy.zip
  EXTRA_ASSETS="build/Daimun-windows-legacy.zip"
fi

# The website: the web app as it is now. update.json keeps the previous version until the release exists.
rm -rf docs.tmp && mkdir docs.tmp
rsync -a --exclude '.DS_Store' web/ docs.tmp/
[ -f docs/update.json ] && cp docs/update.json docs.tmp/update.json
[ -f docs/stats-history.json ] && cp docs/stats-history.json docs.tmp/stats-history.json  # kept by the daily count
touch docs.tmp/.nojekyll
rm -rf docs && mv docs.tmp docs

git add -A
git commit -q -m "Da’imun $VERSION" -m "$NOTES" -m "$TRAILER"
git push -q origin main

# Upload one file at a time and retry, so a slow connection doesn't break the release; publish only when all are up.
"$GH" release view "v$VERSION" --repo "$REPO" >/dev/null 2>&1 || \
  "$GH" release create "v$VERSION" --draft --repo "$REPO" --title "Da’imun $VERSION" --notes "$NOTES"
# Apps update from their own copies (…-update.zip), so the plain downloads count new installs only.
cp build/Daimun-mac.zip build/Daimun-mac-update.zip
cp build/Daimun-windows.zip build/Daimun-windows-update.zip
for f in build/Daimun-mac.zip build/Daimun-windows.zip build/Daimun-mac-update.zip build/Daimun-windows-update.zip ${EXTRA_ASSETS:-}; do
  for try in 1 2 3 4 5; do
    "$GH" release upload "v$VERSION" "$f" --clobber --repo "$REPO" && break
    [ "$try" = 5 ] && { echo "Upload of $f failed; run the script again when the connection is better."; exit 1; }
    sleep 15
  done
done
"$GH" release edit "v$VERSION" --draft=false --latest --repo "$REPO"

# Now tell the apps.
python3 - "$VERSION" "$BUILD" "$SHA" "$NOTES" "$REPO" "$WSHA" > docs/update.json <<'EOF'
import json, sys
version, build, sha, notes, repo, wsha = sys.argv[1:7]
base = f"https://github.com/{repo}/releases/download/v{version}/"
print(json.dumps({
    "app": {"version": version, "build": int(build), "sha256": sha, "notes": notes, "url": base + "Daimun-mac-update.zip"},
    "windows": {"version": version, "build": int(build), "sha256": wsha, "notes": notes, "url": base + "Daimun-windows-update.zip"},
}, indent=2))
EOF
git add docs/update.json
git commit -q -m "Announce Da’imun $VERSION to the apps" -m "$TRAILER"
git push -q origin main
echo "Published $VERSION. Apps pick it up within a few hours, or straight away with Check for updates."
