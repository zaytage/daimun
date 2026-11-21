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
REPO="zaytage/istiqamah"
PLIST=mac/Info.plist
TRAILER="Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"

BUILD=$(( $(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$PLIST") + 1 ))
/usr/libexec/PlistBuddy -c "Set CFBundleShortVersionString $VERSION" -c "Set CFBundleVersion $BUILD" "$PLIST"
echo "Da’imun $VERSION (build $BUILD)"

bash build.sh
SHA=$(shasum -a 256 build/Istiqamah-mac.zip | awk '{print $1}')

# Windows app (.NET Framework 4.8 + WebView2), built here with the .NET SDK.
DOTNET="${DOTNET:-$(command -v dotnet || echo "$HOME/.dotnet/dotnet")}"
IFS=. read -r MA MI PA <<< "$VERSION"
ASMV="${MA:-0}.${MI:-0}.${PA:-0}.$BUILD"
rm -rf build/win
DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 "$DOTNET" build win/Istiqamah.csproj -c Release -nologo -v q \
  -p:Version="$VERSION" -p:AssemblyVersion="$ASMV" -o build/win/Istiqamah
cp build/win/Istiqamah/runtimes/win-x64/native/WebView2Loader.dll build/win/Istiqamah/ 2>/dev/null || true
rsync -a --exclude '.DS_Store' web/ build/win/Istiqamah/web/
python3 - build/win build/Istiqamah-windows.zip <<'PY'
import os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(root):
        for f in files:
            full = os.path.join(d, f)
            rel = os.path.relpath(full, root)
            z.write(full, "Daimun" + rel[len("Istiqamah"):] if rel.startswith("Istiqamah") else rel)
PY
WSHA=$(shasum -a 256 build/Istiqamah-windows.zip | awk '{print $1}')
# New file names, plus the old names so links people already shared keep working.
cp build/Istiqamah-mac.zip build/Daimun-mac.zip
cp build/Istiqamah-windows.zip build/Daimun-windows.zip

# The website: the web app as it is now. update.json keeps the previous version until the release exists.
rm -rf docs.tmp && mkdir docs.tmp
rsync -a --exclude '.DS_Store' web/ docs.tmp/
[ -f docs/update.json ] && cp docs/update.json docs.tmp/update.json
touch docs.tmp/.nojekyll
rm -rf docs && mv docs.tmp docs

git add -A
git commit -q -m "Da’imun $VERSION" -m "$NOTES" -m "$TRAILER"
git push -q origin main

"$GH" release create "v$VERSION" build/Daimun-mac.zip build/Daimun-windows.zip build/Istiqamah-mac.zip build/Istiqamah-windows.zip --repo "$REPO" --title "Da’imun $VERSION" --notes "$NOTES"

# Now tell the apps.
python3 - "$VERSION" "$BUILD" "$SHA" "$NOTES" "$REPO" "$WSHA" > docs/update.json <<'EOF'
import json, sys
version, build, sha, notes, repo, wsha = sys.argv[1:7]
base = f"https://github.com/{repo}/releases/download/v{version}/"
print(json.dumps({
    "app": {"version": version, "build": int(build), "sha256": sha, "notes": notes, "url": base + "Daimun-mac.zip"},
    "windows": {"version": version, "build": int(build), "sha256": wsha, "notes": notes, "url": base + "Daimun-windows.zip"},
}, indent=2))
EOF
git add docs/update.json
git commit -q -m "Announce Da’imun $VERSION to the apps" -m "$TRAILER"
git push -q origin main
echo "Published $VERSION. Apps pick it up within a few hours, or straight away with Check for updates."
