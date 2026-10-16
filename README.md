# USB-C Display

Use the Windows laptop as a second monitor for the Mac over the USB-C cable.
There's no third-party software involved: a small program on each machine.

- **Mac (`mac/`)** adds a virtual monitor to macOS (the same private CoreGraphics API
  that virtual-display apps use), captures it with ScreenCaptureKit and sends **the exact
  pixels that changed**, as 64×32 tiles, LZ4-compressed on all cores. Retina modes are
  captured at full resolution and fitted to the laptop's panel with a Lanczos filter
  (sharper than ScreenCaptureKit's bilinear).
- **Windows (`windows/`)** writes each complete frame straight into a Direct3D 11 texture
  and flips it onto the screen as soon as that can't show a seam (see *Showing frames*).

The cable shows up as a network link (Thunderbolt Bridge on the Mac, *USB4 P2P Network
Adapter* on Windows, 20 Gbps). Both connections use the cable's IPv6 link-local
addresses; the Mac refuses anything that doesn't arrive over the cable.

## The link: why it used to freeze, and why it doesn't now

The Windows USB4 network driver (Microsoft `usb4p2pnetadapter` on Qualcomm's USB4 bus
driver) stops receiving for good, until the USB4 connection restarts, when packets that
span several of the link's 4 KB frames arrive. macOS sends exactly those whenever TCP
segmentation offload (TSO) bundles a burst into one 40–64 KB packet. It looked like a
2–3 GB "budget", but it isn't one:

| Test (Oct 2026) | Result |
|---|---|
| Bundled packets, IPv6, full speed | froze after 0.1–3 GB, sometimes within 2 MB of a fresh link |
| Same, but unbundled (IPv4 with an IP option) | 20 GB, then a 100 GB soak, no freeze |
| Unbundled IPv4 control, then bundled again on the same link | froze after 0.2 GB |
| Windows → Mac, 10 GB | no freeze |
| **IPv6, sends limited to two segments (one 4 KB frame) at a time** | **100 GB at 952 MB/s, no freeze** |

So every send goes out in pieces of at most two TCP segments, the next one only once the
previous has left the socket (`TCP_NOTSENT_LOWAT` = 1); a packet never spans two link
frames. No admin rights and no settings change on either machine. The link now carries
~950 MB/s, more than the 553 MB/s that full-screen changes at 60 fps need, so exact
pixels are the default and H.264 is only a fallback for when a frame can't cross the link
within about one refresh (it hasn't triggered on this link).

Anything else that sends large amounts from the Mac over the cable (Finder file sharing in
"Data transfer" mode) still uses bundled packets and can freeze the link. Turning TSO off
Mac-wide (`sudo sysctl -w net.inet.tcp.tso=0`) would fix that; it isn't done here because it
changes all of the Mac's networking. Instead, the link restarts itself (below).

**If it does freeze**, it's restarted silently by a scheduled task that
`tools\register-recovery-task.ps1` registers once (one admin prompt). The task runs one
fixed command, `pnputil /restart-device /deviceid "USB4\ROOT_DEVICE_ROUTER&VID_QCOM&PID_0CD1"`,
as SYSTEM; your account may start it but not change it, and the receiver checks its
command before using it. The screen receiver restarts the link when the Mac stops
answering and keeps the last picture up meanwhile (measured: 32 s); the watcher does the
same when the screen isn't running (at most twice in 10 minutes). The Mac keeps the virtual
display for 150 s after a disconnect, so your windows stay where they were.
`tools\unregister-recovery-task.ps1` removes the tasks.

## Showing frames

A 60 Hz panel draws its picture top to bottom, line by line, every 16.7 ms. Waiting for
the next refresh to flip ("vsync") costs half a refresh on average, and Windows often added
a whole extra one. Flipping at once ("tearing") shows a seam during motion.

By default the receiver reads the line the panel is drawing (`D3DKMTGetScanLine`) and flips
**as soon as that line, plus a margin for the flip to take effect, is clear of the area that
changed**. A flip then can't show a seam, and changes appear in the refresh being drawn.
Changes too tall for that (most of the screen) wait for the refresh. The margin follows
the measured flip time (about 0.5 ms for small changes, 1.1 ms for big ones; the margin is
at least 2 ms). `--vsync` and `--tearing` give the two classic behaviours.

Measured with the two machines' clocks synced over the cable (error ±0.1 ms), "looks like
1536×960", from the moment a frame is shown on the Mac's virtual display to the moment the
laptop's panel draws it:

| Case | median | 95% within |
|---|---|---|
| Small moving box (typing-sized changes) | 11 ms | 28 ms |
| A window dragged around over the wallpaper, 58 fps | 10–22 ms | 26 ms |
| Same box with `--vsync` (old behaviour) | 25 ms | 42 ms |
| Full-screen noise, every pixel changing, 60 fps, 553 MB/s exact | 32 ms | 37 ms |
| Pointer: Mac reads it → Windows moves its cursor | 0.2 ms | 1.4 ms |

About 8 ms of each figure is simply the panel's line-by-line drawing reaching the change, so
the extra delay over the Mac's own screen is roughly one refresh at most. The picture is
exact: a screenshot of the laptop matched what the Mac sent in all 6,912,000 values.

## Run

Normally it's automatic: **plug in the cable, and the laptop asks "Use as a screen" or
"Data transfer".** Choosing the screen starts everything. Unplugging stops it, and the
next plug asks again.

The popup also picks the **screen size** (remembered):

- **Same size as on the MacBook** (recommended): looks like 1536×960. Text and windows are
  the same physical size as on the MacBook Air's screen (it shows about 129 points per
  inch; this panel has 162 pixels per inch). macOS draws it at 3072×1920 (Retina), fitted
  to the panel like the MacBook's own default mode.
- **Larger text**: looks like 1280×800, Windows' own size here.
- **More space**: 1920×1200 at 1:1. macOS then draws at 1x, not Retina, so text is thinner
  than on the Mac.
- **Largest**: 960×600, exactly 2×.

and **"Match colours to this screen"** (on by default): the laptop sends its panel's factory
colour profile (ASUS installs one per panel model) and the Mac colour-manages the display
for it, as it does for its own screen. The panel covers less than sRGB, so saturated colours
still can't match the Mac's, but greys, skin tones and everyday colours come out right
instead of washed out. Turning it off removes the profile again.

and **"Use this laptop's trackpad and keyboard on the Mac"** (on by default):

- The pointer: wherever this laptop's trackpad moves the cursor on the laptop's screen, the
  Mac's pointer goes, with clicks (double-clicks counted the Mac's way), dragging and
  scrolling (smooth with the touchpad). The Mac's own trackpad keeps working too.
- **Crossing to the Mac's other screens:** push the cursor on past an edge where the Mac
  arranges another display (System Settings › Displays) and it carries on there; this
  trackpad then moves the Mac's pointer like a second trackpad (the Windows cursor stays
  hidden), until the pointer comes back onto the laptop's screen. Likewise, after you move the
  pointer away with the Mac's trackpad, this trackpad continues from wherever it is instead of
  pulling it back.
- The keyboard, while the screen is in front on the laptop: typed characters arrive exactly
  as this keyboard's own layout produces them (accents, ñ, AltGr+Q = @...), whatever layout
  the Mac uses. Shortcuts and other keys are sent as Mac keys by position: **Alt (next to the
  space bar) is ⌘ Command, the Windows key is ⌥ Option**, Ctrl is Control. Windows'
  own shortcuts (Windows key, Alt+Tab, Alt+F4) go to the Mac instead, so Alt+Tab is ⌘Tab.
  **Ctrl+Alt+Esc** closes the screen.
- macOS only lets a program post input after you turn it on: *System Settings › Privacy &
  Security › Accessibility › usbc-display* (asked for once; the laptop shows a notification
  if it's off).

Measured end to end (synthetic input on the laptop, checked on the Mac): the pointer lands
exactly where the laptop's cursor is (0.500/0.500 for the centre), and "Hola ñé@✓", Backspace,
Enter, ⌘←, ⌥→ and scrolling all arrive as intended.

Switching size makes the Mac replace the display, so windows that were on it move back
to the Mac's screen.

- **Mac, the app:** `mac/build.sh` also makes `mac/dist/USB-C Display.app` (and
  `USB-C-Display.zip`, which the laptop's setup serves to the Mac over the cable). Opened from
  Applications, it registers itself to run at login (*Login Items*), asks for nothing until
  the laptop's setup or screen needs it, and logs to `~/Library/Logs/USB-C Display.log`. Use
  either the app or `install-agent.sh` below, not both: they are the same login agent, and
  each needs its own permissions. A newer zip opened outside Applications offers to update
  the copy there. Build with `DEVELOPER_ID` and `NOTARY_PROFILE` (see `build.sh`) for other
  people: macOS blocks an app that isn't notarized until someone clicks *Open Anyway*.
- **Mac:** `bash mac/install-agent.sh` runs the sender at every login as a background
  agent. It stays idle until the laptop asks for the screen. The first time, allow
  `usbc-display` under *System Settings > Privacy & Security > Screen Recording*. It
  takes effect the next time the laptop connects. Re-run the script after rebuilding
  to restart the agent; the permission stays, thanks to the signing certificate.
  `bash mac/install-agent.sh --remove` uninstalls it. Its log is `mac/usbc-display.log`
  (every 10 s while connected: frames, MB/s, and where the time goes).
- **Windows:** `windows\app\UsbcWatcher.exe --install` starts the watcher at login (tray
  icon: a blue monitor). It's built with the .NET Framework compiler that ships with
  Windows (`windows\build-watcher.cmd`), so it needs no runtime setup.
  `--uninstall` removes it. The receiver's output goes to
  `%LOCALAPPDATA%\UsbcDisplay\receiver.log` (statistics every 10 s).
- On the Mac, drag the new "USB-C Display" into place in *System Settings > Displays*.
  macOS remembers the arrangement.

To run it by hand instead: `windows/Start USB-C Display.cmd`. Press **Ctrl+Alt+Esc** to stop
the screen (plain Esc goes to the Mac while the laptop's keyboard is in use). When the Mac goes to sleep or its
agent stops, the laptop's screen goes back to Windows at once.

Power each laptop from its own charger if you can. When one laptop powered the
other through the cable, the link dropped out much more often.

## Options

| Mac (`usbc-display`) | |
|---|---|
| `--h264` | H.264 for anything that moves (the behaviour before Oct 2026) |
| `--no-lz4` | exact pixels without compression |
| `--bilinear` | let ScreenCaptureKit fit Retina modes (softer, slightly less CPU) |
| `--gpu-fit` | Lanczos on the GPU (Metal) instead of the CPU cores; slower here |
| `--bitrate N`, `--max-qp N` | H.264 settings for the fallback (40 Mbit/s, QP ≤ 24) |
| `--native` | always 1:1 pixels |
| `--mirror` | show the Mac's main screen instead of adding a new one |
| `--bench [FPS]` | synthetic full-screen noise, to measure the link |
| `--port N` | default 48100 |

| Windows (`UsbcDisplay`) | |
|---|---|
| `--looks-like WxH` / `--scale N` | display size in points, or as a percentage (125 = same size as the MacBook) |
| `--vsync` | flip only at refreshes (the old default) |
| `--tearing` | flip the moment a frame arrives, seams and all |
| `--no-color-profile` | don't colour-manage for this panel |
| `--no-input` | don't use this laptop's trackpad and keyboard on the Mac |
| `--lossless-only` | never fall back to H.264 |
| `--h264` | ask for H.264 motion (old behaviour) |
| `--verbose` | statistics every second |
| `--test-card` / `--test-drag` | sample text and colours with a moving box / dragged as a window over the desktop |
| `--window WxH` | small test window instead of full screen |
| `--host ADDR` | the Mac's IPv6 cable address (`fe80::…%N`) if auto-discovery fails |
| `--dump FILE` / `--decode-test FILE` | save the H.264 stream / decode a saved one offline |

## Protocol (v2)

Two TCP connections from Windows to the Mac's port 48100 over the cable's IPv6 link-local
addresses. **Control**: Hello (24 bytes; the screen, the size in points, flags, then the
panel's colour profile if sent) → Welcome with a token; then the pointer (position polled at
1 kHz, shape when the window server's cursor seed changes), heartbeats every 100 ms both
ways, clock sync, goodbye (Mac sleeping or quitting), and the laptop's input (pointer
moves, buttons, scrolling, Mac key codes, modifier changes and composed characters, 16 bytes
each; `windows/Input.cs`). **Frames**: Join with the token,
then frames (32-byte header with the capture time, then rects: raw, LZ4, or H.264 plus the
16×16 regions to take from it) and acks the moment a frame is in the receiver's picture, at
most two frames in flight. Details in `mac/usbc-display.m` and `windows/Link.cs`.

**Setup status** (first-run setup, `windows/setup/CONTRACT.md` section 1): a third kind of
connection, also cable only. The setup app sends Query (16 bytes: the actions to take, and its
version); the Mac answers with Status (32 bytes: the permission and login-item bits, its app
and protocol version, the macOS version, a refuse reason) and keeps the connection open,
sending Status again within a second whenever a bit changes. Further Queries run more actions:
ask for Screen Recording or Accessibility (the first ask shows macOS's prompt, later ones open
the page in System Settings), open Login Items, restart the Mac side so a new grant takes
effect, or move the app to Applications (restart and move wait while a screen is showing).
The setup app asks every 5 s; the Mac drops a connection that is quiet for 15 s, and the
oldest when a fifth one opens. None of it needs Screen Recording or a running screen. A Hello with flag 1024
gets a Status with refuse reason 1 instead of a silent close when Screen Recording is missing.
Mac builds from before this close the connection, which the setup app reads as "update the
Mac app".

## Building

- Mac: `mac/build.sh` (clang from Xcode or the command line tools). It signs with a
  local self-signed certificate, which `setup-signing.sh` creates once in its own
  keychain file. That keeps the Screen Recording permission valid across rebuilds;
  an ad-hoc signature would need approving again after every build.
- Windows: `dotnet publish windows/UsbcDisplay.csproj -c Release -o windows/app`.
  `Start USB-C Display.cmd` points `DOTNET_ROOT` at `%USERPROFILE%\.dotnet-sdk`.
- Test tools: `tools/linkbench/usbc-bench.c` (Mac) and `tools/UsbcSink` (Windows) run the
  link experiments above; `movemouse.c`, `curpos.c` and `scalebench.c` move/read the Mac's
  pointer and measured the Lanczos fit. `tools/tests/` has the end-to-end test scripts (see
  its README). `tools/FakeMac` is a stand-in for the Mac side that still speaks the old (v1)
  protocol.
- `PLAN.md` is the investigation and plan this version came from, with its measurements.

## Layout

| Path | |
|---|---|
| `mac/` | the Mac side: `usbc-display.m`, `build.sh`, `setup-signing.sh`, `install-agent.sh` |
| `windows/` | the receiver (`*.cs`, `UsbcDisplay.csproj`) and `watcher/UsbcWatcher.cs` |
| `tools/` | link bench, sink, recovery-task scripts, tests |
