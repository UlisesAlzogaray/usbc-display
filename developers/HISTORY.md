# How USB-C Display evolved

USB-C Display started as a question: the laptop's USB-C ports can't take a video signal in, so can the cable's network link carry a Mac's screen well enough to feel like a real monitor? This is the story of how the answer became yes, and then became something anyone can set up.

## 1. The first tests: it works, almost

The first version had two small programs. The Mac added a virtual display and sent its picture over the Thunderbolt Bridge network that appears when two computers share a USB4 cable. The laptop drew it full screen.

It worked, and early runs that sent raw tiles and flipped frames the moment they arrived felt surprisingly good. But two problems showed up:

- **The link froze.** After somewhere between 0.1 and 3 GB, the laptop simply stopped receiving until the cable connection was restarted. It looked like a fixed data "budget".
- **It got worse as it got "better".** Switching to H.264 video for motion and syncing to the screen's refresh made the picture softer and added a full refresh of delay, because one frame always waited in the socket behind the refresh.

## 2. The investigation (2026-10-15)

Rather than tune blindly, the work stopped for a diagnosis, written up in [PLAN.md](PLAN.md). The key moves:

- **Question the "budget".** A series of link experiments showed the freeze wasn't about how much data had passed. Packets sent without TCP segmentation offload ran 20 GB and then a 100 GB soak with no freeze; the same socket with offload froze after 0.2 GB on a link that had just carried 45 GB.
- **Find the real cause.** macOS bundles a burst into one 40 to 64 KB "super-packet" (TSO). Those span several of the link's 4 KB frames, and the Windows USB4 network driver on Qualcomm's USB4 stack stops receiving for good when it gets one.
- **Fix it without admin rights.** Every send goes out in pieces of at most two TCP segments, the next only once the previous one has left (`TCP_NOTSENT_LOWAT`). No packet spans two link frames. Result: **100 GB at 952 MB/s with no freeze**, more than the 553 MB/s that full-screen changes at 60 fps need.

## 3. The engine, rebuilt the same day

With a link that could carry exact pixels, the rest followed in stages (all in [HOW-IT-WORKS.md](HOW-IT-WORKS.md)):

- **Exact pixels by default.** Changed areas go as 64×32 tiles, LZ4-compressed on all cores. Verified end to end: 0 of 6.9 million values differ. H.264 is only a fallback that hasn't triggered on this link.
- **Scan-line timing instead of waiting for the refresh.** The receiver flips as soon as the line the panel is drawing is clear of the change, so there's no seam and no extra wait. Median Mac-to-panel time went from 25 ms to 11 ms.
- **A pointer with its own channel**, 0.2 ms median, and the laptop's keyboard and trackpad posted to the Mac, typed characters exactly as the laptop's layout produces them.
- **Looking like the MacBook.** A "same size as on the MacBook" mode, a Lanczos fit sharper than the system's bilinear one, and the laptop panel's own colour profile applied on the Mac.
- **Silent recovery.** If the link ever freezes anyway, a scheduled task restarts it with no prompt, and the last picture stays up meanwhile.

That became the first public commit: a working, fast, exact second screen, set up by hand with scripts.

## 4. Making it something anyone can set up (2026-10-15 to 10-16)

A great engine set up with scripts is still a developer tool. The next goal was a setup a non-technical person could finish without help, held to the standard of Apple's own setup assistants. Nine test releases followed, each one run end to end on real hardware:

- **A guided installer on Windows** (Setup test 1). One download. It installs everything, asks Windows once, and serves the Mac app to the Mac over the cable at `usbc.local`, so the Mac never downloads anything from the internet. It talks to the Mac app to know which permissions are granted and moves on by itself.
- **Finding USB4 on Snapdragon laptops** (test 2), whose USB4 router appears differently from Intel's.
- **A Mac app that survives updates** (tests 3 and 4). It moves itself to Applications, and runs from its own login agent instead of `SMAppService`, whose registration broke for good when the app was replaced. Testing also showed macOS remembers each build it has approved, so every test needed a new build version to see the first-run prompts again.
- **No reloads, no going back** (test 5). The hand-over from the downloaded setup to the installed copy keeps the exact frame on screen, and when the display starts, the setup window moves to the Mac with the picture. The Mac screens it shows are drawn the way they really look.
- **One window, two computers** (tests 6 and 7). The setup is drawn as a Mac window even on Windows, so at the hand-over only the background changes. It became one quiet assistant window that follows what you do on the Mac by itself.
- **The hard part made calm** (tests 8 and 9). Opening an app macOS hasn't seen before takes many clicks (Done, Open Privacy & Security, Allow, Open Anyway twice, Touch ID). The setup now moves on after macOS's "Not Opened" alert without waiting, and the whole sequence became one screen with one slow animation and three numbered steps that check themselves off.

Setup test 9 is the version tested in full and released as the current download.

## 5. What we learned

- **Measure before you believe a limit.** The "2 to 3 GB budget" was a symptom, not a cause.
- **Lossless can be cheaper than lossy.** Once the link was fixed, exact pixels were both sharper and lower in delay than video.
- **Setup is the product.** Most of the time after the engine worked went into the first five minutes, because that's where people give up.
- **Test on clean machines.** macOS remembers approvals, background items and accessories in places an app can't clear, so a real first-run test needs a fresh build.

## What's still open

See [README.md](README.md#open-work) in this folder for the technical list, and the front page for the roadmap.
