# Testing setup on real machines

Nothing in setup has run on real hardware yet. This list walks the whole first run on two fresh
machines and names everything that was only guessed from research. Tick each box, and write down
what you actually saw when it differs (exact dialog text, button names, timings).

## Before you start

**Windows laptop**
- [ ] A Windows 11 laptop with a USB4 or Thunderbolt port. Note the maker, model, Windows build
      (`winver`) and language.
- [ ] Nothing of ours on it. In an admin PowerShell:
  - `netsh advfirewall firewall show rule name="USB-C Display (cable only)"` says no rules match
    (delete with `netsh advfirewall firewall delete rule name="USB-C Display (cable only)"`).
  - `schtasks /query /tn "\USB-C Display\"` finds nothing.
  - `%LOCALAPPDATA%\Programs\USB-C Display` and `%LOCALAPPDATA%\UsbcDisplay` don't exist.
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
- Screen photos of every system dialog on both machines. The wizard's mockups copy their wording.

## The run, step by step

### 1. Download and open (Windows)
- [ ] Edge download: note any "isn't commonly downloaded" bar and which buttons it shows.
- [ ] SmartScreen: does "Windows protected your PC" appear? Is "Run anyway" there?
- [ ] Smart App Control: if it's on, does it block the unsigned exe with no way through?
- [ ] No WebView2 runtime (Windows 10 or a stripped image only): the message box offers the download.
- [ ] The window opens: Mica shows through the page on Windows 11 22H2 or later, solid colour
      on older builds. No white flash.
- [ ] Only our own minimize and close buttons. No faint system caption buttons behind them.
- [ ] Dragging the top bar moves the window. Snap still works (Win + arrows, drag to the edge).
      Alt + F4 closes it, also with the focus inside the page.
- [ ] Text is Segoe UI Variable. Light and dark mode follow Windows. Accent colour matches Settings.

### 2. Check this laptop
- [ ] A laptop with a USB4 port shows "Found". Note the router hardware ID from setup.log.
- [ ] A laptop without USB4 shows the "can't do it" screen.

### 3. Install
- [ ] Install takes a few seconds, asks for nothing, and the window reopens in the same place
      from the installed copy (setup.log: a second process starting with `--resume`).
- [ ] The page keeps its place after that reload, not back at Welcome.
- [ ] Start menu entry, Settings > Apps entry, the watcher in the tray, the Run key.
- [ ] The installed setup exe has no `Zone.Identifier` stream
      (`Get-Item -Stream * "<path>"` in PowerShell).
- [ ] Run the downloaded exe again later: it installs again and hands over, it doesn't start a second server.

### 4. One approval (UAC)
- [ ] The UAC box looks like the mockup: "Publisher: Unknown" until the exe is signed.
- [ ] Click **No**: the step says Windows got a No, and Try again works.
- [ ] Standard account: the box asks for an admin name and password, as the copy says.
- [ ] Click **Yes**: the step turns "Approved". Check the rules exist (TCP 80 and UDP 5353, inbound,
      remote addresses link-local only, program = the installed setup exe) and the two tasks
      exist under `\USB-C Display\`.
- [ ] Non-English Windows: the firewall check still reports the rules (setup.log has no
      "firewall: can't read the rules").
- [ ] A laptop with no Qualcomm router ID: does elevation report done with only the firewall
      rules? Does a link freeze later show a UAC prompt? (Known: Link.cs only trusts the Qualcomm
      router task, so yes it will. See the open issues.)
- [ ] If a task fails but the firewall rules are in: the step says "Your Mac can get its app" and Next works.

### 5. Plug in the cable
- [ ] Plug the cable into both. The step turns "Cable connected". Note the seconds it took.
- [ ] Mac: does "Allow accessory to connect?" appear for a computer-to-computer link? Exact wording?
      Does it need the Mac unlocked? What happens with Don't Allow?
- [ ] Wrong port (a plain USB-C port) and the charge-only cable: after 40 s the "Still waiting"
      help appears.
- [ ] The watcher does not show its "Use as a screen / Data transfer" popup during setup.
      Plugging in with the setup closed reopens setup instead.
- [ ] Power over the cable (one machine on battery): note any link flapping in setup.log.

### 6. Find each other
- [ ] "Found your Mac" within about 30 s. Note how long; record macV6 and macV4 timings from setup.log.
- [ ] With a VPN or filter app on the Mac: after 40 s the help cards show.

### 7. Open Safari (Mac)
- [ ] The laptop shows `http://usbc.local`. Typing it in Safari on the Mac opens the landing page.
- [ ] Does Safari resolve usbc.local over the cable at all? (setup.log: `web: GET /`.) If Safari
      treats it as a search, the hint on the laptop covers that.
- [ ] If usbc.local gets no visit for 30 s, the laptop switches to the `http://169.254.x.x`
      address, and only once the Mac has an IPv4 address on the cable. Does that address work,
      or does it go out over Wi-Fi?
- [ ] Is port 80 free? (Some laptops have IIS or other http.sys users.) If not, setup.log shows
      the web server failing to bind, and the laptop shows "isn't ready to send the app yet" after 20 s.
- [ ] Windows Defender Firewall asks nothing extra while the rules are in.
- [ ] mDNS: does Windows' own mDNS (UDP 5353) clash with ours? Is the built-in "mDNS (UDP-In)"
      rule on? Note it.
- [ ] Requests from Wi-Fi (another device opening the laptop's Wi-Fi address on port 80) are refused.

### 8. Download and open (Mac)
- [ ] Safari asks "Allow downloads on usbc.local?" or not. Exact wording.
- [ ] The landing page shows the same icon as the app, and the file size.
- [ ] The laptop's progress bar follows the download, then "done".
- [ ] Safari unzips it: what does the Downloads list show (name, label)?
- [ ] Double-click it. Not notarized (current builds): "USB-C Display Not Opened" with Done and
      Move to Trash. Note the exact text on macOS 15, 26 and 27.
- [ ] Done, then System Settings > Privacy & Security, scroll down, Open Anyway, then Open Anyway
      again in the second box, then the password. Does it match the five sub-steps on the laptop?
      Does Open Anyway disappear after about an hour?
- [ ] Notarized build (when there is one): only "Are you sure you want to open it?" with Open.
- [ ] "Accept incoming network connections?" (Mac firewall on): when, and which buttons.
- [ ] "Background Items Added" notification: when does it appear?
- [ ] The laptop notices the app (mac.reachable) within a few seconds of it opening.

### 9. Move the app
- [ ] "Move it for me" moves the app to /Applications and it opens from there.
- [ ] Does the Mac ask for a password? "Access files in your Downloads folder?"
- [ ] The moved app is not flagged as downloaded (`xattr -l /Applications/USB-C\ Display.app`
      shows no com.apple.quarantine) and doesn't loop.
- [ ] Standard Mac account: what does the administrator fallback show?

### 10. Start automatically
- [ ] The login item turns on without asking, or "Background Items Added" appears.
- [ ] Switch it off in Login Items: the laptop notices and "Open Login Items on my Mac" works.
- [ ] `launchctl print gui/$(id -u)/com.usbc-display.sender` shows the agent running, and the
      Finder copy quits once the agent is on (log: "leaving the port to it").
- [ ] Is `XPC_SERVICE_NAME` set to the label for the agent? (Log says "running as a login agent".)

### 11. Share the picture (Screen Recording)
- [ ] "Open it on my Mac" shows macOS's Screen Recording prompt the first time, the Settings pane after.
- [ ] Turning it on: does macOS offer "Quit & Reopen"? Does that restart the agent, or start a
      second copy from Finder next to it? Does anything else hold port 48100 (`lsof -i :48100`)?
- [ ] If nobody reopens it, the laptop restarts the Mac app after 8 s and the step finishes.
- [ ] Clicking Deny: the recovery card works through Settings.

### 12. Laptop keyboard (Accessibility)
- [ ] Prompt the first time, Settings pane after. The step turns done within a second or two of
      the toggle (no input needed).
- [ ] Skip works and the screen later starts without the laptop's input.

### 13. Choose the size
- [ ] At most three choices, one marked Recommended. The recommended one really makes text look
      as big as on a MacBook on this panel (critique C10: the recommendation comes from the
      reported DPI, which may be wrong on some laptops).

### 14. First picture and Try it out
- [ ] "Show my Mac's screen" goes full screen on the laptop with the Mac's wallpaper.
- [ ] Where does macOS place the new display by default (left or right of the Mac)? The wizard
      says "slide off the right edge".
- [ ] Ctrl + Alt + Esc gives the laptop back, and the wizard comes back with "Welcome back".
- [ ] With Screen Recording off at this point: the receiver gets a silent close (the receiver
      doesn't send HELLO_STATUS yet), and `screen.error` or the picture-error state shows.

### 15. All set
- [ ] Finish closes the window, the watcher stays in the tray, `SetupDone` = 1 in the registry.
- [ ] Unplug and plug in again: the watcher's popup appears now, not the setup.
- [ ] Reboot both: plugging in works without opening anything on the Mac.

## Later and edge cases
- [ ] Mac asleep or locked mid-setup: the laptop says so, and carries on when it wakes.
- [ ] Unplug mid-setup: "The cable is unplugged" replaces the buttons; plugging back resumes.
- [ ] Lid closed on the Mac with the laptop as a screen.
- [ ] A few weeks later: macOS 15+ asks again to "Continue to allow" screen recording.
- [ ] An older Mac app (from an earlier build) already in /Applications: the laptop says it needs
      updating, the new download offers "Update USB-C Display?", and the agent restarts on the new version.
- [ ] Uninstall from Settings > Apps: files, tasks, firewall rules, Run key and Start menu entry gone.
- [ ] Mac removal: delete the app, remove the login item, and reset permissions
      (`tccutil reset ScreenCapture com.usbc-display.sender`, same for `Accessibility`).
- [ ] 4 setup windows opened and killed in a row: the Mac drops the oldest probe and still answers.

## Unverified (from the research critique)
Each of these was assumed, not tested. Write down the answer.
- [ ] Exact dialog wording on macOS 15, 26 and 27 (accessory, Not Opened, Open Anyway, password
      box, Screen Recording, Accessibility, Background Items Added, Downloads folder, Mac firewall).
- [ ] Whether the accessory prompt fires for a host-to-host link.
- [ ] Mac-to-Windows networking on macOS 26.x (a January 2026 report says it failed on 26.2).
- [ ] Whether `usbc.local` is answered and resolved (our own responder on UDP 5353, cable only).
- [ ] Whether the built-in Windows "mDNS (UDP-In)" Public rule is on.
- [ ] Whether port 80 is free with http.sys.
- [ ] Transparent WebView2 over Mica.
- [ ] Quit & Reopen behaviour with a SMAppService agent.
- [ ] Smart App Control behaviour for an unsigned setup exe.
- [ ] Which Windows builds and vendors expose the USB4 P2P network adapter.
- [ ] Where macOS places the virtual display by default.

## Also unverified (from building it)
- [ ] `netsh` accepts the link-local CIDR ranges in `remoteip`.
- [ ] `schtasks` keeps the task's security descriptor (a standard user can run the task but not change it).
- [ ] The firewall check through `HNetCfg.FwPolicy2` works in the .NET 8 single-file exe.
- [ ] The USB4 adapter's interface type (if it's "wired LAN", the firewall rule can add `interfacetype=lan`).
- [ ] WebView2: `app-region` drag, `offset-path`, `color-mix`, `:has()` on the installed runtime.
- [ ] The handoff to the installed copy (window position kept, old window closes, mutex released).
- [ ] Mac: the update alert before the app's run loop, SMAppService unregister and register on a
      version change, the administrator `ditto --noqtn` fallback, closing inherited sockets on
      spawned processes (port 48100 free after a relaunch).
