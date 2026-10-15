# Tests

PowerShell scripts run on the Windows laptop with the cable connected; they check results on the
Mac over SSH (`ssh_config`, from `ssh_config.example`). They take over the laptop's screen, and
the input tests drive its pointer and keyboard, so leave the laptop alone while they run. Results
and logs go to `results/` (not committed). Build first: `windows/app` (published receiver),
`windows/bin/Release/...` (built receiver) and `tools/UsbcSink/app` as the scripts expect; on the
Mac, `/tmp/curpos` from `tools/linkbench/curpos.c` and `/tmp/usbc-bench` from `usbc-bench.c`.

| Script | What it shows |
|---|---|
| `soak.ps1` | link soak with `UsbcSink` + `usbc-bench` (default: 100 GB, unbundled IPv4); any options after `-Extra` |
| `recovery-test.ps1` | the receiver restarts a frozen link by itself (freezes it on purpose with bundled traffic) |
| `watcher-wedge-test.ps1` | the watcher does the same when the screen isn't running |
| `exact-test.ps1` | the laptop's screen equals, pixel for pixel, what the Mac sent (test card) |
| `color-test.ps1` | colour patches with and without the panel's colour profile (`-Tag off -Extra --no-color-profile`) |
| `input-test.ps1` | keyboard: typed text, accents, AltGr, shortcuts, scrolling, read back from the Mac's test card |
| `pointer-test.ps1` | clicks, taps, double clicks, drag, crossing to the Mac's own screen and back |

`linklib.ps1` holds the shared helpers (link reset with timeline, sink runs, UDP probes) and the
two machines' cable addresses, which you'll need to change for other machines.
