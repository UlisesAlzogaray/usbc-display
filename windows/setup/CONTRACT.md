# Setup contract

Shared definitions for the three parts of first-run setup. Change this file first, then every side.

- **Windows setup app** (`windows/setup/`, C#): installs, elevates once, watches the cable, serves the Mac app over the cable, talks to the Mac app, and drives the wizard UI.
- **Wizard UI** (`windows/setup/ui/`, HTML/CSS/JS in WebView2): pure function of the state snapshot below plus the user's position in the steps.
- **Mac app** (`mac/`, `USB-C Display.app`): answers the status probe and performs the setup actions.

Product rule: the Mac never downloads anything from the internet. The laptop serves the Mac app over the cable (Safari → `http://usbc.local`, or the laptop's cable IPv4 as fallback). All guidance is shown on the Windows laptop.

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

The probe polls these every 250 ms, so the wizard follows what the Mac shows as it happens.

Actions (UCDQ `actions`):

| Bit | Action |
|---|---|
| 1 | request Screen Recording (macOS's prompt); if no prompt shows within 1.2 s, open Privacy & Security › Screen & System Audio Recording |
| 2 | the same for Accessibility (macOS 27: Device Control and Data Access) |
| 4 | open System Settings › General › Login Items |
| 8 | relaunch the agent (so a new Screen Recording grant takes effect) |
| 16 | move the app to /Applications and relaunch from there |

Screen sessions (`Hello`) also get a `UCDI` with refuse reason 1 instead of a silent close when Screen Recording is missing, if the Hello sets `HELLO_STATUS = 1024`.

## 2. Wizard state (setup app → UI)

The setup app posts the whole snapshot (`chrome.webview.postMessage` from C#: `PostWebMessageAsJson`) on every change. The UI never assumes timing; it renders from the latest snapshot.

```json
{
  "type": "state",
  "laptop": {
    "windowsBuild": 26100, "arch": "arm64", "isAdminUser": true,
    "usb4": "ok | missing | unknown",
    "installed": false,
    "elevation": "none | pending | done | refused | failed",
    "firewallOk": false, "recoveryTasksOk": false
  },
  "link": {
    "adapterUp": false, "adapterName": "", "secondsSincePlug": 0,
    "macFound": false, "macV6": "", "macV4": "", "laptopV4": ""
  },
  "server": {
    "running": false, "url": "http://usbc.local", "fallbackUrl": "http://169.254.29.64",
    "urlReady": false, "pageVisited": false,
    "pageFocused": false, "pageBlurs": 0, "settingsOpened": false,
    "download": { "sent": 0, "size": 0, "done": false },
    "appNotarized": false
  },
  "mac": {
    "reachable": false, "outdated": false, "appVersion": "", "macOS": "",
    "appearance": "dark | light | ''", "accent": "purple | blue | … | ''",
    "status": { "screenOk": false, "axOk": false, "screenPrompted": false, "axPrompted": false,
                "loginItemEnabled": false, "loginItemNeedsApproval": false, "sessionActive": false,
                "runningAsAgent": false, "inApplications": false, "screenNeedsRelaunch": false,
                "settingsFront": false, "promptUp": false }
  },
  "screen": { "running": false, "showing": false, "pointerOnLaptop": false },
  "settings": {
    "scaleOptions": [ { "id": 125, "label": "Same size as a MacBook", "detail": "Text looks as big as on a Mac laptop", "recommended": true } ],
    "scale": 125, "matchColors": true, "useLaptopInput": true
  },
  "setupDone": false
}
```

Extra fields the setup app also sends: `laptop.missingPayload` (list), `laptop.installError` (text),
`laptop.installing`, `screen.error` (text). `elevation` is `done` when the firewall rules are in place and, when a USB4 router was
found, both recovery tasks too; `failed` with `firewallOk` true means only the tasks are missing,
and setup can go on.

`server.pageFocused`, `pageBlurs` and `settingsOpened` come from the download page in Safari
(`/event?e=focus|blur|settings`, below): Gatekeeper's box takes the focus from Safari, so the
wizard knows when it is up without seeing the Mac's screen. `pageBlurs` counts from the end of
the download. `mac.appearance` and `mac.accent` let the Mac scenes use the Mac's own look.

## 3. Commands (UI → setup app)

`window.chrome.webview.postMessage({ cmd, ... })`:

| cmd | Extra fields | Effect |
|---|---|---|
| `ready` | | UI loaded; the app replies with a state snapshot |
| `install` | | copy files to `%LOCALAPPDATA%\Programs\USB-C Display`, Run key, Start menu + Uninstall entries |
| `elevate` | | the single UAC prompt: firewall rule (cable-only) + recovery tasks |
| `macAction` | `action`: `screen` \| `accessibility` \| `loginItems` \| `relaunch` \| `moveToApplications` | sends UCDQ with that bit |
| `saveSettings` | `scale`, `matchColors`, `useLaptopInput` | writes HKCU\Software\USB-C Display |
| `startScreen` | | launches the receiver with the saved settings; with Mac app 4, the Mac first opens this window on its new screen (section 5) |
| `stopScreen` | | closes the receiver (Windows back); this window is there again |
| `copy` | `text` | clipboard (handled, not used by the current UI) |
| `finish` | | sets SetupDone, hands over to the tray watcher, closes |
| `close` | | closes the window (setup can resume later) |
| `minimize` | | minimizes |

## 4. Files served to the Mac (`http://usbc.local`, port 80, cable addresses only)

| Path | Content |
|---|---|
| `/` | landing page: one big "Download USB-C Display" button, says the file comes from the laptop over the cable; after the download, an "Open Privacy & Security" button |
| `/USB-C-Display.zip` | the Mac app (`mac/dist/USB-C-Display.zip`, made by `mac/build.sh`) |
| `/icon.png` | app icon |
| `/event?e=focus\|blur\|settings` | the page reports Safari's focus and the Privacy & Security click (204) |

Anything else: 404. Requests from addresses that aren't on the cable interface are refused.

## 5. The handover: this window moves to the Mac's new screen (Mac app 4)

When the picture starts, the laptop's window stays exactly where it is and only what's behind
it changes. The Mac draws the same wizard (bundled in the app as `Contents/Resources/setup-ui`)
in a borderless window with macOS's own buttons, at the same place and size; the receiver shows
the picture only once a frame with that window has been sent.

All on the status-probe connection, except UCDV:

| Magic | Direction | Content |
|---|---|---|
| `UCDX` `0x58444355` | setup → Mac, 16-byte WinMsg | `a = x \| y << 16`, `b = w \| h << 16` (the window's client area in panel pixels), `c` = Windows DPI %. `w = 0` closes the Mac's window. Sent just before the receiver starts. |
| `UCDE` `0x45444355` | setup → Mac, WinMsg then JSON | `a` = length; the wizard's state snapshot plus `local` (its position in the steps) and `look` (`theme`), mirrored on every change |
| `UCDC` `0x43444355` | Mac → setup, 32-byte header then JSON | `{magic, length}`; `{cmd: "act", act, data}`: a click in the Mac's copy, done by the laptop's copy |
| `UCDV` `0x56444355` | Mac → receiver (screen control connection) | `a` = the last frame sent: it has the window in it. The receiver started with `--after-mac-window` shows the picture once it has shown that frame (or 6 s after the first frame) and prints "Picture on screen." |

Placement: the Mac maps panel pixels to points with the session's pixels per point and rounds
each edge to the nearest point (macOS puts windows on whole points), and zooms the page so CSS
pixels have the same physical size (`dpi / 100 / f`). While the window is on the new screen the
laptop panel's colour profile waits (the laptop's copy isn't colour-managed, so the colours
would jump at the cut); it is applied when the window closes. The window closes on `w = 0` or
when the setup's connection ends.
