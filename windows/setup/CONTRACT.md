# Setup contract

Shared definitions for the three parts of first-run setup. Change this file first, then every side.
The design and every screen are in the build spec (design/SPEC.md); this file is the wire contract.

- **Windows setup app** (`windows/setup/`, C#): installs, asks Windows once, watches the cable, serves the Mac app over the cable, talks to the Mac app, and drives the wizard UI.
- **Wizard UI** (`windows/setup/ui/`, HTML/CSS/JS in WebView2): `render(view(S, L))`, a pure function of the state snapshot below (`S`) plus its own place in the steps (`L`).
- **Mac app** (`mac/`, `USB-C Display.app`): answers the status probe, performs the setup actions, and shows the Mac's copy of the setup window after the handover.

Product rule: the Mac never downloads anything from the internet. This PC serves the Mac app over the cable (Safari → `http://usbc.local`, or this PC's cable IPv4 as fallback). All guidance is shown on this PC.

## 1. Status probe (Windows → Mac, TCP 48100, cable only)

A new connection whose first message is a 16-byte WinMsg with magic `UCDQ`:

| Offset | Type | Field |
|---|---|---|
| 0 | u32 | magic `0x51444355` ("UCDQ") |
| 4 | u32 | actions (bits below; 0 = just report) |
| 8 | u64 | wizard version (setup app build number) |

The Mac answers with a 32-byte CtlMsg with magic `UCDI`, keeps the socket open, and sends a new `UCDI` whenever any status bit changes (polled at least once a second). More `UCDQ` messages on the same socket run more actions. Old Mac builds close the socket on the unknown magic: the setup app reports that as "Mac app needs updating".

| Offset | Type | Field |
|---|---|---|
| 0 | u32 | magic `0x49444355` ("UCDI") |
| 4 | u32 | status bits |
| 8 | u64 | `appVersion << 16 \| PROTOCOL_VERSION` |
| 16 | u64 | macOS `major << 32 \| minor << 16 \| patch` |
| 24 | u32 | refuse reason (0 none, 1 no Screen Recording) |
| 28 | u32 | the Mac's accent colour: `AppleAccentColor + 2` (1 graphite, 2 red … 8 pink), 0 multicolour (Mac app 4; 0 before) |

Status bits:

| Bit | Name | Meaning |
|---|---|---|
| 1 | SCREEN_OK | CGPreflightScreenCaptureAccess() is true in this process |
| 2 | AX_OK | AXIsProcessTrusted() |
| 4 | SCREEN_PROMPTED | the Screen Recording request was shown during this run |
| 8 | AX_PROMPTED | the Accessibility prompt was shown during this run |
| 16 | LOGIN_ITEM_ENABLED | the agent is registered and enabled to start at login |
| 32 | LOGIN_ITEM_NEEDS_APPROVAL | registered but switched off by the user in Login Items |
| 64 | SESSION_ACTIVE | a screen session is running now |
| 128 | RUNNING_AS_AGENT | this process is the login agent (not a Finder-launched copy) |
| 256 | IN_APPLICATIONS | the app runs from /Applications (not Downloads, not translocated) |
| 512 | SCREEN_NEEDS_RELAUNCH | permission granted in Settings but this process must restart to use it |
| 1024 | SETTINGS_FRONT | System Settings is the frontmost app (Mac app 4) |
| 2048 | PROMPT_UP | a macOS permission prompt (`universalAccessAuthWarn`) is on screen (Mac app 4) |
| 4096 | MAC_DARK | the Mac is in Dark mode (Mac app 4) |
| 8192 | DISPLAY_RIGHT | this PC's display is right of the main display (Mac app 5, only while a session is active) |
| 16384 | DISPLAY_LEFT | … left of it (Mac app 5, session only) |
| 32768 | DISPLAY_ABOVE | … above it (Mac app 5, session only) |
| 65536 | DISPLAY_BELOW | … below it (Mac app 5, session only). At most one of the four; none = not known yet |
| 131072 | AUTH_UP | a password or Touch ID request is on screen (`SecurityAgent`, `coreautha`, `LocalAuthenticationRemoteService`; Mac app 5) |

The probe polls these every 250 ms, so the wizard follows what the Mac shows as it happens.

Actions (UCDQ `actions`):

| Bit | Action |
|---|---|
| 1 | request Screen Recording (macOS's prompt); if no prompt shows within 1.2 s, open Privacy & Security › Screen & System Audio Recording |
| 2 | the same for Accessibility (macOS 27: Device Control and Data Access) |
| 4 | open System Settings › General › Login Items & Extensions |
| 8 | relaunch the agent (so a new Screen Recording grant takes effect) |
| 16 | move the app to /Applications and relaunch from there |

Screen sessions (`Hello`) also get a `UCDI` with refuse reason 1 instead of a silent close when Screen Recording is missing, if the Hello sets `HELLO_STATUS = 1024` (the receiver always sets it).

## 2. Wizard state (setup app → UI)

The setup app posts the whole snapshot (`chrome.webview.postMessage` from C#: `PostWebMessageAsJson`) on every change, at most ten times a second. The UI never assumes timing; it renders from the latest snapshot.

```json
{
  "type": "state",
  "laptop": {
    "windowsBuild": 26100, "arch": "arm64", "isAdminUser": true,
    "usb4": "ok | missing | unknown",
    "installed": false, "installing": false, "installError": "'' | inUse | other",
    "elevation": "none | pending | working | done | refused | failed",
    "firewallOk": false, "recoveryTasksOk": false,
    "missingPayload": [],
    "checked": false, "runningInstalled": false, "signed": false
  },
  "link": {
    "adapterUp": false, "adapterName": "", "secondsSincePlug": 0,
    "macFound": false, "macV6": "", "macV4": "", "laptopV4": ""
  },
  "server": {
    "running": false, "error": "'' | port",
    "url": "http://usbc.local", "fallbackUrl": "http://169.254.29.64",
    "urlReady": false, "pageVisited": false,
    "pageFocused": true, "pageBlurs": 0, "settingsOpened": false, "leftForSettings": false,
    "downloadClicked": false, "appOpened": false,
    "download": { "sent": 0, "size": 0, "done": false },
    "appNotarized": false, "appSize": 657606, "appVersion": "5",
    "pageAppearance": "dark | light | ''", "pageAccent": "purple | blue | … | ''"
  },
  "mac": {
    "reachable": false, "outdated": false, "appVersion": "", "macOS": "",
    "appearance": "dark | light | ''", "accent": "purple | blue | … | multicolor | ''",
    "status": { "screenOk": false, "axOk": false, "screenPrompted": false, "axPrompted": false,
                "loginItemEnabled": false, "loginItemNeedsApproval": false, "sessionActive": false,
                "runningAsAgent": false, "inApplications": false, "screenNeedsRelaunch": false,
                "settingsFront": false, "promptUp": false,
                "authUp": false, "displaySide": "right | left | above | below | ''" }
  },
  "screen": {
    "running": false, "showing": false, "pointerOnLaptop": false, "inputOk": false,
    "error": "'' | screen-recording-off | receiver-missing | exited | other"
  },
  "settings": {
    "scaleOptions": [ { "id": 125, "label": "Default", "detail": "Looks like 1536 × 960", "recommended": true } ],
    "scale": 125, "matchColors": true, "useLaptopInput": false
  },
  "setup": {
    "started": false, "axChoice": "'' | yes | no", "loginSkip": false, "elevationAsked": false,
    "handingOff": false, "hold": null
  },
  "setupDone": false
}
```

**This PC (`laptop`).**
- `checked`: the USB4, firewall, task and signature checks are done, and `elevation` has its initial value. The window stays cloaked until then.
- `runningInstalled`: this is the installed copy (`%LOCALAPPDATA%\Programs\USB-C Display`), the one the firewall rule names. Only it serves the Mac and acts on the Mac or the display.
- `installed`: the installed files are in place. A downloaded copy reports `false` until it has installed (it then installs again, updating the files, and hands over).
- `signed`: this exe has a valid Authenticode signature (Windows' prompt then names a publisher).
- `installError`: a code; the details go to `setup.log`. `inUse` = a file is held by another copy of USB-C Display.
- `elevation`: `none` (never asked, or the last result is unknown), `pending` (Windows is asking), `working` (Yes was given; the admin step runs), `done` (the firewall rules are in place and, when a USB4 router was found, both recovery tasks too), `refused` (No), `failed` (something didn't finish; with `firewallOk` true only the tasks are missing, and setup goes on). At start it is `done` if the changes are there, else the last result when the host asked before (`refused` or `failed`), else `none`. A last result of done (`ElevationResult` 1) whose changes are no longer all there starts as `failed` while the firewall rules are in place (only a recovery task is missing, typically a USB4 router Windows lists only since the cable was plugged in: silent, setup goes on, setup.log says which) and as `none` once the rules are gone (the first question again).

**The download page and the Mac app (`server`).**
- `error`: `port` when another program on this PC holds port 80 on a cable address.
- `pageFocused`, `pageBlurs`, `settingsOpened`, `leftForSettings`, `downloadClicked`, `pageAppearance`, `pageAccent` come from the page in Safari (section 4); `appOpened` from the Mac app's optional ping. `pageBlurs` counts from the end of the download; the first blur after it counts even if the page never reported a focus (the page reports its own focus once when it loads). The page shows Open Privacy & Security on that first blur, so the person can go on whether or not Safari gets the focus back after the Mac's alert. Each event is logged by name (`web: event blur`). `settingsOpened` is set by the page's Privacy & Security click; a blur 0.8 s or more after it sets `leftForSettings` (System Settings is in front); a focus while `leftForSettings` clears both (back in Safari: the page's button again). A completed download resets `pageBlurs`, `downloadClicked`, `settingsOpened` and `leftForSettings` (Download Again starts the opening over).
- `appSize`: bytes of the Mac app's zip this copy serves (0 if none); `appVersion`: its `CFBundleVersion` (from the zip's Info.plist, else the build's `MacAppVersion`).

**The Mac (`mac`).** `status` keeps its last values while the Mac app is away (relaunching, moving): check `reachable`. `appVersion` is reported as is; the UI asks for an update below 4. `appearance` and `accent` (Mac app 4) let the pictures and the window use the Mac's own look.

**The display (`screen`).**
- `showing`: the receiver printed `Picture on screen` (the Mac desktop is on this PC's panel).
- `pointerOnLaptop`, `inputOk`: from the receiver's output, reset at each start.
- `error`: `screen-recording-off` (the Mac refused the session: Screen Recording is off), `receiver-missing` (no `UsbcDisplay.exe`), `exited` (it ended before showing while the cable was in, and nobody stopped it), `other` (couldn't start: the Mac app, Screen Recording, the cable, or a display already running). Cleared by the next `startScreen`.

**Settings (`settings`).** `scale` is the Mac display's scale (panel pixels per Mac point, in percent): the saved `Scale` if there is one (100–300), else the recommended option. The setup window is 800·f × 600·f panel pixels with f = `scale` / 100, scaled down evenly only if it doesn't fit: in the work area, and on this PC's own panel also below the Mac's 40·f px menu bar (so the Mac's copy keeps its bottom edge and shadow on its new display). The page follows the size (`--mpt`). `useLaptopInput` is the saved `Input` (off when missing); `startScreen` sets it to `axOk && axChoice != 'no'`.

**The place in setup (`setup`).** Kept by the host in `HKCU\Software\USB-C Display`; the UI never uses `localStorage`.

| Field | HKCU value | Set by |
|---|---|---|
| `started` | `SetupStarted` (1) | `setUp` |
| `axChoice` | `AxChoice` (0 '', 1 yes, 2 no) | `place{axChoice}` |
| `loginSkip` | `LoginSkip` (1) | `place{loginSkip:true}` |
| `elevationAsked` | `ElevationAsked` (1) | the host, when it asks Windows (`setUp` or `elevate`) |
| (`laptop.elevation` at start) | `ElevationResult` (1 done, 2 refused, 3 failed) | the host, after every request |
| `handingOff` | not saved | the host, from the elevation result (or the install, if no request was needed) until this copy closes |
| `hold` | not saved (`--hold`) | the installed copy, until its first full look (section 5): `{screen, sub, status, theme, accent, active}`, the downloaded copy's last `frame` (`active` true when that copy didn't say) |

`setupDone` is `SetupDone` (1), saved when the Mac desktop first shows on this PC (and by `finish`).

## 3. Commands (UI → setup app)

`window.chrome.webview.postMessage({ cmd, ... })`:

| cmd | Extra fields | Effect |
|---|---|---|
| `ready` | | UI loaded; the app replies with a state snapshot and the active state |
| `shown` | | the first real frame is on screen: the host uncloaks the window (section 5) |
| `setUp` | | Continue (and Try Again after an install error). One at a time: saves `SetupStarted`; installs if this isn't the installed copy or nothing is installed (`installing`, then `installed` or `installError`); if the admin step isn't done and Windows was never asked, asks no earlier than 3.0 s after the command and 0.7 s after the install (`elevationAsked`, `pending`, 400 ms, the prompt, `working` once Yes was given, then the result); then, from a copy outside the install folder, sets `setup.handingOff` in the same snapshot as the result and, 600 ms later, hands over to the installed copy with the last `frame` as the hold |
| `install` | | the older name of `setUp` |
| `elevate` | | asks Windows now (Continue on "ask", Try Again), even if it was asked before; same path as in `setUp` |
| `place` | `axChoice?` (`''`, `yes`, `no`), `loginSkip?` (`true`) | saves the answer (section 2) |
| `frame` | `screen`, `sub`, `status`, `theme`, `accent`, `active` | the frame on screen now, kept for the hand-over hold. `status` is the status line's strings.js key; `active` (boolean) whether the page draws the window in front (its lights); without it the host uses the window's own state |
| `attention` | | flashes the taskbar button until the window is in front (Ready while this window isn't active) |
| `macAction` | `action`: `screen` \| `accessibility` \| `loginItems` \| `relaunch` \| `moveToApplications` | sends UCDQ with that bit |
| `saveSettings` | `scale`, `matchColors`, `useLaptopInput` | writes HKCU\Software\USB-C Display (not used by setup's screens) |
| `startScreen` | | a display that runs but never showed (Try Again after "Unable to Show Your Mac Desktop") is stopped first. Then refused with `screen.error = 'other'` unless the Mac app (4 or later) answers with Screen Recording on and no relaunch pending, the cable is in, no display runs and this is the installed copy. Then: this window is restored, brought in front, moved onto this PC's own panel and clear of the top 40 pt (its top never above that; its bottom on the panel's work area when that doesn't move the top up; a window sized for another screen that is too big for this panel is first scaled down to fit, as at the start); `Scale` (if none is saved), `ColorManaged` (if none is saved) and `Input` = `axOk && axChoice != 'no'` are saved; `screen.error` is cleared; the Mac opens its copy of this window (section 5) and the receiver starts with those settings (`--no-input` when input is off) |
| `stopScreen` | | Return to Windows: stops the receiver first (Windows is back with this window in place), then closes the Mac's copy |
| `finish` | | Done: closes the Mac's copy, starts the tray watcher, closes this window; the display keeps running. `SetupDone` is already saved |
| `close` | | the close light (also Alt+F4 and the taskbar): ignored while `installing`, `elevation === 'working'`, `handingOff` or `hold`; otherwise starts the watcher if installed and closes (setup resumes later at the same place) |
| `minimize` | | minimizes (on the Mac's copy: into the Mac's Dock, not passed to this PC) |
| `chrome` | `point`, `width`, `height`, `theme` | the window's Mac point and size in CSS px and its theme (`dark` \| `light`), for the host's Mac shadow |
| `mirror` | `json` (`{local, look}`) | the page's place and look for the Mac's copy (section 5) |
| `startDrag` | | the drag fallback when the runtime has no CSS `app-region` |
| `copy` | `text` | clipboard (handled, not used by the current UI) |

Host → UI, besides the state:
- `{type: 'active', on}` when the window comes in front or goes behind (each copy's own host: the Mac app for the Mac's copy). While this PC's window is handed over to the Mac (from `startScreen` until the Mac's copy closes) the Windows host doesn't send `on: false`, so the mirrored look stays active at the cut. Otherwise every real change is sent, also while `setup.hold` is set (the installed copy opens without activation, so its `ready` answer says `on: false`): the page draws `setup.hold.active` until the hold is released, then the last `active` it heard.
- `{type: 'remoteAct', act, data}`: a click in the Mac's copy, for this PC's copy to do.

`window.usbcHost = { dark, windowsBuild, appRegion }` before the page's scripts run: Windows' theme (only the first look, before the Mac's is known; the window never uses Windows' accent) and whether CSS `app-region: drag` works in this runtime. The Mac app sets `usbcHost.mac` for its copy.

## 4. Files served to the Mac (`http://usbc.local`, port 80, cable addresses only)

| Path | Content |
|---|---|
| `/` | `web/index.html` with `{{HAS_APP}}` (`true`/`false`), `{{SIZE}}` (e.g. `0.7 MB`: decimal MB as the Mac counts them, one decimal below 10 MB, the same value the window shows), `{{VERSION}}` (the app's `CFBundleVersion`, e.g. `5`) and `{{NOTARIZED}}` (`true`/`false`) filled in |
| `/USB-C-Display.zip` | the Mac app (`mac/dist/USB-C-Display.zip`, made by `mac/build.sh`); in a copy without it, 404 with the plain text “This copy of USB-C Display Setup doesn’t include USB-C Display for Mac.” |
| `/icon.png` | app icon |
| `/event?e=<word>[&k=v…]` | 204. Words: `focus`, `blur` (Safari's window), `settings` (the Open Privacy & Security click), `download` (the Download click), `look&dark=0\|1&accent=<name>` (the Mac's look as Safari sees it; on load and when it changes), `opened&v=<N>` (the Mac app was opened; optional Mac app 5 ping) |

Anything else: 404. Requests from addresses that aren't on the cable interface are refused.

## 5. The window, the hand-off and the handover

**The window.** 800 × 600 pt at f = `settings.scale` / 100 panel pixels a point, an OnBoardingKit window drawn by the page (16 pt continuous corners, transparent 32 pt title band with no title, traffic lights: close and minimise work, zoom disabled). It opens cloaked (`DWMWA_CLOAK`) and appears whole when the page posts `shown`: the page builds nothing until `laptop.checked` (and a screen to show), draws its first screen (the held frame too) with no entrance fade of the screen, its buttons or its status, and posts `shown` once Inter has loaded, no fade is running and that frame has been painted (two animation frames, a task and one more frame), or after 5 s anyway (15 s for the installed copy taking over, whose old window stays up meanwhile). The host draws macOS's shadow for a borderless window under it, the same whether active or not (Gaussian σ 8 pt, 4 pt down, alpha .31 dark / .26 light, plus a 0.5 pt rim at the edge), in the theme from `chrome`. The shadow is drawn as soon as `chrome` arrives, while the window is still cloaked, so showing it is instant. The display is kept awake while the window is open.

**The hand-off to the installed copy.** A copy outside the install folder (the download) installs and asks Windows, then starts the installed copy with `--resume --at X,Y --behind HWND --hold "screen|sub|status|theme|accent|active"` (its last `frame`; `active` is `1` or `0`, and a missing sixth field means `1`). The installed copy opens cloaked right under the old window, without activation, and draws its shadow while hidden. It paints that frame (`setup.hold`, no entrance, the traffic lights as `setup.hold.active` says), posts `shown`, and its host uncloaks it and signals the old copy. If the old copy is in front, it first hands the foreground to the new window, which comes up over it with the same frame, and waits two frames. Without that, hiding the old window would activate the app that was in front before setup, and that app would stay over both windows. The old copy then hides its window and its shadow in one step and closes. The new copy hears that the old window has gone (a WinEvent hook, a 10 ms poll as the fallback, 1.5 s at most), shows its shadow at once and comes forward. The shadow gap is one display frame. The host clears `setup.hold` once `laptop.checked`, its first look at the cable is done, the Mac app has answered (or 2 s have passed) when the cable is in, and it has been in front for 300 ms (10 s at most).

**The handover to the Mac (Mac app 4).** When the Mac desktop starts, this PC's window stays exactly where it is and only what's behind it changes. The Mac draws the same wizard (bundled in the app as `Contents/Resources/setup-ui`) in a borderless window at the same place and size; the receiver shows the Mac desktop only once a frame with that window has been sent.

All on the status-probe connection, except UCDV:

| Magic | Direction | Content |
|---|---|---|
| `UCDX` `0x58444355` | setup → Mac, 16-byte WinMsg | `a = x \| y << 16`, `b = w \| h << 16` (the window's client area in panel pixels), `c` = Windows DPI %. `w = 0` closes the Mac's window. Sent just before the receiver starts. |
| `UCDE` `0x45444355` | setup → Mac, WinMsg then JSON | `a` = length; `{type:'mirror', state, local, look}`: the state snapshot plus the page's `local` `{screen, sub, sheet, cut, cutCheck, settled}` and `look` `{theme, accent, active, style}`, mirrored on every change |
| `UCDC` `0x43444355` | Mac → setup, 32-byte header then JSON | `{magic, length}`; `{cmd: "act", act, data}`: a click in the Mac's copy, done by this PC's copy |
| `UCDV` `0x56444355` | Mac → receiver (screen control connection) | `a` = the last frame sent: it has the window in it. The receiver started with `--after-mac-window` shows the Mac desktop once it has shown that frame (or 6 s after the first frame) and prints "Picture on screen." |

At "Picture on screen" the setup saves `SetupDone` and gives the receiver's window the foreground (`AllowSetForegroundWindow` + `SetForegroundWindow`), so this PC's keyboard reaches the Mac. Return to Windows (or Ctrl-Alt-Esc in the receiver) stops the receiver first, then closes the Mac's copy, then brings this PC's copy forward.

Placement: the Mac maps panel pixels to points with the session's pixels per point and rounds each edge to the nearest point (macOS puts windows on whole points), and zooms the page so CSS pixels have the same physical size (`dpi / 100 / f`). While the window is on the new display, this PC's panel colour profile waits (this PC's copy isn't colour-managed, so the colours would jump at the cut); it is applied when the window closes. The window closes on `w = 0` or when the setup's connection ends.

## 6. Receiver output lines

The setup (`Receiver.cs`) and the watcher read these lines from `UsbcDisplay.exe`'s output; everything else is for people (and `receiver.log`).

| Line | Meaning |
|---|---|
| `Window: <hwnd>` | the display's window exists (decimal handle; hidden until the Mac desktop shows) |
| `Connected to <address>.` | the Mac answered on the cable |
| `Picture on screen.` | the window is up, in front, showing the Mac desktop (`screen.showing`) |
| `Pointer on screen` | the Mac's pointer was first seen on this display (`screen.pointerOnLaptop`) |
| `Input: allowed` / `Input: not allowed` | whether the Mac lets this PC's keyboard and trackpad control it (`screen.inputOk`) |
| `Refused: screen recording` | the Mac can't record its screen; the receiver exits with code 3 (`screen.error = 'screen-recording-off'`) |
