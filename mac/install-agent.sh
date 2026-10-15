#!/bin/bash
# Runs the Mac side at every login, in the background. It sits idle until the Windows
# laptop asks for the screen, so you never have to start it by hand.
#   bash install-agent.sh            install (or reinstall after rebuilding) and start it
#   bash install-agent.sh --remove   stop it and stop starting it at login
set -e
cd "$(dirname "$0")"
LABEL=com.usbc-display.sender
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ "$1" = "--remove" ]; then
    rm -f "$PLIST"
    echo "Removed. USB-C Display no longer starts at login."
    exit 0
fi

[ -x usbc-display ] && [ usbc-display -nt usbc-display.m ] || bash build.sh
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key><array><string>$PWD/usbc-display</string></array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>LimitLoadToSessionType</key><string>Aqua</string>
    <key>ProcessType</key><string>Interactive</string>
    <key>StandardOutPath</key><string>$PWD/usbc-display.log</string>
    <key>StandardErrorPath</key><string>$PWD/usbc-display.log</string>
</dict>
</plist>
EOF
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Installed: USB-C Display now runs in the background at every login (log: $PWD/usbc-display.log)."
echo "The first time, macOS asks to allow usbc-display under Privacy & Security > Screen Recording."
