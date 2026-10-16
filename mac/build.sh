#!/bin/bash
# Builds the Mac side. Uses Apple's command line developer tools (clang).
#   ./usbc-display                 the bare program (install-agent.sh, Start USB-C Display.command)
#   dist/USB-C Display.app         the app people install; the laptop serves it over the cable
#   dist/USB-C-Display.zip         that app, zipped for the laptop's setup (windows/setup)
#   dist/icon.png                  its icon, for the laptop's download page
#   dist/notarized.txt             "true" when notarized (the laptop's setup reads it at build time)
#
# Notarization (optional): with a Developer ID certificate in your keychain and a notarytool
# profile saved once (xcrun notarytool store-credentials NAME ...), run
#   DEVELOPER_ID="Developer ID Application: Your Name (TEAMID)" NOTARY_PROFILE=NAME ./build.sh
# The app is then signed with the hardened runtime, notarized and stapled, so the Mac opens it
# without the "unidentified developer" detour. Without them it's signed locally as before, and
# macOS 15 and later then make people approve it in System Settings: fine for testing, not for
# shipping.
set -e
cd "$(dirname "$0")"
FRAMEWORKS="-framework AppKit -framework ScreenCaptureKit -framework CoreMedia -framework CoreVideo -framework VideoToolbox -framework IOKit -framework Metal -framework MetalPerformanceShaders -framework Accelerate -framework ColorSync -framework ApplicationServices -framework ServiceManagement -lcompression"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# Built aside and moved into place, so a running agent keeps its own copy until it restarts.
# For Apple silicon and Intel Macs both (warnings show once per kind of Mac).
clang -fobjc-arc -O2 -Wall -mmacosx-version-min=12.3 -arch arm64 -arch x86_64 usbc-display.m -o "$TMP/usbc-display" $FRAMEWORKS

# Sign with a stable identity so the Screen Recording permission survives rebuilds
# (setup-signing.sh); fall back to an ad-hoc signature if that isn't possible.
KEYCHAIN="$HOME/Library/Keychains/usbc-display-signing.keychain-db"
LOCAL_ID=no
bash setup-signing.sh && security unlock-keychain -p usbc-display "$KEYCHAIN" && LOCAL_ID=yes
sign() {  # sign PATH: the same identifier everywhere, so macOS keeps the permissions
    if [ -n "$DEVELOPER_ID" ]; then
        codesign --force --sign "$DEVELOPER_ID" --options runtime --timestamp --identifier com.usbc-display.sender "$1"
    elif [ $LOCAL_ID = yes ] && codesign --force --sign "USB-C Display Local Signing" --keychain "$KEYCHAIN" \
                                         --identifier com.usbc-display.sender "$1" 2>/dev/null; then
        :
    else
        codesign --force --sign - --identifier com.usbc-display.sender "$1"
        return 1
    fi
}
if sign "$TMP/usbc-display"; then
    echo "Signed with ${DEVELOPER_ID:-the local certificate}."
else
    echo "Signed ad-hoc: Screen Recording will need approving again after each build."
fi
mv -f "$TMP/usbc-display" usbc-display
chmod +x "Start USB-C Display.command"
echo "Built ./usbc-display"

# ---- The app ----
VERSION=$(sed -n 's/^#define APP_VERSION \([0-9][0-9]*\).*/\1/p' usbc-display.m)
APP="dist/USB-C Display.app"
rm -rf "$APP" dist/USB-C-Display.zip
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Library/LaunchAgents"
cp usbc-display "$APP/Contents/MacOS/usbc-display"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# Icon: drawn by make-icon.m, every size macOS asks for.
clang -fobjc-arc -O2 -Wall -mmacosx-version-min=12.3 make-icon.m -o "$TMP/make-icon" \
    -framework Foundation -framework CoreGraphics -framework ImageIO
"$TMP/make-icon" "$TMP/icon.png" 1024
mkdir "$TMP/AppIcon.iconset"
for s in 16 32 128 256 512; do
    sips -z $s $s "$TMP/icon.png" --out "$TMP/AppIcon.iconset/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$TMP/icon.png" --out "$TMP/AppIcon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"
sips -z 512 512 "$TMP/icon.png" --out dist/icon.png >/dev/null

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key><string>com.usbc-display.sender</string>
    <key>CFBundleName</key><string>USB-C Display</string>
    <key>CFBundleDisplayName</key><string>USB-C Display</string>
    <key>CFBundleExecutable</key><string>usbc-display</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundleShortVersionString</key><string>1.$VERSION</string>
    <key>CFBundleVersion</key><string>$VERSION</string>
    <key>LSMinimumSystemVersion</key><string>12.3</string>
    <key>LSUIElement</key><true/>
    <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSHumanReadableCopyright</key><string>Runs on your Mac and talks only to your laptop, over the USB-C cable.</string>
</dict>
</plist>
EOF

# The login agent, registered by the app itself the first time it's opened (SMAppService).
cat > "$APP/Contents/Library/LaunchAgents/com.usbc-display.sender.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.usbc-display.sender</string>
    <key>BundleProgram</key><string>Contents/MacOS/usbc-display</string>
    <key>ProgramArguments</key><array><string>Contents/MacOS/usbc-display</string><string>--agent</string></array>
    <key>AssociatedBundleIdentifiers</key><array><string>com.usbc-display.sender</string></array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>LimitLoadToSessionType</key><string>Aqua</string>
    <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
EOF

sign "$APP" || true
NOTARIZED=false
if [ -n "$DEVELOPER_ID" ] && [ -n "$NOTARY_PROFILE" ]; then
    ditto -c -k --keepParent "$APP" "$TMP/notarize.zip"
    xcrun notarytool submit "$TMP/notarize.zip" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$APP"
    spctl -a -t exec "$APP" && NOTARIZED=true
fi
ditto -c -k --keepParent "$APP" dist/USB-C-Display.zip
# For the laptop's setup: build it with -p:AppNotarized=$(cat mac/dist/notarized.txt), so it
# shows the "Open Anyway" steps when the Mac will block the app.
echo $NOTARIZED > dist/notarized.txt
echo "Built ./$APP and ./dist/USB-C-Display.zip (version $VERSION, notarized: $NOTARIZED)"
if [ $NOTARIZED = false ]; then
    echo "Not notarized: a Mac that downloads this zip blocks the app until someone clicks"
    echo "Open Anyway in System Settings > Privacy & Security. Set DEVELOPER_ID and NOTARY_PROFILE"
    echo "for any build that goes on the laptop for other people."
fi
