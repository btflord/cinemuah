#!/usr/bin/env bash
# Builds CineLocal for Apple Silicon Macs: the .app (ad-hoc signed) and a drag-to-install DMG.
#
# Apple Silicon refuses to run unsigned binaries, so the app is ad-hoc signed *before* it goes
# into the DMG, and the DMG is made from that already-signed app (--prepackaged).
# Output: release/mac-arm64/CineLocal.app and release/CineLocal-<version>-mac-arm64.dmg
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export CSC_IDENTITY_AUTO_DISCOVERY=false

echo "▸ Building the app"
npm run build

echo "▸ Packaging CineLocal.app"
rm -rf release/mac-arm64
./node_modules/.bin/electron-builder --mac dir --arm64

echo "▸ Ad-hoc signing"
codesign --force --deep -s - release/mac-arm64/CineLocal.app
codesign --verify --deep release/mac-arm64/CineLocal.app

echo "▸ Building the DMG"
rm -f release/CineLocal-*-mac-arm64.dmg*
./node_modules/.bin/electron-builder --mac dmg --arm64 --prepackaged release/mac-arm64/CineLocal.app

echo "✓ Done:"
ls -lh release/*.dmg
