# USB-C Display Setup (Windows)

`USB-C Display Setup.exe` is the one thing anyone downloads. It runs on the Windows laptop and
guides both machines from there; the Mac gets its app from the laptop, over the cable, never
from the internet. `CONTRACT.md` defines how it talks to the wizard screens (`ui/`) and to the
Mac app.

## How it works

- **Window.** WinForms with a WebView2 that fills it. No title bar of its own: Mica shows through
  a transparent page (Windows 11 22H2 and later; older builds get `no-mica` on `<html>` and the
  page paints a solid background). The page gets the accent colours as CSS variables on
  `<html>`: `--accent` is the shade Windows 11 fills buttons with for the current theme,
  `--accent-system` the colour picked in Settings, plus `--accent-light-1..3` and
  `--accent-dark-1..3`. Also `window.usbcHost = { mica, dark, windowsBuild }`. Elements with CSS `app-region: drag` move the window (`app-region: no-drag`
  for buttons inside them); `{cmd: 'startDrag'}` on mouse-down does the same for pages that
  can't use it. The screens are `ui/**`, built into the exe and served from
  `https://setup.usbc-display.example/`.
- **State.** The app posts the whole state (CONTRACT.md section 2) whenever something changes, at
  most ten times a second. Extra fields beyond the contract: `laptop.missingPayload`,
  `laptop.installError`, `laptop.installing`, `server.usingFallback`, `screen.error`. Mac
  `status` keeps its last values while the Mac app is away (relaunching, say); check
  `mac.reachable`. `screen.pointerOnLaptop` is always false: the receiver doesn't report it yet.
- **Install** copies the app, the screen receiver (`UsbcDisplay.exe`), the tray watcher
  (`UsbcWatcher.exe`) and the Mac app (`USB-C-Display.zip`) to
  `%LOCALAPPDATA%\Programs\USB-C Display`, starts the watcher at login, and adds a Start menu
  entry and an entry in Settings > Apps (which runs `--uninstall`). No admin rights. When it ran
  from somewhere else (Downloads), it then **restarts from the installed copy**: the new window
  opens in the same place and the old one closes. The page reloads with `laptop.installed` true;
  `localStorage` survives (same origin, same profile), so the page can keep its place. A
  downloaded copy started again after an earlier install reports `laptop.installed` false, so
  the install step runs again (updating the files) and hands over the same way.
- **The cable.** The USB4 P2P network adapter going up is "plugged in". The Mac is found in the
  neighbour table (IPv6 link-local, and its 169.254 address once it has one), like the receiver.
- **The Mac's download.** Once the link is up and the admin step is done, the installed copy
  (the program the firewall rule names; a copy anywhere else never listens) starts a small web server
  listens on port 80 on the laptop's cable addresses only, and answers only peers on the
  cable: `/`, `/USB-C-Display.zip` and `/icon.png` (the page is `web/index.html`). A small mDNS
  responder answers `usbc.local` on the cable only. `server.urlReady` turns true once the Mac
  is on the link. If Safari hasn't asked for anything 30 s later, `server.url` switches to
  `http://<laptop's 169.254 address>`, but only after the Mac has an IPv4 address too.
- **The Mac app.** The app connects to the Mac's port 48100 over the cable and asks for its
  status (CONTRACT.md section 1), again every 2 s if it isn't there. An app that closes the
  connection on the question is an older build: `mac.outdated`.
- **The screen.** `startScreen` runs the installed receiver with the saved size, colour and input
  settings, as the watcher does, and watches for its "Showing" line.
- **After setup.** `finish` sets `SetupDone`. Until then, plugging in the cable makes the watcher
  open this app instead of its "Use as a screen / Data transfer" popup.

## Permissions

| Where | What | Why | Without it |
|---|---|---|---|
| This laptop, Windows admin (one UAC prompt) | Firewall rules "USB-C Display (cable only)": TCP 80 and UDP 5353 in, only from link-local addresses (the cable), only for this app | The Mac downloads its app from this laptop and finds it as `usbc.local` | The Mac can't reach the laptop, so it can't get the app |
| Same prompt | Tasks `\USB-C Display\Restart USB4 link` and `...network adapter`: each runs one fixed `pnputil /restart-device` as SYSTEM; your account may start them, not change them | Restarts a stuck cable connection silently (see the main README) | Each freeze needs an admin prompt or replugging the cable |
| Mac | Screen & System Audio Recording | Sends the Mac's picture to the laptop | A black screen |
| Mac | Accessibility (optional) | This laptop's trackpad and keyboard control the Mac | Use the Mac's own mouse and keyboard |
| Mac | Login item | The Mac side is ready whenever the cable goes in | Open the app by hand each time |

The admin step relaunches this exe through UAC with `--elevated <your SID>`, which does only the
two things above. `laptop.elevation` is `done` when the firewall rules are in place and, on a
laptop where a USB4 router was found, both tasks too (with no router there is nothing to
restart). `laptop.firewallOk` is the part the Mac's download needs; the app checks it through
the Windows Firewall API, so the Windows language and folder names don't matter. If it's declined, the app still starts its web server; Windows may then ask
itself whether to allow it.

## Building

From the Mac (or anywhere with the .NET 8 SDK):

```sh
tools/build-windows.sh            # win-arm64 (Snapdragon): windows/setup/dist/USB-C Display Setup.exe
tools/build-windows.sh x64        # Intel and AMD:          windows/setup/dist/x64/USB-C Display Setup.exe
APP_NOTARIZED=true tools/build-windows.sh   # override mac/dist/notarized.txt (written by mac/build.sh)
```

It builds the receiver (self-contained), the watcher (.NET Framework 4.8), takes
`mac/dist/USB-C-Display.zip` if `mac/build.sh` made it (with its icon, copied to `web/icon.png`,
and its notarization result), and builds the setup with all three inside (`payload/`). Anything missing is left out and listed in `laptop.missingPayload`. A
build without `ui/index.html` shows a placeholder page with the raw state.

`USBC_SETUP_DEVTOOLS=1` turns on the WebView2 developer tools. The log is
`%LOCALAPPDATA%\UsbcDisplay\setup.log`.
