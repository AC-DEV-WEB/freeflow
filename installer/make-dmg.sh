#!/bin/bash
# macOS only (npm run dmg): signs FreeFlow.app ad hoc (no Apple Developer
# certificate: Apple Silicon refuses to run unsigned code at all) and wraps it
# in a drag-to-Applications disk image: release/installer/FreeFlow-Mac.dmg
set -euo pipefail
cd "$(dirname "$0")/.."
ARCH="${1:-arm64}"
APP="release/FreeFlow-darwin-$ARCH/FreeFlow.app"
OUT="release/installer"
[ -d "$APP" ] || { echo "missing $APP (run npm run package:mac first)"; exit 1; }

codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/FreeFlow.app"
ln -s /Applications "$STAGE/Applications"
mkdir -p "$OUT"
rm -f "$OUT/FreeFlow-Mac.dmg"
hdiutil create -volname "FreeFlow" -srcfolder "$STAGE" -ov -format UDZO "$OUT/FreeFlow-Mac.dmg"
ls -lh "$OUT/FreeFlow-Mac.dmg"
