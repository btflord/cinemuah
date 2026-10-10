#!/bin/bash
# CineLocal: first-launch helper.
# macOS marks apps downloaded from the internet as "quarantined". CineLocal isn't signed with
# a paid Apple Developer ID, so macOS refuses to open it (sometimes calling it "damaged").
# This removes that mark from CineLocal only, then opens it. Nothing else on your Mac changes.

APP="/Applications/CineLocal.app"

clear 2>/dev/null || true
echo ""
echo "  CineLocal · first-launch setup"
echo "  ──────────────────────────────"
echo ""

if [ ! -d "$APP" ]; then
  echo "  CineLocal isn't in your Applications folder yet."
  echo "  Drag the CineLocal icon onto the Applications folder in the installer window,"
  echo "  then double-click this file again."
  echo ""
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi

echo "  Allowing CineLocal to open…"
if ! xattr -dr com.apple.quarantine "$APP" 2>/dev/null; then
  # Installed by another user account: removing the mark needs an administrator password.
  echo "  macOS needs your password to finish (it won't be shown as you type)."
  sudo xattr -dr com.apple.quarantine "$APP" || {
    echo ""
    echo "  Couldn't update CineLocal. You can still open it with: right-click CineLocal in"
    echo "  Applications → Open → Open."
    read -n 1 -s -r -p "  Press any key to close."
    exit 1
  }
fi

echo "  Opening CineLocal…"
open "$APP"
echo ""
echo "  All set. You only need to do this once. You can close this window."
echo ""
