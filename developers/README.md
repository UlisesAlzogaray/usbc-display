# For developers

Everything technical about USB-C Display lives here, so the front page can stay simple.

| Document | What's in it |
|---|---|
| [HISTORY.md](HISTORY.md) | How the program evolved, from the first tests to the guided setup, and what each step taught us |
| [HOW-IT-WORKS.md](HOW-IT-WORKS.md) | The technical reference: picture pipeline, the cable link and why it used to freeze, frame timing, measurements, command-line options, protocol, building |
| [PLAN.md](PLAN.md) | The investigation and staged plan of 2026-10-15 that the current engine came from, with its diagnosis and every link experiment |
| [windows/setup/README.md](../windows/setup/README.md) | The setup app: the flow screen by screen, the window and hand-off, permissions, building the installers |
| [windows/setup/CONTRACT.md](../windows/setup/CONTRACT.md) | The contracts between the setup app, its screens and the Mac app (status probe, wizard state, commands, served files) |
| [windows/setup/TESTING.md](../windows/setup/TESTING.md) | A full end-to-end test run on real computers, step by step, with what to check at each screen |
| [tools/tests/README.md](../tools/tests/README.md) | The automated hardware tests: link soak, recovery, pixel-exactness, colour, keyboard and pointer |

## The pieces

```
  Mac                                         Windows laptop
  ─────────────────────────────               ─────────────────────────────────────
  USB-C Display.app  (mac/)                   USB-C Display Setup.exe  (windows/setup/)
   · adds a virtual display                    · guided first run, installs everything
   · captures it, sends changed pixels         · serves the Mac app at usbc.local
   · posts the laptop's keyboard and           UsbcDisplay.exe  (windows/)
     pointer input                              · shows the frames, sends input
   · login agent, answers setup's questions    UsbcWatcher.exe  (windows/watcher/)
                                                · tray app, starts the screen on plug-in
              ◄──────── one Thunderbolt / USB4 cable: a private network link ────────►
```

- **Mac side:** one Objective-C file, `mac/usbc-display.m`, built into an app by `mac/build.sh`.
- **Windows side:** C# on .NET 8 (receiver, setup) and .NET Framework 4.8 (watcher, so it needs no runtime).
- **Setup screens:** plain HTML, CSS and SVG in `windows/setup/ui/`, shown in WebView2. `windows/setup/preview/shoot.sh` renders every screen and scenario in a headless browser for review.

## Building, in short

```sh
mac/setup-signing.sh            # once: a local signing certificate, so permissions survive rebuilds
mac/build.sh                    # the Mac app and the zip the setup serves to the Mac
tools/build-windows.sh          # the Windows setup for Snapdragon (ARM64), with everything inside
tools/build-windows.sh x64      # the same for Intel and AMD
```

Details, options and environment variables are in [HOW-IT-WORKS.md](HOW-IT-WORKS.md#building) and the [setup README](../windows/setup/README.md#building).

## Principles

The product's bar is design and ease of use, so changes are judged by how they feel to someone who has never heard of USB4:

- **One obvious next step.** Each screen asks for one thing, shows where to do it, and notices when it's done.
- **Never surprise.** No flash back to an earlier screen, no half-drawn window, no prompt that hasn't been explained first.
- **Exact by default.** The picture is the Mac's own pixels. Anything lossy is a fallback, never the plan.
- **Measure, then claim.** Every number on the front page comes from a measurement in [HOW-IT-WORKS.md](HOW-IT-WORKS.md) or [PLAN.md](PLAN.md).

## Open work

- **Signing and notarization.** The Mac app needs a Developer ID and notarization (`DEVELOPER_ID` and `NOTARY_PROFILE` in `mac/build.sh`); the Windows setup needs a code-signing certificate to avoid SmartScreen and Smart App Control warnings.
- **Link recovery beyond Qualcomm.** The silent restart of a stuck link targets Qualcomm's USB4 router; Intel and AMD USB4 and Thunderbolt controllers need their own device IDs and testing.
- **Other bulk traffic.** Finder file sharing over the same cable still sends large bundled packets that can freeze the link (see HOW-IT-WORKS.md).
- **Roadmap:** Mac as a screen for Windows, wider PC support, and Android tablets with touch. See the front page.
