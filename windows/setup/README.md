# USB-C Display Setup (Windows)

`USB-C Display Setup.exe` is the one thing anyone downloads. It runs on the Windows PC and
guides both computers from there; the Mac gets its app from this PC, over the cable, never from
the internet. `CONTRACT.md` defines how it talks to the wizard screens (`ui/`) and to the Mac
app; the screens, copy and motion are in the build spec (design/SPEC.md).

## The flow

One quiet Mac window that always shows the next thing to do and where to do it. The person
clicks **Continue** once on this PC and answers Windows' **Yes** once; from then on the window
follows the Mac by itself. Whatever the computers do alone is one grey status line at the bottom
left. A first-time run (Mac app not notarized, cable not yet connected) shows eight titles:

| # | Screen (sub-states) | Where | On this PC | On the Mac |
|---|---|---|---|---|
| 1 | Use This PC as a Display (`welcome`) | this PC | **Continue** | |
| 2 | Allow Changes on This PC (`allow-pc`: installing → waiting → pending → working → done, the hand-off) | this PC | Windows' **Yes** | |
| 3 | Connect Your Mac (`connect`: cable → finding) | this PC | connect the cable | maybe **Allow** (accessory) |
| 4 | Get USB-C Display on Your Mac (`get-app`: address → download → allow-downloads → downloading) | a picture of the Mac | | Safari, type `usbc.local`, **Download**, maybe **Allow** |
| 5 | Open USB-C Display on Your Mac (`open-app`: one screen, `steps`, until the Mac app answers: one story picture over three numbered steps; notarized: downloads → confirm) | a picture of the Mac | | Downloads, the zip, the app, **Done**, **Open Privacy & Security**, **Allow**, **Open Anyway**, **Open Anyway** again, Touch ID |
| 6 | Allow Screen Recording on Your Mac (`allow-screen`: prompt → settings → reopen) | a picture of the Mac | | **Open System Settings**, the switch, Touch ID, maybe **Quit & Reopen** |
| 7 | Use This PC’s Keyboard and Trackpad (`keyboard`: offer; then `allow-control` if yes) | this PC, then the Mac | **Continue** or **Not Now** | **Open System Settings**, the switch, Touch ID |
| 8 | USB-C Display Is Ready to Use (`ready`: starting → cut → showing) | this PC, then the Mac's copy | | move the pointer onto this display, **Done** |

Screens the person doesn't need are skipped (a set-up Mac goes straight to Ready). Going back
to an earlier screen needs the condition to last 3 s, so a blip never jumps back. Closing the
window mid-way loses nothing: the place in setup is kept by the host (below), and the next run
opens on the first screen still needed.

## How the host works

- **Window.** A Mac window from the first frame, so the Mac's copy after the handover is the same
  window: an 800 × 600 pt OnBoardingKit window (16 pt continuous corners, transparent 32 pt
  title band with no title, traffic lights: close and minimise work, zoom disabled). It is
  800·f × 600·f panel pixels, where f is the Mac display's scale (`settings.scale` / 100: the
  saved `Scale`, else the recommended one), so after the handover the Mac's copy is exactly
  800 × 600 pt at the same spot. Only a window that wouldn't fit is scaled down evenly: in the
  work area, and on this PC's own panel also below the 40 pt menu bar the Mac draws there, so
  the Mac's copy never loses its bottom edge or shadow (the page follows through `--mpt`). WinForms with a WebView2 that fills it, on a transparent canvas
  (`WS_EX_NOREDIRECTIONBITMAP`, no DWM backdrop, corners, border or shadow): the page draws the
  window itself, sized in Mac points (`--mpt`), and outside its corners the desktop shows.
  `MacShadow` draws the shadow macOS gives the Mac's copy (a borderless window: the same shadow
  whether active or not, Gaussian σ 8 pt, 4 pt down, alpha .31 dark / .26 light, plus a 0.5 pt
  rim; measured on macOS 27.0.1) in a click-through layered window just below it, in the theme
  the page sends (`chrome`). The page's colours are macOS's; the host passes no Windows accent.
- **Reveal.** The window opens cloaked (`DWMWA_CLOAK`) and appears whole, with its shadow, when
  the page posts `shown` (after the checks, the first real render and the fonts), or after 5 s
  anyway (15 s for the installed copy taking over, whose old window stays up meanwhile). There
  is never a half-drawn window. The shadow is drawn while the window is still cloaked, so it
  appears with the window. While it's open the display stays on.
- **State.** The host posts the whole state (CONTRACT.md section 2) whenever something changes,
  at most ten times a second. The page is `render(view(S, L))`.
- **The place in setup** is in `HKCU\Software\USB-C Display` (`SetupStarted`, `AxChoice`,
  `LoginSkip`, `ElevationAsked`, `ElevationResult`, `SetupDone`), never in the page's storage,
  so a restart from the installed copy, a lost WebView2 profile or a later run never shows
  Welcome again.
- **Continue (`setUp`)** installs, asks Windows once, then hands off, as one single-flight step:
  1. **Install** copies the app, the display receiver (`UsbcDisplay.exe`), the tray watcher
     (`UsbcWatcher.exe`) and the Mac app (`USB-C-Display.zip`) to
     `%LOCALAPPDATA%\Programs\USB-C Display`, starts the watcher at login, and adds a Start menu
     entry and an entry in Settings > Apps (which runs `--uninstall`). No admin rights.
     Uninstalling asks first (**Remove** / **Cancel**, Cancel the default), then asks Windows
     for permission to remove the firewall rules and tasks. If Windows doesn't get permission,
     the rest goes, but the Settings > Apps entry and the setup exe stay, so removing USB-C
     Display again can remove the rules and tasks too.
  2. **Windows' prompt** comes no earlier than 3.0 s after Continue (and 0.7 s after the
     install), from the downloaded copy, which is still in front: "click **Yes**" has been on
     screen long enough to read. The prompt belongs to the setup window, so Windows puts it in
     front. After a **No** the host never asks again by itself, in this run or later
     (`ElevationAsked`); **Try Again** asks.
  3. **The hand-off.** A copy outside the install folder then starts the installed copy (the
     program the firewall rule names) with `--hold` and its current frame, traffic lights
     included. The new window opens cloaked, exactly underneath, with its shadow already drawn.
     It paints the same frame and uncloaks. The old copy hands it the foreground (so no other
     app's window comes up in between), then hides its window and its shadow in one step and
     closes. The new one shows its shadow the moment the old window has gone: nothing on screen
     changes, apart from one frame without a shadow. It holds that frame until it has looked at
     everything itself, then moves on normally. A downloaded copy run again later never shows
     Welcome: it installs (updating the files) and hands off the same way.
- **The cable.** The USB4 P2P network adapter going up is "plugged in". The Mac is found in the
  neighbour table (IPv6 link-local, and its 169.254 address once it has one), like the receiver.
  A cable link also proves this PC has USB4, whatever the check at start found.
- **The Mac's download.** Once the link is up and the admin step is done, the installed copy
  starts a small web server on port 80 on this PC's cable addresses only, answering only peers
  on the cable: `/`, `/USB-C-Display.zip`, `/icon.png` and `/event` (the page is
  `web/index.html`, with the app's size and version filled in). A small mDNS responder answers
  `usbc.local` on the cable only. `server.urlReady` turns true once the Mac is on the link;
  `server.error = 'port'` if another program holds port 80. The page in Safari reports its focus,
  the Download and Privacy & Security clicks and the Mac's look, so the window follows what the
  person does in Safari without seeing the Mac's screen. While the Mac app is being opened, only
  the clicks count (the first two steps are checked once Open Privacy & Security is clicked, and
  stay checked): Safari's focus is too noisy to steer the screen.
- **The Mac app.** The host connects to the Mac's port 48100 over the cable and asks for its
  status (CONTRACT.md section 1), again every 2 s if it isn't there; the Mac reports every change
  within about a quarter second. An app that closes the connection on the question is an older
  build: `mac.outdated`.
- **The display and the handover.** On Ready, the page starts the display once, if this window
  is in front. The host brings the window forward onto this PC's own panel, clear of the Mac's
  menu bar, saves the display settings (recommended size and matched colours unless chosen
  before; this PC's keyboard and trackpad only if the Mac allows it and the person didn't say
  Not Now), and the Mac opens the same window at the same place on its new display (CONTRACT.md
  section 5). When the receiver says "Picture on screen", only what's behind the window has
  changed; the host saves `SetupDone` and gives the receiver the keyboard. The person clicks
  **Done** on the Mac's copy with the Mac's pointer, on this PC's panel. Return to Windows (or
  Ctrl-Alt-Esc) stops the receiver first, so Windows comes back with this window already in
  place, then closes the Mac's copy.
- **After setup.** **Done** closes both copies and starts the tray watcher; the Mac desktop stays.
  From then on, connecting the cable starts the display by itself. Before `SetupDone`, plugging
  in the cable opens this app instead (the watcher leaves the cable alone while setup is open).

## Permissions

| Where | What | Why | Without it |
|---|---|---|---|
| This PC, Windows admin (one prompt) | Firewall rules "USB-C Display (cable only)": TCP 80 and UDP 5353 in, only from link-local addresses (the cable), only for this app | The Mac downloads its app from this PC and finds it as `usbc.local` | The Mac can't reach this PC, so it can't get the app |
| Same prompt | Tasks `\USB-C Display\Restart USB4 link` and `...network adapter`: each runs one fixed `pnputil /restart-device` as SYSTEM; your account may start them, not change them | Restarts a stuck cable connection silently (see the main README) | Each freeze needs an admin prompt or reconnecting the cable |
| Mac | Screen & System Audio Recording | Sends the Mac desktop to this PC | A black display |
| Mac | Device Control and Data Access (Accessibility), optional | This PC's keyboard and trackpad control the Mac | Use the Mac's own pointer and keyboard |
| Mac | Login item | The Mac side is ready whenever the cable goes in | Open the app by hand each time |

The admin step relaunches this exe through Windows' prompt with `--elevated <your SID>`, which
does only the two things above. `laptop.elevation` is `done` when the firewall rules are in place
and, on a PC where a USB4 router was found, both tasks too (with no router there is nothing to
restart). `laptop.firewallOk` is the part the Mac's download needs; the app checks it through
the Windows Firewall API, so the Windows language and folder names don't matter. If the tasks
alone fail, setup goes on silently (logged). The same holds on a later run when a task goes
missing after a successful admin step, as happens on PCs that list their USB4 router only once
the cable is in. With the firewall rules still in place, setup doesn't ask again; with them
gone, it asks again. If the prompt is declined, the app still starts its
web server; Windows may then ask itself whether to allow it.

## Building

From the Mac (or anywhere with the .NET 8 SDK):

```sh
tools/build-windows.sh            # win-arm64 (Snapdragon): windows/setup/dist/USB-C Display Setup.exe
tools/build-windows.sh x64        # Intel and AMD:          windows/setup/dist/x64/USB-C Display Setup.exe
APP_NOTARIZED=true tools/build-windows.sh   # override mac/dist/notarized.txt (written by mac/build.sh)
```

It builds the receiver (self-contained), the watcher (.NET Framework 4.8), takes
`mac/dist/USB-C-Display.zip` if `mac/build.sh` made it (with its icon, copied to `web/icon.png`,
and its notarization result), and builds the setup with all three inside (`payload/`). Anything
missing is left out and listed in `laptop.missingPayload` (the window then says the copy is
incomplete). A build without `ui/index.html` shows a placeholder page with the raw state.
`-p:MacAppVersion=N` sets the Mac app version reported when the zip's Info.plist can't be read
(default 5).

`USBC_SETUP_DEVTOOLS=1` turns on the WebView2 developer tools. The logs are
`%LOCALAPPDATA%\UsbcDisplay\setup.log` and `receiver.log`.
