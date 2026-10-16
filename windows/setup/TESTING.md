# Testing setup on real computers

This list walks the whole first run on two fresh computers, then the checks the host must pass,
then Appendix B: everything the design guessed and that only hardware can answer. Tick each box,
and write down what you actually saw when it differs (exact dialog text, button names, timings).
The screens and copy to compare with are in design/SPEC.md (section 3).

## Before you start

**Windows PC**
- [ ] A Windows 11 PC with a USB4 or Thunderbolt port. Note the maker, model, Windows build
      (`winver`), language and display scaling.
- [ ] Nothing of ours on it. In an admin PowerShell:
  - `netsh advfirewall firewall show rule name="USB-C Display (cable only)"` says no rules match
    (delete with `netsh advfirewall firewall delete rule name="USB-C Display (cable only)"`).
  - `schtasks /query /tn "\USB-C Display\"` finds nothing.
  - `%LOCALAPPDATA%\Programs\USB-C Display`, `%LOCALAPPDATA%\USB-C Display` and
    `%LOCALAPPDATA%\UsbcDisplay` don't exist.
  - `HKCU\Software\USB-C Display` doesn't exist.
- [ ] Test once with an **administrator** account and once with a **standard** account.
- [ ] Note the Smart App Control state (Windows Security, App & browser control).

**Mac**
- [ ] A **new user account** (System Settings, Users & Groups), so no permissions are granted.
      Log in to it once and finish the welcome screens. Note the macOS version.
- [ ] Also test once from a standard (non-admin) Mac account.
- [ ] No old copy: no `USB-C Display.app` in /Applications or Downloads for that user.
- [ ] Wi-Fi on (that's normal life), no VPN for the first run. Repeat later with a VPN on.

**What you need**
- The setup from `tools/build-windows.sh` (`windows/setup/dist/USB-C Display Setup.exe` for
  Snapdragon, `dist/x64/` for Intel and AMD), put somewhere it can be downloaded with Edge, so it
  gets the downloaded-file mark like a real download.
- One Thunderbolt or USB4 cable, and one plain USB-C charging cable (for the wrong-cable test).
- Logs to collect after each run:
  - Windows: `%LOCALAPPDATA%\UsbcDisplay\setup.log` and `receiver.log`
  - Mac: `~/Library/Logs/USB-C Display.log`
- Screen recordings of this PC (20 fps is enough) for the hand-off and the handover, and photos
  of every system dialog on both computers. The pictures in the window copy their wording.

## The run, step by step

### 1. Download and open (Windows)
- [ ] Edge download: note any "isn't commonly downloaded" bar and which buttons it shows.
- [ ] SmartScreen: does "Windows protected your PC" appear? Is "Run anyway" there?
- [ ] Smart App Control: if it's on, does it block the unsigned exe with no way through?
- [ ] No WebView2 runtime (Windows 10 or a stripped image only): a dialog with the app's icon,
      “USB-C Display Setup needs Microsoft Edge WebView2, which isn’t on this PC.” and the
      buttons **Download…** and **Cancel** (Cancel the default). Download… opens Microsoft's page.
- [ ] The window appears whole, at once, centred, with its shadow: no empty or half-drawn frame,
      no "Getting ready…", no entrance animation (setup.log: `ui: shown` before the window shows).
- [ ] It is a Mac window: traffic lights at (16,16), (39,16), (62,16) pt, zoom grey, no title
      text, 16 pt continuous corners with the desktop outside them, the edge, the shadow.
      The window is 800·f × 600·f panel pixels (f = the recommended scale; setup.log and
      Spy++/`GetWindowRect`).
- [ ] The shadow is the same whether the window is in front or not (only the lights and the
      primary button go grey).
- [ ] The colours are macOS's (blue until the Mac's accent is known), not Windows' accent.
- [ ] Dragging the window anywhere outside the buttons moves it. Alt+F4 closes it.
- [ ] The display doesn't turn off during a 20-minute idle setup session.
- [ ] Windows 10: the transparent corners and the shadow (DWM corner and border settings don't exist there).

### 2. Use This PC as a Display (Welcome)
- [ ] The USB4 check happens before the window appears. A PC without USB4 shows "Unable to Use
      This PC as a Display" with **Quit**; connecting a working cable turns it into Welcome.
- [ ] Standard account: the second paragraph asks for an administrator of this PC.

### 3. Allow Changes on This PC (install and Windows' prompt)
- [ ] **Continue**: the buttons vanish at once, "Installing…" with the close light greyed, then
      the check with "Installed", then "Waiting for Windows…".
- [ ] Windows' prompt appears **no earlier than 3.0 s after Continue** (setup.log: `ui: setUp`
      then `elevate:`), in front, from the downloaded copy. Note what it shows ("Publisher:
      Unknown" until the exe is signed; the body says so when `laptop.signed` is false).
- [ ] Our status line, "Waiting for you to click Yes…", is readable under Windows' dimmed screen.
- [ ] After 5 s without an answer, the body tells you about the flashing shield in the taskbar.
- [ ] **Yes**: "Setting up this PC…", then the check with "This PC is ready". The rules exist
      (TCP 80 and UDP 5353, inbound, link-local only, program = the installed setup exe) and the
      two tasks exist under `\USB-C Display\`.
- [ ] **No**: "Changes Not Allowed" with **Try Again**. Close setup and open it again: no prompt
      by itself (`ElevationAsked` = 1, `ElevationResult` = 2); **Try Again** asks.
- [ ] Standard account: the prompt asks for an administrator's name and password, as the copy says.
- [ ] Non-English Windows: the firewall check still reports the rules (setup.log has no
      "firewall: can't read the rules").
- [ ] Only the tasks fail (firewall rules in): setup goes on silently; setup.log says why.
- [ ] A PC that lists its USB4 router only with the cable in: Yes before the cable was ever in,
      then plug in, close setup and open it again. No second prompt and no “Allow Changes”
      screen; setup.log says `laptop: a recovery task is missing (router …)`. Delete the firewall
      rules too and open setup again: it asks again (“Click Continue, then click Yes…”).
- [ ] Another copy of USB-C Display is open during the install: "Unable to Install USB-C Display"
      (in use) with **Try Again**.

### 4. The hand-off to the installed copy
- [ ] After "This PC is ready", nothing on screen changes, not even the shadow (a 20 fps recording
      shows no frame without the window and no double shadow; at most one display frame, about
      16 ms, without the shadow, as measured in a two-process simulation), and the close light
      stays grey until the next screen. The close and minimise lights keep their colours through the swap
      (they don't go grey for a moment).
- [ ] No other window (Edge, File Explorer) comes up over setup during the swap, also when setup
      was opened from Edge's downloads.
- [ ] setup.log: the second process starts with `--resume --at … --behind … --hold "allow-pc|done|…|1"`;
      the old one logs `handoff: the installed copy's window is in front`; the new one logs
      `handoff: the downloaded copy's window went after N ms (hidden)` (N well under 100), then
      `setup: hold released`.
- [ ] Slow first start (a cold PC): the old window stays up until the new one has drawn its
      frame (up to 15 s), never an empty window.
- [ ] Then a normal crossfade to the next screen (Connect Your Mac, or further).
- [ ] Start menu entry ("Use this PC as a display for your Mac"), Settings > Apps entry, the
      watcher in the tray, the Run key. The installed setup exe has no `Zone.Identifier` stream
      (`Get-Item -Stream * "<path>"` in PowerShell).
- [ ] Run the downloaded exe again later: never Welcome; "Installing…", then the same hand-off;
      it doesn't start a second server.
- [ ] Delete `%LOCALAPPDATA%\USB-C Display\WebView2` and open setup again: it never shows Welcome
      after Continue.

### 5. Connect Your Mac
- [ ] Connect the cable. "Looking for your Mac…" turns into "Connecting to your Mac…", then the
      next screen. Note the seconds it took.
- [ ] 15 s without a cable: "Make sure your Mac is unlocked…"; 90 s: "Cable Not Detected".
- [ ] Wrong port or charge-only cable: the same, then **Learn More…** helps.
- [ ] The Mac isn't found 40 s after the plug: "Unable to Connect to Your Mac".
- [ ] Port 80 taken (IIS or another http.sys user): "Another app on this PC is using the
      connection…" (`server.error = 'port'`).
- [ ] Unplug for 2 s on a later screen: nothing changes. Unplug for longer: "The cable was
      disconnected…" after 3 s, and back where it was when reconnected.
- [ ] The watcher shows no popup while setup is open.

### 6. Get USB-C Display on Your Mac
- [ ] The picture shows Safari on a Mac, in the Mac's appearance and accent; the big address is
      `usbc.local`. Typing it in Safari opens the page (setup.log: `web: GET /`).
- [ ] 15 s: the `http://` hint; 45 s: the cable IPv4 address, only if it differs.
- [ ] The page's Download click turns the picture to the download (`/event?e=download`); if Safari
      asks to allow downloads, the window says so within a second.
- [ ] The page sends its look (`/event?e=look&dark=…&accent=…`): the window's pictures use it.

### 7. Open USB-C Display on Your Mac
- [ ] One screen from the end of the download until the Mac app answers: the picture plays the
      whole opening as one calm story (Downloads → the zip → the app in Finder → "Not Opened"
      **Done** → a click on Safari's window beside Finder → the page's **Open Privacy & Security**
      → Safari's **Allow** → System Settings' **Open Anyway**, then **Open Anyway** again → Touch
      ID), and the three numbered steps under it never change their words. The step the picture
      is showing is the darker one. The **?** at the bottom right opens "About Opening USB-C
      Display".
- [ ] With Windows' animation effects off (Reduce Motion): the picture shows each click in turn as
      a still, about 5 s each, dissolving from one to the next; the steps follow it.
- [ ] The page: after Download it says to double-click `USB-C-Display.zip`, then `USB-C Display`;
      after the Mac's "Not Opened" it says "Your Mac does this for every app that Apple hasn’t
      verified." under its buttons.
- [ ] Does the picture match the Mac? Safari's Downloads list shows `USB-C-Display.zip` (or the
      app itself, with "Open safe files after downloading" on); double-clicking the zip leaves
      `USB-C Display` in Finder's Downloads window.
- [ ] Click **Open Privacy & Security** on the page: within a second steps 1 and 2 get a check and
      the picture plays only the System Settings part. Going back and forth between Safari and
      System Settings never unchecks them or changes the screen (setup.log `web: GET /event?e=…`).
- [ ] Move to Trash, then Download Again on the page: the steps start over at step 1.
- [ ] Notarized build (when there is one): only "Are you sure you want to open it?" with **Open**.
- [ ] "Login Item Added" notification: when does it appear? Nothing to click.
- [ ] The app opens with no window, moves itself to Applications, and this PC notices within a
      few seconds.

### 8. Allow Screen Recording on Your Mac
- [ ] The Mac's prompt appears by itself, with no click on this PC. The picture follows: prompt →
      System Settings (switch) → password or Touch ID (stays on the same picture while it's up).
- [ ] **Quit & Reopen** (or the app reopening itself): the window stays on this screen (never
      "Open USB-C Display" or "Unable to Connect") until the app answers again.
- [ ] Close the prompt: 6 s later "Screen recording is off…" with **Open System Settings**.

### 9. Use This PC’s Keyboard and Trackpad
- [ ] The offer on this PC. **Not Now**: never asked again (`AxChoice` = 2), Ready has no
      keyboard row, and the receiver starts with `--no-input`.
- [ ] **Continue**: the Mac asks for Device Control and Data Access; turning it on moves on with
      no relaunch. Ready shows the keyboard row; the receiver starts without `--no-input`
      (`Input` = 1).
- [ ] A Mac with a stale permission entry from an older signing certificate (the switch is on but
      the app isn't allowed): the Mac app resets its entry before asking (Mac log), and the
      switch then works.

### 10. USB-C Display Is Ready to Use (the handover)
- [ ] With this window in front, the display starts by itself about 0.65 s after Ready appears.
      With another window in front: "Show Mac Desktop" and the taskbar button flashes.
- [ ] Before the receiver starts, the window comes in front, onto this PC's own panel, at least
      40 pt below the top (setup.log: `screen: window moved …` when it had to move).
- [ ] A scale whose window is taller than the panel allows (e.g. Largest Text, `Scale` 200, on a
      1080p or 1200p panel): setup opens smaller than 800 × 600 pt, evenly, and after the cut
      the Mac's copy has its bottom edge and shadow on the display, below the Mac's menu bar.
- [ ] At the cut, only the background changes to the Mac's wallpaper: the window doesn't move by
      a pixel, the lights and **Done** don't turn grey, the shadow looks the same (20 fps
      recording; compare frames before and after).
- [ ] Within 1 s of "Picture on screen" (receiver.log) the receiver has the keyboard (setup.log:
      `the display has the keyboard`); with input on, typing reaches the Mac.
- [ ] `SetupDone` = 1 in the registry as soon as the Mac desktop shows.
- [ ] 0.8 s after the cut: "Desktop extended"; 1.4 s: the body changes, **Return to Windows** and
      **Done** appear. Moving the Mac's pointer onto this display changes the sentence.
- [ ] **Done** with one click on the Mac's copy (even when it isn't key): both copies close, the
      Mac desktop stays, the watcher is in the tray.
- [ ] **Return to Windows** (or Ctrl-Alt-Esc): Windows comes back with this window already in
      place (no frame without it), then the Mac's copy closes; **Show Mac Desktop** / **Done**.
- [ ] With Screen Recording off at this point: the receiver prints "Refused: screen recording",
      exits with code 3, and the window goes to "Screen recording is off…".
- [ ] No `UsbcDisplay.exe` (delete it from the install folder): "Some files of USB-C Display are
      missing…" with **Quit**.

### 11. After setup
- [ ] Unplug and connect again: the display starts by itself, with no popup.
- [ ] Reboot both: connecting works without opening anything on the Mac.
- [ ] Open setup from the Start menu on a set-up PC and Mac: Ready, and the handover runs once.

## Later and edge cases
- [ ] Mac asleep or locked mid-setup: "Unable to Connect to Your Mac" after 4 s of silence, help
      at 40 s, and on with the next screen when it wakes.
- [ ] Lid closed on the Mac with this PC as its display.
- [ ] A few weeks later: macOS asks again to "Continue to allow" screen recording.
- [ ] Uninstall from Settings > Apps: “Remove USB-C Display from this PC?” with **Remove** and
      **Cancel** (Cancel the default, Esc cancels), the Mac note in the footnote. Remove, then
      Yes in Windows' prompt: “USB-C Display was removed from this PC.”; files, tasks, firewall
      rules, Run key, Start menu entry, the Settings > Apps entry and `HKCU\Software\USB-C Display` gone.
- [ ] Uninstall and click **No** in Windows' prompt: the message says the rules and cable tasks
      stay and how to remove them. The Settings > Apps entry and `USB-C Display Setup.exe` stay
      (nothing else in the folder); uninstalling again asks Windows again and then removes everything.
- [ ] Mac removal: `launchctl bootout gui/$(id -u)/com.usbc-display.agent`, delete
      `~/Library/LaunchAgents/com.usbc-display.agent.plist` and the app, and reset permissions
      (`tccutil reset ScreenCapture com.usbc-display.sender`, same for `Accessibility`).
- [ ] Four setup windows opened and killed in a row: the Mac drops the oldest probe and still answers.
- [ ] A second Mac without the app on a set-up PC: the watcher opens setup at Connect, then Get.

## Host behaviour checks (SPEC 10.5)
- [ ] `localStorage` is never written (grep the UI for `localStorage` and `sessionStorage`: 0 hits).
- [ ] HKCU values exist after each step: `SetupStarted` after Continue, `ElevationAsked` and
      `ElevationResult` after the prompt, `AxChoice` after the keyboard offer, `LoginSkip` after
      Not Now on the login item, `Scale`, `ColorManaged`, `Input` and `SetupDone` after the handover.
- [ ] The prompt appears ≥ 3.0 s after Continue, from the downloaded copy, which is in front. With
      No, there is no prompt on any later launch unless Try Again or Continue is clicked.
- [ ] Input is off unless `axOk && axChoice != 'no'`: the receiver args contain `--no-input` otherwise.
- [ ] The display doesn't sleep during a 20-minute idle setup session.
- [ ] The watcher does nothing on a plug while setup is open. After `SetupDone` it starts the
      display with no popup, and opens setup for a Mac without the app.

## Appendix B. Verify on hardware (the fallbacks are already written)

| # | Verify | If it fails |
|---|---|---|
| V1 | OBK style 3 title y with no image (expected 358) | Adjust the picture variant's title, body and content y together |
| V2 | Safari: does `usbc.local` open without `http://`? Does it show "Not Secure"? | Show `http://usbc.local` as the address; add the footnote (SPEC §8) |
| V3 | Safari focus: the Not Opened alert blurs the page (the page's state C); the page's **Open Privacy & Security** click arrives as `settings` | The window no longer follows focus; only the page's state C and the steps' checks depend on these events |
| V4 | The accessory prompt on a computer-to-computer link, and its exact text | Drop the accessory sentence from `connect`; keep sheet `cable` |
| V5 | The borderless Mac copy's shadow vs `MacShadow` (`SHOT_SHADOW=1`, and this PC's screen before and after the cut) | Retune `MacShadow.Dark` / `Light` |
| V6 | `performWindowDragWithEvent` from a script message | Use `movableByWindowBackground` plus a transparent drag strip in the 32 pt band |
| V7 | macOS 27 notarized open dialog text; the Open Anyway location and its confirmation | Update the `gk-open` and `gk-anyway` replicas word for word |
| V8 | Safari's allow-downloads sheet text | Update `safari-allow-dl` |
| V9 | Window owner names for the Touch ID and password dialogs | Adjust M4; the 6 s rule still prevents most flashes |
| V10 | `AXIsProcessTrusted` turns true live in the agent; input reaches the Mac at the cut | Implement M7 |
| V11 | Does the M6 "opened" ping trigger the Local Network prompt? | Keep it off (default) |
| V12 | "Login Item Added" banner text and timing on 27.0.1 | Update `bg-items` and the `setting-up` caption |
| V13 | Does the self-relaunch leave "Quit & Reopen" hanging, and does clicking it still work? | Raise M2's delay to 6 s |
| V14 | Windows' prompt from the downloaded copy right after the install: it comes to the front (the prompt is owned by the setup window), also for standard accounts | Also call `AllowSetForegroundWindow` and `SetForegroundWindow(self)` before asking |
| V15 | Where the new display is placed, and whether `displaySide` arrives before `settled` | The edge-unknown copy is already written |
| V16 | Inter in WebView2 vs WKWebView: identical line breaks at the cut | Fix `opsz`/`letter-spacing`; shorten any string that breaks differently |
| V17 | Safari `AccentColor` reports the user accent | Send only `dark`; the accent comes from the Mac app at `allow-screen` |
| V18 | `NSApp activate` makes the Mac copy key at the cut | The mirrored-active rule already hides it (and the host doesn't report "inactive" while handed over) |
| V19 | Menu bar height on the virtual display (the 40 pt nudge) | Adjust `SetupWindow.MenuBar` (used by the window size and the handover place) |
| V20 | Mac app firewall prompt and move-password frequency on un-notarized builds | If frequent, say so on the `move` screen or bring back a Learn More… sheet for `open-app` |
| V21 | Opening the zip from Safari's Downloads on 27.0.1: Archive Utility reveals `USB-C Display` in Finder's Downloads window; Finder's sidebar, toolbar and icon-view selection as `finderWin` draws them; with "Open safe files after downloading" on, Safari's list shows the app instead | Redraw `finderWin`; if Finder doesn't come forward, change the story's chapter 1 and `open-app.steps.1` / `open-app.downloads.body` together |

**Already checked**
- [x] Transparent WebView2 on a window without a redirection surface: its alpha reaches the
      desktop (Oct 2026).
- [x] The `http://169.254.x.x` address doesn't open on a Mac on Wi-Fi (Oct 2026): Safari's
      request goes out over Wi-Fi. `usbc.local` did open, so it stays the address to type.
- [x] The handover with Mac app 4: the window stays put and only the background changes; clicks
      in the Mac's copy reach this PC's copy; Done closes the Mac's copy and the Mac desktop stays
      (Oct 2026, 150 % on this PC).
- [x] The Mac app moves itself to Applications from Downloads, clears Safari's download flags,
      sets up its agent, and hands over to an installed copy (Mac app 3, macOS 27.0.1, Oct 2026).
- [x] macOS 27.0.1 gives a borderless window the same shadow whether key or not
      (design/research/borderless-shadow.md). `MacShadow` on this PC (150 %, captured from the
      screen) matches that capture's Gaussian part within 1/255 from 2 pt outward (Oct 2026).

**Still unverified (from building it)**
- [ ] `netsh` accepts the link-local CIDR ranges in `remoteip`.
- [ ] `schtasks` keeps the task's security descriptor (a standard user can run the task but not change it).
- [ ] The firewall check through `HNetCfg.FwPolicy2` works in the .NET 8 single-file exe.
- [ ] Whether `usbc.local` is answered and resolved (our own responder on UDP 5353, cable only),
      and whether the built-in Windows "mDNS (UDP-In)" rule clashes.
- [ ] Which Windows builds and vendors expose the USB4 P2P network adapter.
- [ ] A cloaked WebView2 window keeps rendering (the reveal waits for the page's `shown`).
