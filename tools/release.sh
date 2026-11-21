#!/bin/bash
# Publish a new Istiqamah version. Everyone's Mac app updates itself, and the website updates too.
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
echo "Istiqamah $VERSION (build $BUILD)"

bash build.sh
SHA=$(shasum -a 256 build/Istiqamah-mac.zip | awk '{print $1}')

# The website: the web app as it is now. update.json keeps the previous version until the release exists.
rm -rf docs.tmp && mkdir docs.tmp
rsync -a --exclude '.DS_Store' web/ docs.tmp/
[ -f docs/update.json ] && cp docs/update.json docs.tmp/update.json
touch docs.tmp/.nojekyll
rm -rf docs && mv docs.tmp docs

git add -A
git commit -q -m "Istiqamah $VERSION" -m "$NOTES" -m "$TRAILER"
git push -q origin main

"$GH" release create "v$VERSION" build/Istiqamah-mac.zip --repo "$REPO" --title "Istiqamah $VERSION" --notes "$NOTES"

# Now tell the apps.
python3 - "$VERSION" "$BUILD" "$SHA" "$NOTES" "$REPO" > docs/update.json <<'EOF'
import json, sys
version, build, sha, notes, repo = sys.argv[1:6]
print(json.dumps({"app": {
    "version": version, "build": int(build), "sha256": sha, "notes": notes,
    "url": f"https://github.com/{repo}/releases/download/v{version}/Istiqamah-mac.zip",
}}, indent=2))
EOF
git add docs/update.json
git commit -q -m "Announce Istiqamah $VERSION to the apps" -m "$TRAILER"
git push -q origin main
echo "Published $VERSION. Apps pick it up within a few hours, or straight away with Check for updates."
