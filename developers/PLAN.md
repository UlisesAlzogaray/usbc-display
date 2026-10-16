# Plan: make the laptop look and feel like the MacBook's own screen

## Status, 2026-10-15 (done the same day; details and numbers in HOW-IT-WORKS.md, which was the README then)

| Stage | Outcome |
|---|---|
| 0B link | **Cause found: TSO super-packets** (multi-frame ThunderboltIP packets), not a byte budget. R0 froze (twice within 2 MB of a fresh link); R1 (IPv4 + `IP_OPTIONS`, no TSO) passed 20 GB, then a 100 GB soak; R0-v4 (same socket with TSO) froze after 0.2 GB on a link that had just carried 45 GB; R4 (Windows → Mac, 10 GB) passed. The freeze is one-way: Windows stops receiving while Mac-bound UDP probes still arrive. R6: restarting only the network adapter doesn't help; the root-router restart does (35–86 s). Not needed: R2, R3, R5, R-rot, R-mtu, sudo. |
| 2 | **Better than 2A:** IPv6 with sends limited to two segments (`TCP_NOTSENT_LOWAT` = 1), so no packet spans two 4 KB frames. 100 GB at 952 MB/s, no freeze, no root, no 19 s IPv4 wait. `IPV6_DSTOPTS` (the IPv6 per-socket option) needs root. |
| 1 | Present thread showing the newest frame, acks on apply, pointer on its own connection (0.2 ms median), clock sync (±0.1 ms), stats, agent locked to the cable. |
| 3 | Exact pixels by default, LZ4 on all cores; H.264 only if a frame can't cross the link within ~14 ms. Verified pixel-exact end to end (0 of 6.9 M values differ). The per-second CRC checks weren't built; the screenshot comparison replaced them. |
| 4 | Silent recovery through scheduled tasks (one UAC at setup), tested twice: receiver 32 s, watcher ~10 s. The last picture stays up; it hides on unplug, goodbye (Mac sleep/quit), Esc and Ctrl+Alt+Esc. |
| 5 | Sizes in the popup, incl. "same size as on the MacBook" (1536×960). Scaler: SCK is bilinear (45.8 dB match); a Lanczos fit (vImage in 16 strips, Metal was 6 ms) matches Lanczos at 52.4 dB. Colour: the panel's factory ICC is assigned to the virtual display through ColorSync (popup checkbox, on by default). Pointer: Windows' pointer shadow off while shown; hiding while typing follows `CGCursorIsVisible` (not verified by typing). |
| 6 | **Scan-line sync instead of VRR:** flips as soon as the panel's current line is clear of the change (no seams). Median capture → panel 11 ms against 25 ms with vsync in the same conditions. The panel's EDID allows 40–60 Hz VRR; not used. |
| 7 | Measured with synced clocks (README). The 240 fps phone comparison is still yours to do. |
| Left | Mac-wide TSO off (`sudo sysctl -w net.inet.tcp.tso=0`, made persistent) would protect "Data transfer" copies too; needs your consent. |

**Targets used for acceptance throughout.** Each target says what proves it.

- **Picture.** What the laptop panel shows equals what macOS rendered, with at most one resample step that we choose. No soft or stale blocks. Three separate checks prove it:
  1. the receiver's memory copy equals what the Mac sent (CRC32C every second);
  2. the GPU canvas equals the same checksum (staging copy every 10 s), and the Windows gamma ramp is the identity;
  3. the capture equals macOS's own screenshot of a still test card (Stage 5b).
- **Latency.** On average, no more than one refresh (16.7 ms) behind the MacBook's own panel. Two metrics, because the two 60 Hz clocks drift against each other over a cycle of about 5.6 min:
  - **Code metric, which doesn't depend on that drift:** at least 99% of frames applied before a refresh deadline appear at that refresh (`SyncQPCTime`, matched by PresentCount).
  - **Felt metric:** capture → display, measured over at least 6 min (one full drift cycle) or at least 3 sessions, and reported against where in the refresh cycle frames arrived.
- **Pointer.** Every movement the Mac's input device reports reaches the laptop within 1.5 ms (p95), with no gap over 20 ms while it moves, whatever the picture is doing.
  - The built-in trackpad reports every 8 ms (125 Hz, `ReportInterval` 8000 µs), so "240 updates a second" was impossible and is withdrawn.
  - Measured with synced clocks whose error bound is ≤ 0.3 ms. It stays a hypothesis until measured.
- **Reliability.**
  - Zero wedges across at least 30 GB in a single link session (about 10× the largest wedge), plus 8 h of normal use, part of it with your usual network extensions on.
  - If a wedge happens anyway: it recovers with no prompt, within the reset time measured in Stage 0. Today a router reset takes about 47 s; the target is set once R6 explains why.
  - The last picture stays on screen only while that recovery runs. The window hides at once if you unplug, the Mac quits or sleeps, or you press Esc or the global hotkey.

---

## 1. Diagnosis

### 1.1 Why the first tests felt better (checked in our logs, but not yet against your eyes)

| | First tests (14:17, `recv-real.log`, `recv-sweep-raw.log`) | Now (`%LOCALAPPDATA%\UsbcDisplay\receiver.log`) |
|---|---|---|
| Showing frames | Tearing allowed: "frame to screen 0.2–0.4 ms" | Synced to refresh (default since `Program.cs:32`): "60 fps … frame to screen 16.61 ms" for more than 10 s in a row |
| Picture | Raw tiles, exact in every frame | H.264 while anything moves; exact only 80 ms after it stops. Saved Scale = 100, so macOS draws this display at 1x, not 2x |
| Pointer | Drawn into the captured picture, so it moved exactly with the content | Windows' own cursor, but its messages share the frame socket and the receive thread |

**Where the 16.61 ms comes from (H.264 mode):**
- After applying a frame, the receiver calls `Present()`. That blocks until the next refresh (`Native.cs:240`), and only then does it acknowledge the frame (`Program.cs:421-427`). The Mac allows 2 frames in flight (`usbc-display.m:79`).
- While anything moves, the Mac also sends refresh frames for tiles that have settled (`.m:557-564`), and those take the same two slots. So the Mac offers more than 60 frames a second, while the receiver can finish only one per refresh.
- Result: one frame always waits in the socket. That alone explains the logged run. The 60.000 Hz vs 60.003 Hz argument isn't needed.
- The pointer is read in the same loop, so it waits behind that frame.

**Raw mode probably has a smaller backlog than we said.** It sends no refresh frames, and any frame ScreenCaptureKit skips drains the queue.
- The earlier "55–62 ms vs 20 ms" and "30–35 ms gain" figures were modelled, not measured.
- The "55–56 fps captured" figure is weak evidence. The sweep lasts 1.5 s, runs on a timer that isn't synced to the display (`.m:832`), and the 1 s stats windows overlap its start and end.
- Stage 1 measures the backlog directly before any gain is claimed.

**The README's latency numbers don't describe real use.**
- The "6 ms" comes from `--bench`, which paces frames with a timer and never builds the queue.
- The "~1 ms raw" figure was measured with tearing allowed.
- Both stop the clock when `Present()` returns, not when the frame actually appears on the panel.

**H.264 doesn't escape the wedge; it only delays it.**
- The hybrid averaged 6–13 MB/s while active.
- A normal session arrives as about 12 KB packets (170 MB in 14,357 packets).
- If the 2–3 GB budget is real, continuous activity still wedges after about 3–7 minutes.

**Your own observation was never tested directly.** Everything above is inferred from logs. Stage 0A shows you the first-test setup next to today's, blind, before any engineering.

### 1.2 The link: the wedge is real, but "an unavoidable 2–3 GB budget" is unproven

**Established:**
- Four wedges, at 2.24, 2.35, 2.56 and 3.07 GB, across a 20× range of send rates.
  - Each run began on a freshly re-identified link (14:32:52, 14:44:34, 14:48:31, 14:57:51), so these are bytes since link-up.
  - Mean 2.56 GB, SD 0.36. The 95% prediction interval for the next wedge under the same conditions is **1.3–3.9 GB** (mean ± t(3)·SD·√1.25).
- A root router restart or a replug recovers it.
- Windows doesn't advertise end-to-end flow control (`prtcstns` 6, against the Mac's 0x80000003).

**Never varied. All four wedges shared every one of these:**
- **Packet shape.**
  - Mac TSO is on: the Mac builds super-packets of up to 64 KB, and ThunderboltIP passes them whole, split into 4 KB link frames that Windows reassembles.
  - On the Mac, en2's average dequeued packet is 33.8 KB (11.09 GB / 327,794, from `netstat -qq -I en2`).
  - Windows received 38–51 KB packets at the wedges, i.e. 10–16 link frames each.
  - Reassembling multi-frame packets is the part of this protocol that needed fixes elsewhere (Linux's "64k == 16 frames").
- **Bursts and data in flight.**
  - Each frame goes out in one `send()` of up to 9.2 MB (`.m:621`). SO_SNDBUF is 8 MB (`.m:1069`), Windows' receive buffer is 32 MB (`Link.cs:129`), and there is no end-to-end flow control.
  - The "100 MB/s" runs were really about 2 GB/s bursts with sleeps between them.
- **Connection versus link.** Each wedge run used one new TCP connection on one new link session, so a budget per connection can't be told apart from a budget per link.
- **Power over the data cable.**
  - Windows' Kernel-Power 105 events show it on battery from 14:31:38 and switching to AC at 14:57:58, which brackets all four runs.
  - The switch to AC came 7 s after the 14:57:51 replug. That fits power arriving over the data cable (hypothesis).
  - Run 4's "Mac on wall power" doesn't rule this out: on its 30 W adapter, the Mac may still have been powering the laptop.
  - Power over this cable already caused the ~15 s link flapping.
- **Everything else:** IPv6, Mac→Windows only, one port, a cable running at 20 Gb/s (Gen2 ×2) although both ends support 40, and VPN state not recorded.

**Withdrawn evidence:**
- **The "bridge0 already received 24.4 GB from the laptop" argument.** bridge0's counters don't measure the cable:
  - over 45 s idle, Windows sent 2,626 B and bridge0's input counters didn't move;
  - bridge0's output counts Mac→Windows bytes twice;
  - en2 has output counters only.

  From now on, Mac-side numbers come only from en2 output and `netstat -qq -I en2`. Windows→Mac traffic is counted by the receiving application and by Windows SentBytes.
- **The fit "1.64 GB + 13.7 KB × packets".** It mixed bytes counted from when the script started with absolute packet counters.

**Hints not yet used:**
- In `recv-bench60.log`, the last second before wedge 2 had 27 frames averaging 30.56 ms, against 6.4–7.1 ms steady. That is about 0.6 s of stall that recovered before the link died. It points to a loss or timeout first, rather than a counter cleanly running out. Counters sampled once a second can't resolve this, so Stage 0 logs at 10 Hz with timestamps.
- "Dead in both directions" isn't shown: a ping needs both directions, so a one-way stall looks the same.
- **Resets are not local.** Restart-NetAdapter on Windows at 15:07:28 made the Mac log en2 link_off and then link_on 116 ms later. So which reset recovers the link tells us the cheapest reset, not whose state was stuck.

**Recovery timing (`reset.log` lined up with the Mac's own log):**

| When | What |
|---|---|
| 15:07:57 | Root router restart starts (pnputil returns at 15:08:02) |
| 15:07:58.39 | Mac: en2 link_off |
| 15:08:11 | Windows: "Identificando red" |
| 15:08:12.79 | Mac: link_on, 14.4 s after the restart. IPv6 link-local published 10 ms later |
| 15:08:32.16 | Mac: IPv4 link-local 169.254.230.136 published, 19.4 s after link_on (18.4 s in a second case). It is removed whenever the link drops. Windows' 169.254.29.64 exists immediately |
| 15:08:45 | First successful ping: **32 s after both sides reported the link up.** Cause unknown |

- Hypotheses for the 32 s: Windows' neighbour cache or neighbour-unreachability detection, duplicate address detection, ThunderboltIP path setup, or the ping interval.
- No UAC prompt, socket timeout or PowerShell start-up falls inside that window.
- "Restart-NetAdapter doesn't help" rests on one 27 s wait after link_on, which is shorter than the 32 s the successful reset needed. So it is unproven.

### 1.3 Assumptions that were wrong or unproven

| What we designed around | Status |
|---|---|
| The wedge is an unavoidable byte budget, so we must compress | Unproven. Packet shape, bursts and data in flight, connection vs link, and power were never varied (1.2) |
| Lossless needs too much bandwidth | Wrong. Full-screen change at 1920×1200, 60 fps = 553 MB/s, 28% of the measured 1.96 GB/s |
| The H.264 path takes about 6 ms | Only in the bench. In motion the log shows a frame of queue (16.61 ms frame to screen) on top |
| Syncing to the refresh costs a queued frame | Wrong. Our acknowledge-after-present loop plus more than 60 offered frames a second does. Syncing with "newest frame wins" doesn't |
| Recovery takes 43 s because of the prompt and our timeouts | Mostly wrong. The router reset itself takes about 47 s (14.4 s for the link to come back plus 32 s unexplained). Fixing that is R6's first job |
| "Looks like 1280×800" has to be shrunk by ScreenCaptureKit | No. We can capture 2560×1600 and shrink it with a filter we choose |
| 1:1 is the sharpest | Only pixel for pixel: it makes macOS render at 1x, while the MacBook always renders at 2x |
| Colours are right because both sides say sRGB | The panel covers about 66% of sRGB. Modelled mean ΔE2000 is 4.3, and 9.1 for macOS blue. The model uses ASUS's per-model profile, not a measurement of this unit |
| The pointer is independent of frames | Only on screen. On the wire and in the receive thread it waits behind frames. The trackpad reports at 125 Hz anyway |
| The link runs at 40 Gb/s | It runs at 20 Gb/s (Gen2 ×2); the cable is the likely limit |
| Only the cable can reach the agent | Wrong. It listens on `*:48100` on both IPv4 and IPv6 (`.m:1047-1053`), and the Mac firewall is off. Anyone on the home Wi-Fi can make your Mac add a virtual display and stream it. Fixed in Stage 1 |

**The fundamental problem:** we designed around the symptom (bytes) without ever varying the traffic that triggers it, and in doing so gave up exact pixels. Separately, our acknowledge-after-present loop, together with more than 60 offered frames a second, added a frame of queue during H.264 motion, which we blamed on refresh sync. That second problem doesn't depend on the cable. Neither was checked against what you see; Stage 0A does that first.

---

## 2. Stage 0: check what you liked, then find out whether the link can carry lossless frames

### 0A. Blind comparison of what changed since the first tests (15–20 min, before any engineering)

| Arm | Flags (existing) | What it is |
|---|---|---|
| A | today's default | H.264 hybrid, synced to refresh, hardware cursor |
| B | `--tearing` | Same, but frames shown immediately |
| C | `--raw --tearing --no-cursor` | The first-test setup: exact tiles, tearing, pointer drawn into the picture |

- **How it runs:**
  - I switch between arms without telling you which is which. All arms use your saved scale.
  - Each arm runs 3–4 min while you do the same things: type, scroll a long page, drag a window, move the pointer over text.
- **Keeping arm C safe from the wedge:**
  - A watchdog switches arm C to arm A once 1 GB has been received since link-up (Windows ReceivedBytes, baseline taken at link-up).
  - Before each C arm, I reset the link with the recovery task (no prompt), which gives a fresh budget.
  - Continuous raw scrolling uses about 1 GB in 3 s, so keep scrolls short in C.
- **What happens with your ranking:**
  - If you prefer B or C, Stage 1 adds a "Lowest latency (may show tear lines)" choice to the popup straight away instead of waiting for Stage 6.
  - If C wins because of the pointer, pointer-in-picture becomes the leading option in Stage 5e.

### 0B. Link test

**Cost to you, counted honestly**

| Path | What you do | Elapsed time |
|---|---|---|
| Setup (always) | Quit the watcher from its tray icon. Quit VPN apps. Answer 3 questions. Approve **1 UAC prompt** to register the recovery task | about 10 min |
| Likely path (R0 → R6 → R1 → R0-v4 → soak) | **1 sudo** (R6 step b, one script) and **1 UAC** (R6 steps c and e, one script). No replugs. Afterwards: turn VPN back on | about 40 min; you're needed for about 10 |
| Worst path (everything wedges → Branch F) | Additionally: R2 (1 UAC, plus 1 to undo), R-mtu (2 sudo), R1-sysctl (2 sudo), R5 (1–2 cable/charger moves). Each wedge still recovers with no prompt | 1.5–2 h; about 10–12 actions in total |
| Never without asking you separately | Driver rollback, retrying KB5127648, a Mac-wide TSO LaunchDaemon, static IPv4 addresses | — |

- **Without the recovery task,** every reset is a replug instead: about 4–6 replugs on the likely path.
- **Stop point:** after R0, R6 and R1 (about 20 min) you can say "enough". What we know by then either picks the branch, or we ship Stage 1 and Stage 4 on H.264 in the meantime.

**Setup**

| # | Who | What |
|---|---|---|
| P1 | Me | **Build test tools outside the product.**<br>`UsbcSink.exe` (`usbc-display\tools\UsbcSink`, about 100 lines): reads frames and acknowledges them immediately. No Direct3D, no window, no link recovery. It also samples `GetIfEntry2(48)` at 10 Hz, sends and answers numbered UDP probes, and has `--ipv4` (bound to 169.254.29.64), `--rcvbuf` and a reverse-bulk mode for R4.<br>The Mac test sender is built to `/tmp/usbc-bench`, so the agent's signed binary isn't touched. It adds `--v4` (AF_INET, `IP_BOUND_IF` = bridge0), `--ipopt-nop`, `--sndbuf`, `--wsize`, `--pace`, `--rotate MB`, `--flows N`, a UDP probe responder, `TCP_CONNECTION_INFO` logging at 10 Hz (retransmits, srtt, `snd_sbbytes`) and a clock ping/pong.<br>The real receiver gets a `--no-recover` flag. |
| P2 | Me | **Logging: 10 Hz, timestamped on both machines, with clocks aligned by the bench's ping/pong.**<br>Windows: Received/Sent bytes and unicast packets, both absolute and since link-up. Every second: `RscStatistics` (CoalescedPackets, CoalescingEvents, CoalescingExceptions), deltas of `netstat -s -p tcpv6` and `-p ipv6`, `BatteryStatus` (PowerOnline, ChargeRate, DischargeRate) and `\Processor(*)\% DPC Time` and `% Interrupt Time`. Also Kernel-Power 105 and PnP 1010 events.<br>Bench and sink: the longest send→acknowledgement per 100 ms, and the mode each side ran in.<br>Mac: `netstat -qq -I en2` (queue length, dequeued packets and bytes, stalls, drops) at 10 Hz. Every second: `ioreg -r -c AppleThunderboltIPTransmitter -l` and `top` including kernel_task. Throughout: `/usr/bin/log stream` for en2/bridge0 link_on/off and address publishing. Before and after each run: `pmset -g batt` and `system_profiler SPPowerDataType`. |
| P3 | You, on Windows | Quit the USB-C Display watcher from its tray icon; I restart it at the end. Otherwise its popup reappears after every recovery, and a stray Enter would start screen mode mid-test. **Decline any UAC prompt you didn't expect.** |
| P4 | You, on Windows (1 UAC) | Approve registering the recovery task (defined in Stage 4). After that I reset the link between runs with no prompt and no replug. Undo: `Unregister-ScheduledTask`. During Stage 0 nothing triggers it automatically: only my harness runs it, and only after R6 has finished. |
| P5 | You, on the Mac | Quit VPN apps from the menu bar, and check that System Settings › Network › VPN & Filters shows nothing active (Apple bug FB21256925: packet-filter extensions can stall the Thunderbolt Bridge). Tell me whether you normally keep them on. Keep both laptops on their own chargers, and tell me which charger each one uses. |
| P6 | You | Answer three questions: (a) Do you have a cable marked 40 Gbps, Thunderbolt 4/5 or USB4 40? (b) Settings › System › Display › Graphics: is there a "Variable refresh rate" switch? (c) Retry the failed update KB5127648 *before* Stage 0 (one reboot), or not at all? Retrying it mid-experiment would change the USB4 stack and confound the results. |

**Rules for every run**
- **Start on a fresh link.**
  - Reset with the task (or replug), then wait until UDP probes pass in both directions. For IPv4 runs, also wait until the Mac publishes its IPv4 address, and record how long that took.
  - Record absolute counters at link-up, at run start and at the wedge.
  - On the first reset, check whether Windows' adapter counters restart at link-up.
- **Same power arrangement for R0 and R1:** both laptops on their own chargers. Logged in every run.
- **Use the sink,** which acknowledges immediately (as the old tearing receiver effectively did), so "full speed" really is full speed. Each log records the receiver mode, so a capped run can't be mistaken for a throughput result.
- **Wedge:** received bytes since link-up frozen for 3 s while the sink sees no data. Everything is recorded at that moment. The first wedge is left wedged for R6.
- **Stall:** any send→acknowledgement gap over 50 ms. A run with a stall doesn't pass, even without a wedge.
- **Pass:** 10 GB since link-up with no wedge and no stall. That is 2.6× the top of the 1.3–3.9 GB band where 95% of baseline wedges should fall.
- **Before shipping:** a soak of 100 GB at 553 MB/s, then 200 GB at full speed.

**Runs**

Run them in this order and stop at the first one that settles the question. Each run changes one thing from R0.

| Run | Change from R0 | You | Time | What it tells us |
|---|---|---|---|---|
| **R0** control | IPv6, TSO on, 9.2 MB writes, SO_SNDBUF 8 MB, Windows buffer 32 MB, full speed, up to 10 GB | R6 below | 1 min + R6 | **Must wedge**, normally within 1.3–3.9 GB. Confirms the baseline still reproduces under fixed conditions. Its wedge is used for R6 |
| **R1** candidate to ship (no sudo) | IPv4 bound to bridge0, and `IP_OPTIONS {NOP,NOP,NOP,EOL}` on the accepted socket. XNU only uses TSO when a socket has no IP options. The return value is logged, and the run aborts on error. 10 GB at 60 fps, then 10 GB at full speed | Nothing | 2 min + the IPv4 wait | Whether turning TSO off for our socket alone fixes it.<br>**Valid only if** en2's average dequeued packet is about 1.5 KB (`netstat -qq`), checked against Windows' corrected wire count (ReceivedUnicastPackets + CoalescedPackets − CoalescingEvents).<br>Also gives top speed and CPU with TSO off, including DPC time |
| **R0-v4** control | R1's IPv4 socket without the option (TSO on) | Nothing | 1 min | Only if R1 passes. **Must wedge.** That shows TSO is the cause, not IPv4 and not a change in conditions |
| **R-soak** | R1's setup: 100 GB at 60 fps, then 200 GB at full speed | Nothing | about 7 min | Confidence to ship 2A |
| **R1-sysctl** (diagnostic) | `sudo sysctl -w net.inet.tcp.tso=0`, IPv6; set back to 1 straight after | 2 sudo | 3 min | Only if R1's packets aren't about 1.5 KB, i.e. the per-socket option didn't work. Tests the TSO hypothesis anyway |
| **R-mtu** | TSO off, plus Mac MTU 4070 (exactly one ThunderboltIP frame), then 9000. Or `--flows 2..4` | 2 sudo | 5 min | Only if TSO-off full speed is below 1.5 GB/s, or R1 wedged early. Separates packet rate from packet size |
| **R-rot** | The sender reconnects every 512 MB, opening the new connection before closing the old one | Nothing | 1 min | Budget per connection, or per link? A pass means rotation (2D) |
| **R3a** data in flight | Unpaced 9.2 MB writes, Mac SO_SNDBUF 1 MB, sink receive buffer 1 MB | Nothing | 1 min | Overrun by too much data in flight. A pass means small buffers (2B-buffers) |
| **R2** RSC off | `Disable-NetAdapterRsc -Name 'Ethernet 4'` (undone at restore) | 1 UAC | 2 min | Whether Windows' receive coalescing is the faulty path |
| **R3b** line-rate bursts | Buffers kept at 8 MB / 32 MB. Single 64 KB writes (one TSO packet each), spaced by a `mach_absolute_time` spin at 300 MB/s. If that passes: 600, 1000, 1500 MB/s | Nothing | 4 min | Whether bursts at the scale of one TSO packet are the trigger |
| **R4** reverse | The sink writes 1 MB buffers to the bench's receive port, up to 10 GB. Counted by the Mac application and by Windows SentBytes | Nothing | 2 min | Whether volume from Windows to the Mac wedges, and whether Windows also sends super-packets. Also calibrates bridge0's input counter once |
| **R5** port or cable | The laptop's other USB-C port (if the charger has to move, that's logged as a power change). Then a 40 Gb/s cable, which `system_profiler SPThunderboltDataType` must report as 40 Gb/s | 1–2 moves | 5 min each | Whether signal quality or one router instance is to blame |

**R6: diagnose the first wedge (R0's).** It runs from two scripts: one sudo on the Mac and one UAC on Windows.
- **State snapshots** are taken automatically before and after each step, on top of the 10 Hz log: `netstat -qq -I en2`, the ioreg transmitter state, Mac link events, Windows adapter status and counters, PnP 1010 events, and `Get-NetNeighbor` for the Mac's address.
- **Steps.** Each one waits until UDP probes pass in both directions, or 90 s.
  - **(a) Direction (no sudo).** Numbered UDP probes every 200 ms, Windows→Mac and Mac→Windows, counted by the receiving application. ICMP in both directions for comparison.
  - **(b) Mac interface bounce** (`r6-mac.sh`, 1 sudo): `ifconfig en2 down; sleep 2; ifconfig en2 up`.
  - **(c) Windows network adapter device** (`r6-win.ps1`, 1 UAC): `pnputil /restart-device "USB4\VEN_0A27&DEV_0000000A&PROT_USB4NET\5&1F2E759C&0&2"`. This is the same device Restart-NetAdapter cycles, now given 90 s instead of 27.
  - **(e) Root router** (same script; known to work): `pnputil /restart-device /deviceid "USB4\ROOT_DEVICE_ROUTER&VID_QCOM&PID_0CD1"`.
  - The old step (d), the Qualcomm host router, is dropped: it is the parent of (e), so it can't show whether the cheaper (e) is enough.
- **Recovery timeline.** For the step that works, and for every task reset during Stage 0, record:
  - when the reset started and returned;
  - Windows adapter Up;
  - Mac link_on;
  - IPv6 and IPv4 link-local addresses published;
  - neighbour-state changes;
  - the first UDP probe in each direction, the first ICMP reply, the first TCP connect to 48100 and the first frame.

  The goal is to explain the 32 s.
- **Reading R6:**
  - The step that recovers gives the cheapest reset for Stage 4. It doesn't say whose fault it was, because each reset tears down both ends.
  - Where the fault is comes from the snapshots:
    - Mac en2 dequeued count frozen while its queue length is above 0: the Mac's interface isn't draining. Report that to Apple with this evidence.
    - Dequeued count still rising while Windows' receive counters are frozen: packets are lost in between, or on Windows' receive side.
    - Probes from Windows reach the Mac while the reverse fails: the stall is one-way.

**Decision tree**

1. **R0**
   - **Wedges** (record it if outside 1.3–3.9 GB) → run R6, then R1.
   - **Doesn't wedge** → something we changed in setup matters. Put things back one at a time, repeating R0 after each:
     1. the old power arrangement (Windows charger unplugged);
     2. the exact old receiver (`UsbcDisplay --raw --tearing --no-recover`, which is fullscreen for about 1 min);
     3. VPN apps.

     The first one that brings the wedge back → **Branch 2F**. If none does → Stage 2 acceptance on the unchanged path, with permanent logging.
2. **R1** (with a valid packet shape)
   - **Passes** → run R0-v4.
     - R0-v4 wedges → large multi-frame packets are the trigger → R-soak → **Stage 2A**.
     - R0-v4 passes → repeat R0 over IPv6 once.
       - It wedges → the IPv6 path is the trigger → **Stage 2A'**.
       - It passes → conditions drifted → go to "R0 doesn't wedge" above.
   - **Packet shape not about 1.5 KB** → run R1-sysctl.
     - If it passes, TSO is the trigger but the per-socket method doesn't work. Fix the per-socket path, or use the opt-in Mac-wide setting, which needs your explicit consent.
   - **Wedges below 1.3 GB** → something counted in packets or link frames, or Windows' acknowledgement path. TSO off multiplies Windows' acknowledgements by about 30×, so check SentUnicastPackets. Go to R4 and R-mtu, and skip R-rot, R3 and R2.
   - **Wedges at 1.3–3.9 GB** → the trigger is bytes, not packet shape. Run R-rot, R3a, R2, R3b and R5 in that order. The first one that passes picks its branch (2D, 2B-buffers, 2C, 2B-pacing, 2E), followed by R-soak in that setup.
3. **Throughput.** If the chosen setup's full speed is below 1.5 GB/s, try R-mtu (4070, then 9000) or `--flows`, and pick the cheapest that reaches 1.5 GB/s.
   - Otherwise, write down the relaxed Stage 3 full-screen target, using the formula in Stage 3.
   - Note: 1.5 GB/s at 1.5 KB packets is about 1 M packets a second, which is probably beyond one Windows core without RSS. Expect to need MTU 4070 or 9000.
4. **Everything wedges, R-rot included** → a budget per link session. R4 and R6 show whose side is stuck → **Branch F**. Planned resets (F2) only after you've seen the reset time R6 measured.
5. **Every branch:** keep Stage 4 as insurance. Wherever the IPv6 TSO-on bench still wedges, it serves to provoke wedges on demand for testing.
6. **After a variant passes:** one 10 GB run with your usual network extensions on.

**Restore at the end**
- TSO back on (`sudo sysctl -w net.inet.tcp.tso=1`; it also resets at reboot), if R1-sysctl ran.
- `Enable-NetAdapterRsc -Name 'Ethernet 4'`, if R2 ran.
- Mac MTU back to 1500, if R-mtu ran.
- Cable back on its original port.
- VPN apps back on.
- Watcher restarted.
- `/tmp/usbc-bench` deleted.
- The recovery task stays only if you want Stage 4.

---

## 3. Implementation stages, in priority order

Stage 1 doesn't depend on Stage 0B and can start right away. Stages 2 and 3 follow the branch Stage 0 picks. Stage 4a ships together with Stage 1.

### Stage 1: show the newest frame at each refresh; give the pointer its own channel; lock the agent to the cable

**Measure first.** These numbers are needed before any gain is claimed:
- the time from header to `Present`, and the socket backlog (`ioctlsocket FIONREAD`), during the same H.264 scroll and the same short raw burst;
- ScreenCaptureKit capture intervals, with the test card's animation driven by `CVDisplayLink` instead of a timer.

**Changes**
- **Frame format v2, used from now on.**
  - A frame is a header (sequence number, capture time), then length-prefixed chunks, each read in one call, then an end-of-frame marker.
  - Stage 1 sends one chunk per frame; Stage 3 streams many.
  - This replaces today's one `Receive` per 16-byte rectangle header (`Program.cs:337`).
- **Two threads on the receiver** (`Program.cs` `Receive`, lines 257–447; `Native.cs` `Renderer`):
  - **Link thread:** applies each chunk to a *staging* canvas texture. At the end marker, under the lock, it copies that frame's rectangles into the presented canvas, then acknowledges "applied" with the body-complete and applied times. A half-received frame is never visible.
  - **Present thread:** waits for the frame-latency waitable, then, if there is new content, does `CopyResource` and `Present(1,0)` under the same lock.
  - Frames that arrive within one refresh merge ("newest wins"). One lock covers every use of the Direct3D context.
- **Stats message.** The real display time, from `GetFrameStatistics` (`SyncQPCTime`, matched by PresentCount), plus each frame's arrival time relative to the next refresh.
- **Pointer and control connection.** A second TCP connection: Hello flag `HELLO_POINTER_CHANNEL`, Mac listening on port 48102, bound to bridge0, during a session. It carries the pointer, heartbeats, clock sync and stats.
  - **Mac, position:** polled at 1 kHz from a timer on a dedicated `QOS_CLASS_USER_INTERACTIVE` queue, and sent the moment it changes. That cuts polling delay from about 2.1 ms to 0.5 ms. The poll timestamp goes in `MouseMsg.pad` (12 spare bytes).
    - No `NSEvent` monitor: its handlers run on the main thread.
    - A listen-only `CGEventTap` on its own run-loop thread may be tried as an experiment, checking that it doesn't trigger a privacy prompt.
  - **Mac, shape:** checked 120 times a second on the main queue (today 30, `.m:515`), and sent through the pointer queue.
  - **Mac, priority:** the pointer socket gets `SO_NET_SERVICE_TYPE = NET_SERVICE_TYPE_VO`. The frame socket gets `TCP_NOTSENT_LOWAT` of about 256 KB, so bulk data waits in our process instead of ahead of the pointer in the kernel.
  - **Mac, cleanup:** remove the pointer branch from `senderThread` (`.m:539-555, 578-581`). Bench mode keeps the pointer: drop `!gBench` at `.m:955`, and use `CGMainDisplayID` for it in bench mode.
  - **Windows:** a dedicated pointer thread, registered with MMCSS (`AvSetMmThreadCharacteristics`), calls `SetCursorPos`.
- **Heartbeats every 100 ms on the control connection,** independent of the frame sender. `senderThread` can block for up to 1.2 s on VideoToolbox (`.m:417-419`) or inside `sendAll`.
- **One clock for both machines,** synced over the control connection:
  - each second, a burst of 8 probes; keep the sample with the lowest round trip, and discard samples with a round trip over 0.3 ms;
  - correct drift with a linear fit over 10 s;
  - log the error bound next to every latency figure.

  Capture time comes from `SCStreamFrameInfoDisplayTime`, converted from mach ticks, and goes in `FrameHeader.reserved`.
- **Agent log.** The p50 and p95 of every metric below, every 10 s. Today stats only print to a terminal (`.m:993`).
- **Lock the agent to the cable** (moved here from Stage 2, since it doesn't depend on Stage 0):
  - IPv6 listener with `IPV6_V6ONLY = 1` and `IPV6_BOUND_IF` = bridge0.
  - After `accept`, the peer's scope ID must equal `if_nametoindex("bridge0")`, or, for IPv4, the local address must be bridge0's 169.254 address. Anything else is closed before Hello.
  - Every `setsockopt` return value is checked and logged.
  - The Wi-Fi fallback is dropped. It comes back only behind the F3 pairing secret.
- **Optional popup choice:** "Lowest latency (may show tear lines)", if you preferred it in 0A.
- **Capture pacing:** change `minimumFrameInterval`/`queueDepth` (`.m:924`) only if the capture-interval log shows frames being dropped.
- **Probes** (no cable traffic):
  - Is the window shown directly ("independent flip")? It is if each frame appears at the first refresh after `Present`.
  - Does the panel do variable refresh rate (VRR)? Present every 20 ms with tearing allowed; display-time gaps of about 20 ms mean yes.
- **README** updated with measured numbers.

**Metric definitions** (used in every later stage)

| Name | From → to |
|---|---|
| apply | body complete → applied (staging copied into the presented canvas) |
| send→ack | Mac `sendAll` start → acknowledgement received |
| shown | applied → `SyncQPCTime` of the refresh that showed it |
| capture→display | `SCStreamFrameInfoDisplayTime` → `SyncQPCTime`, on the synced clock |
| pointer | Mac poll timestamp → `SetCursorPos` returned, on the synced clock |

**Expected gain** (measured before it's claimed):
- One queued frame (about 16.7 ms) less during H.264 motion; for raw, only as much backlog as the measurement shows.
- The pointer no longer waits behind frames (modelled today at 10–35 ms late during motion).

**Risks:**
- Mistakes in locking the Direct3D context. One lock covers every use.
- Losing direct display if anything overlaps the window. The probe detects it.
- Main-queue work delaying the pointer shape (the position is off the main queue).

**Acceptance.** Until Stage 2 passes, no link session may carry more than 1 GB:
- sustained runs use H.264 scrolling (≤ 2 min per link session), or the test card's moving box sized to stay under 1 GB per session (for example 64×64 px, about 3 MB/s raw);
- raw full frames only in bursts of at most 2 s on a fresh link.

The criteria:
- **apply:** p50 ≤ 1.5 ms for raw updates under 0.5 MB; ≤ 3 ms for a raw full frame; ≤ 6 ms for H.264 decode and conversion.
- **send→ack, p95:** raw ≤ bytes ÷ measured link rate + 1.5 ms; H.264 ≤ 7.5 ms.
- **At least 99%** of applied frames shown at the first refresh after they were applied.
- **shown:** p50 ≤ 9 ms, p95 ≤ 17.5 ms, over at least 6 min of the box sweep, reported against arrival phase.
- **Pointer under H.264 load:** every report forwarded within 1.5 ms (p95), with a clock error bound ≤ 0.3 ms, and no gap over 20 ms while it moves. The same check under 553 MB/s raw load moves to Stage 2 acceptance.
- **Heartbeats keep flowing** while the frame sender is artificially blocked for 1.2 s, and the session survives.
- **A connection from Wi-Fi** (192.168.1.45:48100) never produces a Hello session; no virtual display appears.
- **Direct display confirmed,** or whatever forces composition found and removed.

### Stage 2: make the link carry lossless traffic (the variant Stage 0 picked)

**Changes in every branch**
- `sendAll` (`.m:159-168`) writes at most 256 KB per call. Buffer sizes follow Stage 0: 1 MB if R3a passed, 1–2 MB otherwise.
- **Permanent link logging,** every 10 s and at each disconnect, cumulative since link-up:
  - **Mac:** en2 output bytes (`getifaddrs`, output only), and retransmits, srtt and `snd_sbbytes` from `TCP_CONNECTION_INFO`.
  - **Windows:** `GetIfEntry2(48)` bytes and packets in and out, the RSC-corrected wire packet count, discards, and stalls over 50 ms.

**2A: large multi-frame packets are the trigger → TSO off for our connection only**
1. Every session starts at once on the IPv6 connection with today's H.264 hybrid. It carries little data, and you don't wait.
2. The Mac watches `SCDynamicStore` for `State:/Network/Interface/bridge0/IPv4`. When the address appears (about 19 s after link-up), it sends it to Windows (`HELLO_WANT_IPV4`).
3. Windows opens the frame connection over IPv4, bound to 169.254.29.64 on interface 48. It reaches a dedicated `AF_INET` listener on port 48103, bound to bridge0's 169.254 address with `IP_BOUND_IF` = bridge0. The listener is needed because 169.254/16 is also routed through Wi-Fi.
4. Only sockets accepted on that listener get `IP_OPTIONS {NOP,NOP,NOP,EOL}`. The return value is checked; if it fails, the session stays on IPv6/H.264 and logs why.
5. The session switches to lossless at a frame boundary, and falls back to IPv6/H.264 on any link drop.

- **Optional, one admin approval on each side, with undo steps:** fixed IPv4 addresses on the Thunderbolt Bridge service and on Ethernet 4. That removes the 19 s wait.
- **Other traffic from the Mac still uses TSO.** A Finder or SMB copy in "Data transfer" mode would still wedge the link. You choose between:
  - (i) an opt-in Mac-wide TSO-off LaunchDaemon (one sudo; removal steps given; its effect on Wi-Fi speed measured first);
  - (ii) the watcher warns before large copies.
- **Size:** about 150 lines on the Mac, 80 on Windows.

**2A' (the IPv6 path is the trigger):** the same IPv4 path, without the option.

**2B-buffers (R3a passed):** 1 MB send buffer on the Mac and 1 MB receive buffer on Windows. No pacing.

**2B-pacing (only R3b passed):**
- 64 KB writes, paced at 80% of the highest rate that passed 20 GB.
- If that rate is below 1.5 GB/s, Stage 3's full-screen target relaxes to the formula given there, and you are told the number.

**2C (Windows RSC is the trigger):**
- Run `Disable-NetAdapterRsc` once (UAC).
- Register a second opt-in task with a fixed action: `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -Command "Get-NetAdapter | ? InterfaceGuid -eq '{<guid>}' | Disable-NetAdapterRsc"`.
- At each plug, the watcher checks `Get-NetAdapterRsc` (no admin rights needed) and runs that task if Windows has switched RSC back on.

**2D (budget per connection):** the frame connection rotates every N MB, where N is half the smallest amount that passed. Each new connection is set up before the old one closes, and the switch happens at a frame boundary, so you never see it.

**2E (cable or port):** use the port or cable that passed. If a 40 Gb/s cable was the fix, the watcher warns whenever LinkSpeed reads 20 Gbps.

**2F (a condition was the trigger):** document the supported conditions, for example the laptop on its own charger, or a particular VPN. The agent and the watcher log and warn when the condition is present.

**Risks:**
- With TSO off, about 380k packets a second at 553 MB/s; the load is mostly kernel and DPC work.
- Windows may handle IPv4 packets with options on a slower path. The soak measures it.
- RSC may switch itself back on after a replug or reboot.

**Acceptance:**
- **Soak:** 100 GB at 553 MB/s, then 200 GB at full speed, each in a single link session, with zero wedges and zero stalls over 50 ms.
- **Throughput:** a steady 553 MB/s at 60 fps, and at least 1.5 GB/s at full speed (or the relaxed Stage 3 target stated).
- **CPU,** at 553 MB/s and at full speed:
  - Windows: the busiest core stays below 70%, counting `% DPC Time` and `% Interrupt Time`;
  - Mac: total CPU including kernel_task stays within 1 performance core at 553 MB/s (`top`, plus one `powermetrics` run).
- **Pointer under the 553 MB/s raw bench:** p95 ≤ 1.5 ms, with the clock error bound ≤ 0.3 ms.
- **2A:** a 10 GB Finder copy from the Mac to Windows, on a fresh link with the screen running, causes zero wedges. If you declined the Mac-wide option, the limit is documented and the warning works instead.
- **2C:** RSC is still off, or re-applied automatically, after a replug and after a reboot.
- **Real use:** at least 30 GB in one link session plus 8 h, with logging, zero wedges.
- **With your usual network extensions on:** one 10 GB run, plus 2 of the 8 h.

### Stage 3: lossless by default (the first tests' picture, without their problems)

**Changes**
- **The default becomes exact tiles** (today's `buildFrame`, `.m:218-274`), but only after Stage 2 has passed.
  - H.264 is used only on request, or in Branch F.
  - The settle-and-region machinery (`gLossy`, `gTileChanged`, `changedRegions`) leaves the default path.
- **LZ4 off by default.** Single-threaded `compression_encode_buffer` (`.m:261`) takes about 6–18 ms for a full frame, slower than the wire (4.7 ms).
- **Compare only where something changed,** using ScreenCaptureKit's dirty rectangles (`SCStreamFrameInfoDirtyRects`):
  - convert each rectangle to output coordinates;
  - pad it by at least 2 output pixels (the filter's radius);
  - snap it to 64×32 tiles.

  A full compare once a second stays on, even in release builds, until several hours have logged zero misses.
- **Stream each frame while it's being built.** Many chunks per frame, each sent as soon as its tile row is copied. They go into the staging canvas and are shown only after the end marker.
- **Prove exactness continuously:**
  - the receiver's memory copy is compared with the CRC32C of `gSent` every second;
  - every 10 s, the GPU canvas is copied to a staging texture and its CRC compared with the Mac's checksum for the same frame;
  - at session start, the Windows gamma ramp must be the identity.

**Gain:**
- No softness in motion, no trails, no 80 ms settle.
- No H.264 decode or colour conversion (about 5.5 ms today).
- Exactness proven at both the memory and the GPU level.

**Risks:**
- About 100× more bytes per hour than H.264, so this is only safe after Stage 2 passes.
- Mac CPU for comparing and copying at full motion, about 1 ms per frame (estimate).

**Acceptance:**
- zero memory or GPU checksum mismatches in 1 h of use;
- `stale.ps1` on a 40 s `burst.ps1` capture, while dragging a window over the wallpaper, finds 0 off-colour blocks per frame;
- `patches.ps1` against the raw reference shows 0,0,0 for all 10 colour patches, both still and while the test card's box sweeps;
- **capture→display,** over at least 6 min or 3 sessions, reported against phase:
  - small updates (under 0.5 MB): p50 ≤ 12 ms, p95 ≤ 20 ms;
  - full-screen changes: p95 ≤ 3 (capture) + wire time + 2 (apply) + 16 (refresh wait) ms. That is about 26 ms at 1.96 GB/s and 27 ms at 1.5 GB/s;
- at least 99% of frames shown at the first refresh after they were applied.

### Stage 4: fast, silent, safe recovery (insurance in every branch)

**4a ships with Stage 1. 4b follows R6.**

**Changes**
- **The task** (registered in Stage 0 setup; opt-in, and removable with `Unregister-ScheduledTask`): `\USB-C Display\Restart USB4 link`.
  - Its action is the literal `C:\Windows\System32\pnputil.exe /restart-device /deviceid "USB4\ROOT_DEVICE_ROUTER&VID_QCOM&PID_0CD1"`, or the cheaper device R6 found, also in `/deviceid` form.
  - It uses no environment variables (so it can't be redirected), and it covers either USB-C port.
  - It runs "with highest privileges".
  - Before relying on it, the receiver reads the registered action back and checks that it matches exactly. If not, it falls back to today's prompt.
  - `LinkRecovery.Restart` (`Link.cs:169-182`) runs it with `schtasks /run`.
- **When to reset.** All of these must hold:
  - received bytes frozen for at least 1 s;
  - at least 3 failed TCP or UDP probes to the agent over at least 1 s (ICMP alone isn't enough);
  - bytes were flowing just before.

  At most 2 automatic resets per 10 min; after that it stops and shows a notification. Every reset is logged with its reason.
- **Session timeout, separate from resets:** 500 ms without a heartbeat on the control connection → reconnect only, never a reset. Today the timeout is 3 s (`Program.cs:222`).
- **The window:**
  - The last picture stays up, with a small "reconnecting" mark, only while the adapter is present and a recovery is running, and only for the measured recovery time.
  - It hides at once when:
    - the adapter is removed or disconnected;
    - the Mac sends "goodbye" (agent quitting, or `NSWorkspaceWillSleepNotification`);
    - you press Esc;
    - you press a global hotkey (`RegisterHotKey`), which works even without focus.
  - Today it hides on any disconnect (`Program.cs:236`).
- **Faster reconnect:** check the adapter every 100 ms, instead of a 1 s ping loop plus 500 ms sleeps (`Link.cs:184-193`, `Program.cs:216, 253`). The Mac's 90 s grace period already keeps your windows where they were.
- **4b: remove the 32 s gap,** based on what R6 finds. For example, if Windows holds the Mac's neighbour entry as unreachable, the receiver probes or refreshes it. In Branch A, the 19 s IPv4 wait is covered by starting on IPv6/H.264, or by fixed addresses.

**Gain:** no prompt and no blank screen. The time is whatever R6 measures: today about 47 s for a router reset, less if the 32 s gap or a cheaper reset is fixed.

**Risks:**
- A permanent task with admin rights. It is opt-in, explained, reversible, and checked before each use.
- A false reset costs a full outage, hence the strict rule and the rate limit.

**Acceptance:**
- 10 deliberately caused wedges in a row (IPv6 TSO-on bench, in a branch where it still wedges) all recover with no prompt. Each takes no more than R6's measured time + 5 s, from last byte to first new frame.
- The picture stays up during each recovery, and hides within 1 s when you unplug or the Mac sleeps.
- Pausing the Mac agent for 2 s, and turning on the Mac firewall's stealth mode, cause no reset.

### Stage 5: look like the MacBook (size, scaling, colour, refresh, pointer details)

**5a. Size: let you choose, with everything drawn at 2x where possible.**
- Show the test card side by side at four sizes:
  - your current 100%, relabelled "drawn at 1x, not Retina";
  - "Normal" (looks like 1280×800);
  - looks like 1440×900;
  - "Same size as the Mac" (looks like 1536×960, drawn at 3072×1920).
- You pick. Your saved choice (`HKCU\Software\USB-C Display\Scale = 100`) stays unless you change it.
- Labels change in `UsbcWatcher.cs:228-231`.
- The Hello message carries the point size directly. Today `.m:870-874` derives it from a percentage, which can't express 1440×900 exactly.

**5b. Scaler.**
- **First find out which filter ScreenCaptureKit uses:**
  1. Put up the static test card.
  2. Mac: `screencapture -x -D <n>` grabs the 2560×1600 drawing.
  3. Windows: take a screenshot of the receiver.
  4. ffmpeg: `scale=1920:1200` with the bilinear, area, bicubic and Lanczos filters, each compared with the Windows screenshot by PSNR/SSIM.

  The same comparison checks that the capture equals what macOS rendered.
- **If it behaves like bilinear,** do the shrink ourselves:
  - capture at the full 2560×1600 (`cfg.width/height`, `.m:920-921`), with `captureResolution` Best;
  - shrink on the Mac's GPU with Metal, in both gamma space and linear light.

  You pick by comparing side by side with the MacBook on the test card, in light and dark mode. The hairline metric is a secondary check.
- Add hairlines at sub-pixel offsets to the test card (`testCardText`, `.m:766`).

**5c. Colour (on/off switch).**
- First check that MyASUS Splendid is set to Normal.
- The receiver sends its panel profile (`AsusICM\X1407QA_QCOM_AE0D1441.icm`, matched by the panel's EDID ID). The Mac assigns it to the virtual display with `ColorSyncDeviceSetCustomProfiles`, and stops forcing sRGB capture (`.m:923`).
- **For H.264 regions:** before encoding, remove or override the frame buffer's colour attachments (ICC profile, primaries, transfer function), so that VideoToolbox doesn't convert. H.264 tags can't describe this profile.
- **Undo:** turning the switch off clears the custom profile; uninstalling removes it.
- Optional: a 6500 K white point, which costs 11% of brightness.

**5d. Refresh rate: no change, measure only.**
- Matching the nominal 60.003 Hz is dropped. It doesn't lock the phase, because the two crystals differ by a similar amount.
- With synced clocks, measure over 10 min: the real rate ratio, the drift period, and how close arrivals come to the present deadline.
- Only if arrivals sit within ±1 ms of the deadline for long stretches (alternately making and missing it, i.e. judder): add a guard that nudges the virtual display's rate slightly to move the phase.

**5e. Pointer behaviour.**
- **Hiding while you type:** first test whether `CGCursorIsVisible` reports other apps' hide-while-typing on macOS 27 (type in TextEdit). Fallbacks: a private CGS visibility call, or the pointer drawn into the picture.
- Check animated pointers such as the beach ball.
- Turn off Windows' pointer shadow while the receiver runs, and restore it on exit.
- Side-by-side comparison with the pointer drawn into the picture (informed by 0A).

**Gain (predicted):**
- text strokes the same darkness wherever they fall (today modelled to vary ±11%);
- mean ΔE from a modelled 4.3 to 2.1, and macOS blue from 9.1 to 0.7. This uses a per-model profile, not a measurement of this unit;
- optionally the same physical size as on the Mac.

**Risks:**
- The Metal shrink adds about 0.5 ms of GPU time (to be measured).
- The colour profile may not survive the display being recreated, so it is re-applied every session.

**Acceptance:**
- You pick the size, the filter and the colour setting side by side, with True Tone and Night Shift off on the Mac.
- With colour on, Windows screenshot patches equal `colour.py`'s prediction ±1 level. This proves the conversion is applied, not that the colours match the Mac.
- H.264 and raw patches are identical.
- 1-pt hairlines vary by no more than ±3% across sub-pixel positions (`filters.py`).
- The GPU shrink takes ≤ 0.5 ms (Metal timestamps).
- Typing hides the pointer within one frame, if the visibility test works; otherwise, the side-by-side result decides.

### Stage 6: remove the wait for the next refresh (depends on P6(b) and the Stage 1 probes)

**Changes:**
- **If the panel does variable refresh:** present with tearing allowed, but only while the window is shown directly, and never sooner than 16.67 ms after the last update. While the pointer moves, re-present at 60 Hz, so the panel doesn't drop to its 40 Hz minimum.
- **Otherwise, scanline-aware present** (the approach of RTSS Scanline Sync):
  - read the current scan line (`D3DKMTGetScanLine`, or `SyncQPCTime` plus the refresh period);
  - if all of a frame's dirty rectangles lie below that line plus a safety margin, present immediately with tearing allowed. The tear can't be seen, because the panel hasn't drawn those rows yet;
  - otherwise, wait for the refresh.

  Only while the window is shown directly.
- In both cases, fall back to refresh sync when the window isn't shown directly.

**Gain:**
- Variable refresh: 8.3 ms less on average.
- Scanline: less for typing and clicks, depending on where on screen they happen.

**Acceptance,** measured over at least 6 min:
- a 240 fps phone video of the test card's moving box shows no tear lines;
- small-update capture→display p50 ≤ 7 ms with variable refresh, or at least 3 ms better than refresh sync with the scanline method.

### Stage 7: final check against the real MacBook

Film both screens with a phone at 240 fps:
- 3 sessions at least 10 min apart, so they catch different phases of the two clocks;
- at least 20 events per test: a millisecond counter on both displays, dragging a window, scrolling.

**Targets:**
- extra latency against the MacBook's own panel: ≤ 17 ms on average (one refresh) and ≤ 25 ms p95, or ≤ 8 ms with variable refresh;
- extra pointer latency ≤ 5 ms;
- a dragged window trails the pointer by no more than one frame beyond what it does on the Mac;
- at least 30 GB in one link session, plus 8 h of use, with zero wedges and zero checksum mismatches.

### Stage 8 (optional): lossless compression, only if it measures better

- **What:** QOI+LZ4 tiles, plus copy operations for scrolling and moving windows, running in parallel on both sides. In the codec study, desktop work stays exact at ≤ 12 MB/s and decodes in under 1 ms.
- **When it pays:** on a healthy link, only if full-screen changes get faster end to end (4.7 ms on the wire raw, against about 1–2 ms compressed plus encode and decode), or for battery life.
- **Ship rule:** only if full-screen capture→display p50 improves by at least 2 ms, with zero checksum mismatches.

### Branch F: if Stage 0 proves a fixed budget per link session

**Reached only if R-rot also wedged.** The order becomes 1 → F1 → 4 → F2 → 3 and 5.

- **F1: the codec from Stage 8,** at the full 2560×1600, with the shrink on the Windows GPU.
  - At that size, scrolls and drags become exact copies: scrolling costs 0.03–0.08 MB/s and dragging about 10–12 MB/s.
  - H.264/HEVC is used only for regions that look like video (changing at least 15 times a second, over 0.8 bytes per pixel), with text on top still sent exactly and the colour attachments stripped as in 5c.
- **F2: planned resets, only if you accept the measured cost.**
  - Each planned reset freezes the picture for the reset time R6 measured (about 47 s today, unless 4b shortens it). You see that number before choosing this branch.
  - When chosen: once a session passes 1.0 GB (below the 1.3 GB lower bound), wait until the screen has been still for at least 2 s, then reset through the task, with the last picture left on screen.
- **F3: pointer and control over Wi-Fi during a reset,** only behind a pairing secret.
- **F4: reports and system changes.** Each step needs your explicit consent, with roll-forward steps given.
  - **Bug reports** to Microsoft, ASUS and Qualcomm. Logs come from Feedback Hub's built-in "Recreate my problem" capture, or inbox `logman` with the TraceLogging GUIDs. BusesTrace isn't used: it is an extra download that runs elevated.
  - **Driver rollback:** `qcusb4bus8380` 1.0.4281.8500 is in the driver store, but its filter (`qcusb4filter8380`) exists only at 1.0.4458.2600, so a rollback runs an untested mix of versions.
    - It needs Device Manager's "Let me pick", because pnputil can't force a downgrade.
    - Windows Update may put the new driver back.
    - Roll forward the same way, picking 1.0.4458.2600.
  - **KB5127648:** retried only before Stage 0 (P6(c)), not mid-experiment.
- **Time to the next reset at 1.0 GB:** many hours of typing and scrolling; about 1.5 minutes of continuous dragging; full-screen video uses lossy regions.

---

## 4. What we cannot match, and why

- **Sharpness.**
  - The laptop panel has 162 pixels per inch, against the MacBook's 224.5. At the Mac's own UI size, the laptop has 72% of the Mac's pixels per inch in each direction, so no software makes 9-pt text as crisp.
  - Every 2x mode is resampled, as the MacBook's own default is (×0.871).
  - The only unresampled options are 1:1, which renders at 1x, and 960×600, which renders at 2x but makes everything huge.
- **Colour.**
  - The panel shows about 66% of sRGB and about 49% of the MacBook's P3 range, at about 333 nits against 500. It is 8-bit and matte, with no True Tone and no HDR.
  - After adjusting for the panel (predicted, per-model profile), saturated red, green and purple stay 3–6.5 ΔE off, and HDR content is converted to SDR.
- **Timing.** Two independent 60 Hz clocks, drifting through a full cycle about every 5.6 min.
  - Without variable refresh, each frame waits 0–16.7 ms (8.3 on average) for the laptop's next refresh, and the wait drifts with the phase. The scanline method shortens it only for updates below the current scan line.
  - On top of that come about 3 ms of ScreenCaptureKit delivery (estimate) and 1–6 ms of transfer and apply.
  - That is about one refresh behind on average, not zero.
  - Variable refresh, if the driver supports the panel's 40–60 Hz FreeSync range, would bring it to about 5–8 ms.
- **Pointer rate.** The trackpad reports at 125 Hz; the laptop can't be smoother than its source. The Mac's own pointer has the same limit.
- **Recovery.** If wedges remain, each one costs the measured reset time: about 47 s today for a router reset, with link bring-up alone taking 14.4 s.
- **Branch A's scope.** Turning TSO off per socket protects only our connection. Other large Mac→Windows transfers are covered only by the opt-in Mac-wide setting or by the warning.
- **Network extensions.** Only the combinations tested in Stage 0 and Stage 2 are supported. FB21256925 is Apple's to fix.
- **Video input.** The laptop's USB-C ports send DisplayPort out but can't take it in. The cable network is the only path that needs no extra hardware.
- **Branch F.** If Stage 0 lands there, unlimited lossless full-screen motion isn't possible over this USB4 network with this driver stack. Motion-heavy content gets lossy regions or planned resets until Microsoft or Qualcomm fix it.
- **Already identical, nothing to fix:** fonts, vibrancy, transparency and everything else macOS draws. We send its pixels.

**Files:**
- `C:\Users\place_\usbc-display\mac\usbc-display.m`
- `C:\Users\place_\usbc-display\windows\Program.cs`
- `C:\Users\place_\usbc-display\windows\Native.cs`
- `C:\Users\place_\usbc-display\windows\Link.cs`
- `C:\Users\place_\usbc-display\windows\H264Decoder.cs`
- `C:\Users\place_\usbc-display\windows\watcher\UsbcWatcher.cs`
- `C:\Users\place_\usbc-display\tools\UsbcSink\Program.cs` (new)
- `C:\Users\place_\AppData\Local\UsbcDisplay\receiver.log`

**Measurement tools:**
- `C:\Users\place_\AppData\Local\Temp\claude\C--Users-place-\28448213-c3ba-4450-99c1-657b73d87916\scratchpad\test-soak.ps1` (extended into the Stage 0 harness)
- `C:\Users\place_\AppData\Local\Temp\claude\C--Users-place-\28448213-c3ba-4450-99c1-657b73d87916\scratchpad\burst.ps1`
- `C:\Users\place_\AppData\Local\Temp\claude\C--Users-place-\28448213-c3ba-4450-99c1-657b73d87916\scratchpad\stale.ps1`
- `C:\Users\place_\AppData\Local\Temp\claude\C--Users-place-\28448213-c3ba-4450-99c1-657b73d87916\scratchpad\patches.ps1`
- `C:\Users\place_\AppData\Local\Temp\claude\C--Users-place-\28448213-c3ba-4450-99c1-657b73d87916\scratchpad\reset-link.ps1`
- `C:\Users\place_\AppData\Local\Temp\claude\C--Users-place-\28448213-c3ba-4450-99c1-657b73d87916\scratchpad\colour.py`
- `C:\Users\place_\AppData\Local\Temp\claude\C--Users-place-\28448213-c3ba-4450-99c1-657b73d87916\scratchpad\filters.py`
- New: `C:\Users\place_\AppData\Local\Temp\claude\C--Users-place-\28448213-c3ba-4450-99c1-657b73d87916\scratchpad\r6-win.ps1`, `C:\Users\place_\AppData\Local\Temp\claude\C--Users-place-\28448213-c3ba-4450-99c1-657b73d87916\scratchpad\r6-mac.sh`, `C:\Users\place_\AppData\Local\Temp\claude\C--Users-place-\28448213-c3ba-4450-99c1-657b73d87916\scratchpad\linklog-mac.sh`; Mac test sender at `/tmp/usbc-bench`

---

## Appendix: Addressed review points

No point was rejected outright. Three were partly accepted, and the reason is given in their rows (15, 44, 51). Duplicate points refer to the first row that covers them.

| # | Point | Resolution |
|---|---|---|
| 1 | Stage 1 acceptance needs >1.5 GB raw per session; bench disables the pointer | Accepted. Sustained Stage 1 runs use H.264 or a small box under 1 GB per session; raw full frames only as ≤ 2 s bursts on a fresh link. Pointer-under-553 MB/s moved to Stage 2. Bench keeps the pointer (drop `!gBench`, use `CGMainDisplayID`) |
| 2 | Apply and send→ack targets below wire time | Accepted. Metrics start at body complete; send→ack = bytes ÷ link rate + 1.5 ms; fixed targets only for updates under 0.5 MB |
| 3 | Dual-stack listener makes IP_OPTIONS fail silently | Accepted. `IPV6_V6ONLY = 1`; dedicated AF_INET listener on 48103 bound to bridge0; option set only on its sockets, return value checked; packet shape checked on the Mac side |
| 4 | Refresh-synced acknowledgements cap "full speed" at 553 MB/s | Accepted. Every Stage 0 run uses the sink, which acknowledges immediately; the mode is logged |
| 5 | 240 Hz pointer impossible (125 Hz trackpad); NSEvent runs on the main thread | Accepted. Target restated per HID report; 1 kHz poll on a dedicated queue; NSEvent dropped; CGEventTap only as an experiment |
| 6 | bridge0 counters don't count the cable | Accepted. 24.4 GB argument withdrawn; en2 output and `netstat -qq` only; packet counts from Windows |
| 7 | RSC distorts Windows packet counts | Accepted. RSC-corrected count logged; Mac en2 dequeued average is the primary check |
| 8 | R6 order: (d) masks (e); (c) = Restart-NetAdapter; receiver's own prompt | Accepted. Order (a)→(b)→(c)→(e), (d) dropped, (c) given 90 s; sink and `--no-recover` |
| 9 | Hard-coded instance ID | Accepted. `/deviceid` form in Stage 4 and R6(e) |
| 10 | No branch for R0 passing after setup changes | Accepted. R0 runs first; "doesn't wedge" branch restores conditions one at a time |
| 11 | 256 KB writes still burst at line rate | Accepted. Split into R3a (data in flight) and R3b (64 KB, one TSO packet per token) |
| 12 | One-call body read contradicts streaming | Accepted. Length-prefixed chunks plus end marker from Stage 1; staging canvas published at the end marker |
| 13 | Pointer connection has no priority under bulk load | Accepted. `NET_SERVICE_TYPE_VO`, `TCP_NOTSENT_LOWAT` on frames, MMCSS; target marked a hypothesis until measured |
| 14 | Heartbeats from a thread that can block for 1.2 s | Accepted. Heartbeats on the control connection; the 500 ms timeout uses only that, and it reconnects, never resets |
| 15 | Drop 5d | Partly. Rate matching dropped; only a measured, conditional phase guard kept, because point 52 shows deadline judder is possible |
| 16 | H.264 tags can't describe the ICC profile; ΔE is modelled | Accepted. Colour attachments stripped before VideoToolbox; H.264 vs raw patch check; ΔE labelled as predicted |
| 17 | Linear-light shrink may thin text | Accepted. Both implemented; you choose side by side |
| 18 | Dirty rectangles in source coordinates and spread by the filter | Accepted. Scale, pad ≥ 2 px, snap to tiles; full compare kept in release builds until zero misses |
| 19 | Checksum skips the GPU canvas | Accepted. Staging-texture CRC every 10 s; gamma identity check; target says what each check proves |
| 20 | CGCursorIsVisible unverified | Accepted. Tested first; fallbacks listed |
| 21 | Refresh frames explain the backlog; raw gain overstated; 55–56 fps weak | Accepted. §1.1 rewritten; backlog and capture intervals measured first, with a CVDisplayLink-driven test card |
| 22 | IP_BOUND_IF doesn't refuse SYNs; 2C task can't run RSC | Accepted. Post-accept scope check; acceptance is "never yields a Hello session"; separate fixed-action RSC task |
| 23 | Recovery-time claim contradicted by our own logs | Accepted. §1.2/1.3 corrected (14.4 s + 32 s); Stage 4 target set after R6; F2 conditional on the measured cost |
| 24 | Mac IPv4 address appears about 19 s after link-up | Accepted. Session starts on IPv6/H.264 and switches when `SCDynamicStore` publishes IPv4; optional fixed addresses |
| 25 | Receiver auto-restarts the router during Stage 0 | Accepted. Sink and `--no-recover`; decline unexpected prompts; R6 driven by two scripts |
| 26 | User cost understated | Accepted. Honest cost per path, task registered first, R6 batched into 1 sudo + 1 UAC, R1 without sudo, stop point, restore checklist |
| 27 | R1 tests a mechanism that won't ship | Accepted. R1 is the shipping per-socket path; sysctl only as a diagnostic; LaunchDaemon only with consent |
| 28 | "Window never disappears" traps the user | Accepted. Frozen picture only during a capped recovery; hides on unplug, goodbye, sleep, Esc and a global hotkey |
| 29 | Silent elevated resets on false positives | Accepted. Stricter rule (≥ 1 s frozen, ≥ 3 TCP/UDP probes, prior flow), at most 2 per 10 min then a notification, every reset logged |
| 30 | Agent open to Wi-Fi until Stage 2; Wi-Fi fallback | Accepted. Binding and scope check moved to Stage 1; fallback dropped except behind F3 pairing |
| 31 | User's observation never tested | Accepted. Stage 0A blind comparison with a 1 GB cap on raw arms |
| 32 | bridge0 counters (user lens) | Same as 6; UDP probes replace sudo tcpdump; question S3(a) dropped |
| 33 | Task path and instance ID | Accepted. Literal path, `/deviceid`, action read back and verified before use |
| 34 | Driver rollback, KB retry and BusesTrace presented as cheap | Accepted. Each gated by consent with roll-forward steps; KB only before Stage 0; Feedback Hub capture or inbox logman |
| 35 | Harness takes over the laptop; watcher popup; product binary rebuilt | Accepted. Headless sink, watcher quit from the tray, test sender built to `/tmp` |
| 36 | Default change overrides the saved choice | Accepted. Side-by-side choice; saved value kept |
| 37 | Scanline-aware present needs no VRR | Accepted. Stage 6 fallback |
| 38 | Colour needs a switch, an undo and a Splendid check | Accepted |
| 39 | Never validated with the user's VPN | Accepted. One 10 GB run plus 2 h of the 8 h with usual extensions on |
| 40 | Stage 0 receiver differs from the one that wedged (blocker) | Accepted. Sink acknowledges like the old tearing receiver; exact old receiver used if R0 doesn't wedge |
| 41 | Recovery timeline contradicts the premises (blocker) | Accepted. Instrumented timeline; 90 s per R6 step; Restart-NetAdapter retested through (c) |
| 42 | Resets aren't local to one host | Accepted. Fault located from `netstat -qq` and ioreg snapshots; Apple report only if they point there |
| 43 | `netstat -s` reads zero; 1 Hz too coarse; pre-wedge stall unused | Accepted. `TCP_CONNECTION_INFO`, 10 Hz timestamped logs, stalls over 50 ms fail a run |
| 44 | Runs carry over state; the fit mixes baselines | Accepted. Fresh link before every run, absolute counters, fit withdrawn. Partly on "budget 6–8 replugs": task resets replace replugs |
| 45 | R0 band too narrow; missing branches; Windows ACK path | Accepted. 1.3–3.9 GB band, new branches, SentUnicastPackets logged |
| 46 | Per-connection vs per-link budget untested | Accepted. R-rot must wedge before Branch F; 2D rotation |
| 47 | R3 changes three things at once | Same as 11; 2B design chosen by whichever of R3a/R3b passes |
| 48 | Power over the cable not recorded | Accepted. Logged every run, fixed for R0 and R1, restored in the "doesn't wedge" branch |
| 49 | R1 vs 2A mechanism (rigor) | Same as 27, plus the R0-v4 IPv4 control |
| 50 | IPv4 delay (rigor) | Same as 24 |
| 51 | SMB copies still use TSO in Branch A | Accepted: 10 GB Finder copy added to acceptance. Partly on "prefer the Mac-wide LaunchDaemon": offered as your choice, not the default, because it changes all Mac traffic and needs an admin install |
| 52 | 60 s tests measure clock phase, not code | Accepted. Phase-independent code metric; ≥ 6 min or 3 sessions; results reported against phase |
| 53 | Targets contradict wire time; TSO-off floor too low | Accepted. Metric definitions, formula targets, 1.5 GB/s floor reached with R-mtu or more flows |
| 54 | Clock sync channel unspecified | Accepted. Sync on the control connection, minimum-round-trip bursts, drift fit, error bound ≤ 0.3 ms |
| 55 | CPU measured in the wrong place | Accepted. DPC and interrupt time per core; kernel_task on the Mac |
| 56 | bridge0 counters (rigor) | Same as 6; R4 calibrates once |
| 57 | Checksum scope (rigor) | Same as 19 |
| 58 | 8 h says nothing without bytes | Accepted. At least 30 GB per link session as well |
| 59 | 2C reapply has no mechanism | Same as 22 |