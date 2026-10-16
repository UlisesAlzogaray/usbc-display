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
# without the "unidentified developer" detour. Without them it's signed with this Mac's local
# certificate (setup-signing.sh), and macOS 15 and later then make people approve it in System
# Settings: fine for testing, not for shipping.
#
# Signing never falls back by itself. macOS ties Screen Recording and Accessibility to the
# signing certificate: a build signed ad-hoc (or with a new certificate) leaves entries in System
# Settings that belong to another signature, so turning their switches on does nothing for the
# app ("the keyboard and trackpad permission didn't work"). If the signature can't be the stable
# one, the build stops; ALLOW_ADHOC=1 builds an ad-hoc copy anyway (testing only).
# USBC_OPENED_PING=1 compiles the app's optional "opened" ping to the PC's setup (off by default).
set -e
cd "$(dirname "$0")"
FRAMEWORKS="-framework AppKit -framework WebKit -framework ScreenCaptureKit -framework CoreMedia -framework CoreVideo -framework VideoToolbox -framework IOKit -framework Metal -framework MetalPerformanceShaders -framework Accelerate -framework ColorSync -framework ApplicationServices -framework ServiceManagement -lcompression"
DEFINES=""
[ "$USBC_OPENED_PING" = 1 ] && DEFINES="-DUSBC_OPENED_PING"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# A build that stops leaves no app behind that could pass for this one.
rm -rf "dist/USB-C Display.app" dist/USB-C-Display.zip

# Sign with a stable identity so the permissions survive rebuilds: a Developer ID, or the local
# certificate setup-signing.sh made once on this Mac (it never makes a new one by itself).
# Checked before compiling, so a build that can't be signed stops at once.
KEYCHAIN="$HOME/Library/Keychains/usbc-display-signing.keychain-db"
LOCAL_NAME="USB-C Display Local Signing"
MODE=adhoc
if [ -n "$DEVELOPER_ID" ]; then
    MODE=developer
elif bash setup-signing.sh && security unlock-keychain -p usbc-display "$KEYCHAIN"; then
    MODE=local
elif [ "$ALLOW_ADHOC" != 1 ]; then
    echo "error: the local signing certificate \"$LOCAL_NAME\" isn't usable (see above), so the build stops." >&2
    echo "error: an ad-hoc build would leave privacy entries that don't match the app. ALLOW_ADHOC=1 builds one anyway." >&2
    exit 1
fi

# Built aside and moved into place, so a running agent keeps its own copy until it restarts.
# For Apple silicon and Intel Macs both (warnings show once per kind of Mac).
clang -fobjc-arc -O2 -Wall -mmacosx-version-min=12.3 -arch arm64 -arch x86_64 $DEFINES usbc-display.m -o "$TMP/usbc-display" $FRAMEWORKS

sign() {  # sign PATH: the same identifier everywhere, so macOS keeps the permissions
    case $MODE in
        developer) codesign --force --sign "$DEVELOPER_ID" --options runtime --timestamp --identifier com.usbc-display.sender "$1" ;;
        local) codesign --force --sign "$LOCAL_NAME" --keychain "$KEYCHAIN" --identifier com.usbc-display.sender "$1" ;;
        *) codesign --force --sign - --identifier com.usbc-display.sender "$1" ;;
    esac
}
signed() {  # signed PATH: stop the build unless PATH is signed as intended
    if ! sign "$1"; then
        echo "error: signing $1 failed, so the build stops (ALLOW_ADHOC=1 builds an ad-hoc copy for testing)." >&2
        exit 1
    fi
}
signed "$TMP/usbc-display"
case $MODE in
    developer) echo "Signed with $DEVELOPER_ID." ;;
    local) echo "Signed with the local certificate ($(codesign -dr - "$TMP/usbc-display" 2>&1 | grep -o 'leaf = H"[0-9a-f]*"'))." ;;
    *) echo "warning: signed ad-hoc (ALLOW_ADHOC=1): Screen Recording and Accessibility need approving again, and old entries won't match." ;;
esac
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
# The laptop's setup screens, for the same window on the Mac's new screen when the picture starts.
if [ -f ../windows/setup/ui/index.html ]; then
    mkdir -p "$APP/Contents/Resources/setup-ui"
    cp -R ../windows/setup/ui/. "$APP/Contents/Resources/setup-ui/"
else
    echo "windows/setup/ui not found: the app won't open the setup's window on the new screen"
fi

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

# The optional ping asks for http://usbc.local: allowed for local names only.
PING_PLIST=""
[ "$USBC_OPENED_PING" = 1 ] && PING_PLIST="    <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
"
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key><string>com.usbc-display.sender</string>
    <key>CFBundleName</key><string>USB-C Display</string>
    <key>CFBundleDisplayName</key><string>USB-C Display</string>
    <key>LSHasLocalizedDisplayName</key><true/>
    <key>CFBundleDevelopmentRegion</key><string>en</string>
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
    <key>NSHumanReadableCopyright</key><string>© 2026 USB-C Display</string>
$PING_PLIST</dict>
</plist>
EOF

# The name macOS shows for the app: "USB-C Display", not the file's "USB-C Display.app", in the
# privacy prompts and lists, the "Open Anyway" texts and Finder (LSHasLocalizedDisplayName above).
# Inside the bundle, so it's signed with it and survives the zip; the file name must stay
# "USB-C Display.app" to match.
mkdir -p "$APP/Contents/Resources/en.lproj"
cat > "$APP/Contents/Resources/en.lproj/InfoPlist.strings" <<'EOF'
"CFBundleDisplayName" = "USB-C Display";
"CFBundleName" = "USB-C Display";
EOF

# The login agent as versions before 3 registered it (SMAppService). Not used any more, but the
# app needs it in the bundle to switch that registration off; its own agent is now a plist in
# ~/Library/LaunchAgents that names the program by its path (com.usbc-display.agent).
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

signed "$APP"
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
