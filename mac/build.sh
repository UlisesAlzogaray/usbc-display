#!/bin/bash
# Builds the Mac side. Uses Apple's command line developer tools (clang).
set -e
cd "$(dirname "$0")"
clang -fobjc-arc -O2 -Wall -mmacosx-version-min=12.3 usbc-display.m -o usbc-display \
  -framework AppKit -framework ScreenCaptureKit -framework CoreMedia -framework CoreVideo -framework VideoToolbox -framework IOKit -framework Metal -framework MetalPerformanceShaders -framework Accelerate -framework ColorSync -framework ApplicationServices -lcompression

# Sign with a stable identity so the Screen Recording permission survives rebuilds
# (setup-signing.sh); fall back to an ad-hoc signature if that isn't possible.
KEYCHAIN="$HOME/Library/Keychains/usbc-display-signing.keychain-db"
if bash setup-signing.sh && security unlock-keychain -p usbc-display "$KEYCHAIN" &&
   codesign --force --sign "USB-C Display Local Signing" --keychain "$KEYCHAIN" \
            --identifier com.usbc-display.sender usbc-display 2>/dev/null; then
    echo "Signed with the local certificate."
else
    codesign --force --sign - --identifier com.usbc-display.sender usbc-display
    echo "Signed ad-hoc: Screen Recording will need approving again after each build."
fi
chmod +x "Start USB-C Display.command"
echo "Built ./usbc-display"
