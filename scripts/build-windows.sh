#!/usr/bin/env bash
# Builds the Windows installer and portable .exe from macOS (or Linux).
#
# The dev machine's node_modules has native binaries for *its* OS, so the app is staged in a
# temporary folder with Windows production dependencies, then the Windows builds of the two
# binaries that aren't shipped as prebuilds are fetched: ffmpeg.exe and node-datachannel.
#
# Output: release/windows/CineLocal-Setup-<version>.exe and CineLocal-<version>-portable.exe
set -euo pipefail

APP_NAME="${APP_NAME:-CineLocal}"   # same name as the macOS app (CineLocal.app)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ELECTRON_VERSION="$(node -p "require('$ROOT/node_modules/electron/package.json').version")"

echo "▸ Building the app"
(cd "$ROOT" && npm run build)

echo "▸ Staging with Windows dependencies in $STAGE"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$STAGE/"
rsync -a --exclude '*.sqlite' "$ROOT/dist" "$ROOT/dist-electron" "$ROOT/public" "$STAGE/"
(cd "$STAGE" && npm ci --omit=dev --ignore-scripts --os=win32 --cpu=x64 --no-audit --no-fund)

echo "▸ Fetching Windows binaries"
(cd "$STAGE/node_modules/ffmpeg-static" && npm_config_platform=win32 npm_config_arch=x64 node install.js)
(cd "$STAGE/node_modules/node-datachannel" && npx --yes prebuild-install@7 -r napi --platform win32 --arch x64)

echo "▸ Packaging (Electron $ELECTRON_VERSION)"
(cd "$ROOT" && CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder \
  --projectDir "$STAGE" --win nsis portable --x64 \
  -c.electronVersion="$ELECTRON_VERSION" -c.npmRebuild=false -c.productName="$APP_NAME" \
  -c.directories.output=release-win -c.win.icon=public/cinelocal.ico \
  -c.nsis.artifactName="$APP_NAME"'-Setup-${version}.${ext}' \
  -c.portable.artifactName="$APP_NAME"'-${version}-portable.${ext}' \
  -c.nsis.shortcutName="$APP_NAME")

rm -rf "$ROOT/release/windows" && mkdir -p "$ROOT/release/windows"
cp "$STAGE"/release-win/*.exe "$ROOT/release/windows/"
echo "✓ Done:"
ls -lh "$ROOT/release/windows/"
