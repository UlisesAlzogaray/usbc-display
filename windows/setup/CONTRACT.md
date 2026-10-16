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
| 28 | u32 | 0 |

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

Actions (UCDQ `actions`):

| Bit | Action |
|---|---|
| 1 | request Screen Recording / open Privacy & Security › Screen & System Audio Recording |
| 2 | show the Accessibility prompt / open Privacy & Security › Accessibility |
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
    "download": { "sent": 0, "size": 0, "done": false },
    "appNotarized": false
  },
  "mac": {
    "reachable": false, "outdated": false, "appVersion": "", "macOS": "",
    "status": { "screenOk": false, "axOk": false, "screenPrompted": false, "axPrompted": false,
                "loginItemEnabled": false, "loginItemNeedsApproval": false, "sessionActive": false,
                "runningAsAgent": false, "inApplications": false, "screenNeedsRelaunch": false }
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

## 3. Commands (UI → setup app)

`window.chrome.webview.postMessage({ cmd, ... })`:

| cmd | Extra fields | Effect |
|---|---|---|
| `ready` | | UI loaded; the app replies with a state snapshot |
| `install` | | copy files to `%LOCALAPPDATA%\Programs\USB-C Display`, Run key, Start menu + Uninstall entries |
| `elevate` | | the single UAC prompt: firewall rule (cable-only) + recovery tasks |
| `macAction` | `action`: `screen` \| `accessibility` \| `loginItems` \| `relaunch` \| `moveToApplications` | sends UCDQ with that bit |
| `saveSettings` | `scale`, `matchColors`, `useLaptopInput` | writes HKCU\Software\USB-C Display |
| `startScreen` | | launches the receiver with the saved settings |
| `copy` | `text` | clipboard (handled, not used by the current UI) |
| `finish` | | sets SetupDone, hands over to the tray watcher, closes |
| `close` | | closes the window (setup can resume later) |
| `minimize` | | minimizes |

## 4. Files served to the Mac (`http://usbc.local`, port 80, cable addresses only)

| Path | Content |
|---|---|
| `/` | landing page: one big "Download USB-C Display" button, says the file comes from the laptop over the cable |
| `/USB-C-Display.zip` | the Mac app (`mac/dist/USB-C-Display.zip`, made by `mac/build.sh`) |
| `/icon.png` | app icon |

Anything else: 404. Requests from addresses that aren't on the cable interface are refused.
