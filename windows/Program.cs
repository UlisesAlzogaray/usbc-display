// USB-C Display, Windows side: shows the Mac's extra monitor full screen on this PC.
//
// Connects to mac/usbc-display over the network the USB-C cable creates (protocol in Link.cs):
// a control connection for the pointer, heartbeats and clock sync, and a frame connection for
// pictures. Each complete frame goes straight into a Direct3D texture and is acknowledged at
// once; a separate thread shows the newest picture at each screen refresh (--tearing: at once).
//
// usage: UsbcDisplay [--looks-like WxH | --scale N] [--tearing] [--window WxH] [--seconds N] ...
//
// Lines the setup and the watcher read from its output (windows/setup/CONTRACT.md):
//   "Window: <hwnd>"             the picture's window exists (decimal handle; hidden until the picture)
//   "Connected to <address>."    the Mac answered on the cable
//   "Picture on screen."         the window is up, in front, showing the Mac's display
//   "Pointer on screen"          the Mac's pointer was first seen on this display, over the picture
//   "Input: allowed" / "Input: not allowed"   whether the Mac may post this PC's keyboard and trackpad
//   "Refused: screen recording"  the Mac can't record its screen; the receiver exits with code 3

using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace UsbcDisplay;

static unsafe class Program
{
    static IntPtr hwnd;
    // The Mac's pointer, shown as Windows' own cursor: drawn by the OS on its own layer, so
    // it moves at full speed without waiting for frames. Set on the control thread, applied
    // on the window thread (WM_APP_CURSOR).
    static IntPtr macCursor;
    static volatile bool macCursorVisible;
    static bool noCursor;
    static int winX, winY;
    static volatile bool quitting;
    const int ExitRefused = 3;  // the Mac turned the session down: Screen Recording is off
    static int exitCode;
    static string host;
    static int port = 48100, testW, testH, seconds, scaleOverride, ptW, ptH;
    static bool vsync = true, scanSync = true, exitWhenUnplugged, testCard, testDrag, videoOnly, h264, losslessOnly, verbose, colorProfile = true, useInput = true;
    static readonly object ctlSendLock = new();  // the control connection is written from two threads
    static byte[] profileBytes;
    static string dumpPath;  // --dump: save received H.264 (Annex B + a .len file of frame sizes)
    static ScreenInfo screen;
    static readonly object rendererLock = new();
    static Renderer renderer;
    static Thread presentThread;
    static volatile bool windowShown;
    // The setup's handover: the Mac opens the setup window, in the same spot, on its new screen;
    // the picture shows only once a frame with it has been applied ("UCDV" names that frame), so on
    // this laptop only what's behind the window changes. 6 s at most, whatever happens.
    static bool afterMacWindow;
    static volatile uint macWindowSeq, lastAppliedSeq;
    static long firstFrameAt;
    static bool MayShow(uint applied) =>
        !afterMacWindow || (macWindowSeq != 0 && applied >= macWindowSeq) ||
        (firstFrameAt != 0 && Stopwatch.GetTimestamp() - firstFrameAt > 6 * Stopwatch.Frequency);

    static int Main(string[] args)
    {
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--host" && i + 1 < args.Length) host = args[++i];
            else if (a == "--port" && i + 1 < args.Length) port = int.Parse(args[++i]);
            else if (a == "--vsync") scanSync = false;  // classic: every frame waits for the next refresh
            else if (a == "--tearing") { vsync = false; scanSync = false; }
            else if (a == "--raw" || a == "--lossless-only") losslessOnly = true;
            else if (a == "--h264") h264 = true;
            else if (a == "--exit-when-unplugged") exitWhenUnplugged = true;
            else if (a == "--after-mac-window") afterMacWindow = true;  // the setup's handover (see ShowPicture)
            else if (a == "--test-card") testCard = true;
            else if (a == "--test-drag") testCard = testDrag = true;  // the card as a window dragged around
            else if (a == "--video-only") videoOnly = true;  // testing: H.264 only, no lossless refresh
            else if (a == "--no-cursor") noCursor = true;    // pointer in the picture instead
            else if (a == "--verbose") verbose = true;
            else if (a == "--no-color-profile") colorProfile = false;
            else if (a == "--no-input") useInput = false;
            else if (a == "--scale" && i + 1 < args.Length) scaleOverride = int.Parse(args[++i]);
            else if (a == "--looks-like" && i + 1 < args.Length)
            {
                var p = args[++i].Split('x');
                ptW = int.Parse(p[0]);
                ptH = int.Parse(p[1]);
            }
            else if (a == "--dump" && i + 1 < args.Length) dumpPath = args[++i];
            else if (a == "--decode-test" && i + 1 < args.Length) return DecodeTest(args[++i]);
            else if (a == "--seconds" && i + 1 < args.Length) seconds = int.Parse(args[++i]);
            else if (a == "--window" && i + 1 < args.Length)
            {
                var p = args[++i].Split('x');
                testW = int.Parse(p[0]);
                testH = int.Parse(p[1]);
            }
            else
            {
                Console.WriteLine("usage: UsbcDisplay [--looks-like WxH | --scale N] [--tearing] [--window WxH] [--seconds N] [--host ADDRESS]");
                Console.WriteLine("  --looks-like WxH  size of the Mac's display in points, e.g. 1536x960 (same size as on the MacBook),");
                Console.WriteLine("                    1280x800, or this screen's own size for 1:1 pixels (drawn at 1x, not Retina)");
                Console.WriteLine("  --scale N    the same as a percentage, like Windows' scaling: 100 = 1:1, 150, 200 = exactly 2x");
                Console.WriteLine("  --tearing    show frames the moment they arrive instead of at the screen refresh:");
                Console.WriteLine("               about 8 ms less latency on average, but tear lines during motion");
                Console.WriteLine("  --h264       H.264 for anything that moves (as before) instead of exact pixels");
                Console.WriteLine("  --lossless-only  never fall back to H.264, even if the link can't keep up");
                Console.WriteLine("  --exit-when-unplugged  quit once the cable has been out for 10 s (used by UsbcWatcher)");
                Console.WriteLine("  --test-card  ask the Mac to put sample text on the display, to judge sharpness");
                Console.WriteLine("  --verbose    print statistics every second");
                Console.WriteLine("  --window     small test window instead of full screen");
                Console.WriteLine("Esc, or Ctrl+Alt+Esc from anywhere, closes it.");
                return 0;
            }
        }

        Win32.SetProcessDpiAwarenessContext(-4);  // per-monitor v2: work in real pixels
        Win32.timeBeginPeriod(1);
        screen = ScreenInfo.Primary();
        if (testW > 0) screen = screen with { Width = testW, Height = testH };
        if (scaleOverride > 0) screen = screen with { ScalePercent = scaleOverride };
        if (ptW == 0)
        {
            int s = Math.Max(100, screen.ScalePercent);
            ptW = screen.Width * 100 / s;
            ptH = screen.Height * 100 / s;
        }
        Console.WriteLine($"USB-C Display (Windows side): {screen.Width}x{screen.Height}, {screen.Hz} Hz; the Mac's display will look like {ptW}x{ptH}");
        Console.WriteLine("Press Esc on this PC (or Ctrl+Alt+Esc from anywhere) to stop.");

        hwnd = CreateWindow();
        Console.WriteLine($"Window: {(long)hwnd}");  // the setup brings it forward at the handover
        if (colorProfile)
        {
            string icc = PanelProfile.Find(Win32.MonitorDeviceName(hwnd));
            if (icc != null)
            {
                profileBytes = System.IO.File.ReadAllBytes(icc);
                Console.WriteLine($"Colours matched to this screen with {System.IO.Path.GetFileName(icc)} (--no-color-profile to turn off).");
            }
        }
        Win32.RegisterHotKey(hwnd, 1, Win32.MOD_CONTROL | Win32.MOD_ALT | Win32.MOD_NOREPEAT, 0x1B);
        if (useInput)
        {
            Input.Window = hwnd;
            Input.WinX = winX;
            Input.WinY = winY;
            Input.Width = screen.Width;
            Input.Height = screen.Height;
            Input.Install();
            Console.WriteLine("This PC's keyboard and trackpad work on the Mac's display (--no-input to turn off): " +
                              "Alt is Command, the Windows key is Option.");
        }
        var worker = new Thread(Worker) { IsBackground = true, Priority = ThreadPriority.Highest, Name = "control" };
        worker.Start();
        if (seconds > 0)
            new Thread(() => { Thread.Sleep(seconds * 1000); Win32.PostMessageW(hwnd, Win32.WM_CLOSE, 0, 0); }) { IsBackground = true }.Start();
        Win32.MessageLoop();
        quitting = true;
        Input.Enabled = false;
        Input.Uninstall();
        Win32.RestorePointerShadow();
        DropRenderer();
        Console.WriteLine();
        return exitCode;
    }

    // Feeds a --dump file through the decoder with logging and saves the last picture as BMP.
    static int DecodeTest(string path)
    {
        byte[] data = System.IO.File.ReadAllBytes(path), lens = System.IO.File.ReadAllBytes(path + ".len");
        int w = BitConverter.ToInt32(lens, 0), h = BitConverter.ToInt32(lens, 4), frames = (lens.Length - 8) / 4;
        Console.WriteLine($"{frames} frames of {w}x{h}");
        H264Decoder.Verbose = true;
        using var dec = new H264Decoder(w, h);
        var bgra = new byte[w * h * 4];
        int offset = 0, got = 0;
        fixed (byte* d = data, o = bgra)
        {
            for (int i = 0; i < frames; i++)
            {
                int len = BitConverter.ToInt32(lens, 8 + i * 4);
                long t0 = Stopwatch.GetTimestamp();
                try
                {
                    bool ok = dec.Decode(d + offset, len, o);
                    if (ok) got++;
                    Console.WriteLine($"frame {i}: {len} bytes -> {(ok ? "picture" : "nothing")} in {(Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency:0.00} ms");
                }
                catch (Exception e) { Console.WriteLine($"frame {i}: {e.Message}"); }
                offset += len;
                if (i == 3) H264Decoder.Verbose = false;
            }
        }
        Console.WriteLine($"{got}/{frames} frames decoded");
        using var f = System.IO.File.Create(path + ".bmp");
        var hdr = new byte[54];
        hdr[0] = (byte)'B'; hdr[1] = (byte)'M';
        BinaryPrimitives.WriteInt32LittleEndian(hdr.AsSpan(2), 54 + bgra.Length);
        BinaryPrimitives.WriteInt32LittleEndian(hdr.AsSpan(10), 54);
        BinaryPrimitives.WriteInt32LittleEndian(hdr.AsSpan(14), 40);
        BinaryPrimitives.WriteInt32LittleEndian(hdr.AsSpan(18), w);
        BinaryPrimitives.WriteInt32LittleEndian(hdr.AsSpan(22), -h);  // top-down
        BinaryPrimitives.WriteInt16LittleEndian(hdr.AsSpan(26), 1);
        BinaryPrimitives.WriteInt16LittleEndian(hdr.AsSpan(28), 32);
        f.Write(hdr);
        f.Write(bgra);
        return got > 0 ? 0 : 1;
    }

    static IntPtr CreateWindow()
    {
        var inst = Win32.GetModuleHandleW(null);
        fixed (char* cls = "UsbcDisplayWindow", title = "USB-C Display")
        {
            var wc = new Win32.WNDCLASSEXW
            {
                cbSize = (uint)sizeof(Win32.WNDCLASSEXW),
                lpfnWndProc = (IntPtr)(delegate* unmanaged<IntPtr, uint, IntPtr, IntPtr, IntPtr>)&WndProc,
                hInstance = inst,
                hbrBackground = Win32.GetStockObject(4),  // black
                lpszClassName = (IntPtr)cls,
            };
            Win32.RegisterClassExW(&wc);
            bool test = testW > 0;
            winX = winY = test ? 100 : 0;
            return Win32.CreateWindowExW(Win32.WS_EX_TOPMOST, cls, title, Win32.WS_POPUP,
                winX, winY, screen.Width, screen.Height, 0, 0, inst, 0);
        }
    }

    [UnmanagedCallersOnly]
    static IntPtr WndProc(IntPtr h, uint msg, IntPtr wp, IntPtr lp)
    {
        switch (msg)
        {
            case Win32.WM_SETCURSOR:
                Win32.SetCursor(macCursorVisible ? macCursor : 0);  // hidden when the Mac's pointer is elsewhere
                return 1;
            case Win32.WM_APP_CURSOR:
                Win32.SetCursor(macCursorVisible ? macCursor : 0);
                if (wp != 0) Win32.DestroyCursor(wp);  // the shape it replaced
                return 0;
            case Win32.WM_APP_SHOW:
                if (wp != 0)
                {
                    Win32.ShowWindow(h, Win32.SW_SHOW);
                    if (!Win32.TakeForeground(h))
                        Console.WriteLine("Not in front yet: one click on this display gives it the keyboard.");
                    windowVisible = true;
                    // Only once the window is really up, so the setup (Receiver.cs), which waits
                    // for this line, can give it the foreground at once.
                    Console.WriteLine("Picture on screen.");
                    AnnouncePointer();
                }
                else
                {
                    windowVisible = false;
                    Win32.ShowWindow(h, Win32.SW_HIDE);
                }
                return 0;
            case Win32.WM_HOTKEY:
            case Win32.WM_KEYDOWN when wp == 0x1B && !Input.Enabled:  // with input on, Esc is the Mac's
            case Win32.WM_CLOSE:
                Win32.DestroyWindow(h);
                return 0;
            case Win32.WM_CHAR:
                if (Input.Enabled) Input.OnChar((char)(ushort)wp);
                return 0;
            case Win32.WM_APP_POINTER:
                if (wp != 0) Input.EnterRelative(alreadyOff: true);
                else Input.ExitRelative((short)((long)lp & 0xFFFF), (short)(((long)lp >> 16) & 0xFFFF));
                return 0;
            case Win32.WM_ACTIVATE:
                if (((ulong)wp & 0xFFFF) == 0) Input.ReleaseAll();  // nothing stays held on the Mac
                break;
            case Win32.WM_DESTROY:
                Win32.PostQuitMessage(0);
                return 0;
        }
        return Win32.DefWindowProcW(h, msg, wp, lp);
    }

    static void ShowPicture(bool show)
    {
        if (windowShown == show) return;
        windowShown = show;
        Input.PictureShown = show;
        if (!show) Input.Relative = false;
        // The Mac's pointer images have their own shadow; Windows would add a second one.
        if (show) Win32.HidePointerShadow(); else Win32.RestorePointerShadow();
        Win32.PostMessageW(hwnd, Win32.WM_APP_SHOW, show ? 1 : 0, 0);  // which prints "Picture on screen."
    }

    // "Pointer on screen": the first time the Mac's pointer is visible on this display while the
    // picture is up (the setup's last screen then says to click Done). Once per run.
    static volatile bool windowVisible;
    static int pointerAnnounced;

    static void AnnouncePointer()
    {
        if (macCursorVisible && windowVisible && Interlocked.Exchange(ref pointerAnnounced, 1) == 0)
            Console.WriteLine("Pointer on screen");
    }

    // The renderer (and its present thread) outlives a connection, so a reconnect keeps the
    // last picture up; it goes when the window hides or the picture size changes.
    static Renderer GetRenderer(int w, int h)
    {
        lock (rendererLock)
        {
            if (renderer != null && renderer.Width == w && renderer.Height == h) return renderer;
            DropRendererLocked();
            var r = new Renderer(hwnd, w, h, vsync, scanSync || !vsync) { RefreshMs = 1000.0 / Math.Max(1, screen.Hz) };
            if (scanSync && !r.EnableScanlineSync(Win32.MonitorDeviceName(hwnd)))
                Console.WriteLine("Can't follow the panel's scan line here; frames wait for the next refresh instead.");
            renderer = r;
            presentThread = new Thread(() =>
            {
                try { r.PresentLoop(() => quitting || renderer != r); }
                catch (Exception e) { Console.WriteLine($"Present: {e.Message}"); }
            }) { IsBackground = true, Priority = ThreadPriority.Highest, Name = "present" };
            presentThread.Start();
            Console.WriteLine($"Showing {w}x{h}, " + (r.ScanlineSync ? "each frame flipped as soon as it can be shown without a seam."
                : !vsync && r.Tearing ? "tearing allowed (lowest latency)." : "synced to the screen refresh."));
            return r;
        }
    }

    static void DropRenderer() { lock (rendererLock) DropRendererLocked(); }

    static void DropRendererLocked()
    {
        var r = renderer;
        renderer = null;
        if (r == null) return;
        presentThread?.Join(500);
        r.Dispose();
    }

    // ---- Clock sync: the Mac's clock in this machine's QPC terms ----
    static long clockOffsetNs;      // Mac ns - our ns
    static long clockErrorNs = long.MaxValue;
    static long clockSampleAt;
    static readonly double nsPerTick = 1e9 / Stopwatch.Frequency;
    static long NowNs() => (long)(Stopwatch.GetTimestamp() * nsPerTick);
    static long MacNsToQpc(ulong macNs) => clockErrorNs == long.MaxValue ? 0 : (long)(((long)macNs - clockOffsetNs) / nsPerTick);

    static void OnTimeReply(long sentNs, ulong macNs)
    {
        long now = NowNs(), rtt = now - sentNs;
        if (rtt < 0 || rtt > 50_000_000) return;
        // Keep the sample with the shortest round trip; let it age out after 10 s so drift
        // between the two clocks is followed.
        bool stale = now - clockSampleAt > 10_000_000_000;
        if (rtt / 2 <= clockErrorNs || stale)
        {
            clockOffsetNs = (long)macNs - (sentNs + rtt / 2);
            clockErrorNs = rtt / 2;
            clockSampleAt = now;
        }
    }

    // ---- Statistics ----
    static readonly LatencyStats applyStats = new(), pointerStats = new(), sendStats = new();
    static long statFrames, statBytes, statH264;

    static void Worker()
    {
        Win32.SetThreadExecutionState(0x80000000 | 0x2 | 0x1);  // keep the screen on while running
        bool announced = false;
        long unpluggedSince = 0;
        while (!quitting)
        {
            Socket ctl = null, frm = null;
            IPAddress mac = null;
            bool bye = false;
            var session = new CancellationTokenSource();
            Thread frames = null;
            try
            {
                if (!announced)
                {
                    var cable = Discovery.CableInterfaces();
                    Console.WriteLine(host != null ? $"Connecting to {host}..."
                        : cable.Count > 0 ? $"Looking for the Mac on {string.Join(", ", cable)}..."
                        : "No USB-C network link found. Plug in the cable, or use --host <Mac address>.");
                    announced = true;
                }
                ctl = Discovery.Connect(host, port);
                if (ctl == null)
                {
                    if (Discovery.CableInterfaces().Count == 0) ShowPicture(false);
                    if (exitWhenUnplugged)
                    {
                        // Started by the watcher: stop once the cable has been out for 10 s.
                        if (Discovery.CableInterfaces().Count > 0) unpluggedSince = 0;
                        else if (unpluggedSince == 0) unpluggedSince = Stopwatch.GetTimestamp();
                        else if (Stopwatch.GetTimestamp() - unpluggedSince > 10 * Stopwatch.Frequency)
                        {
                            Console.WriteLine("The cable is unplugged; stopping.");
                            Win32.PostMessageW(hwnd, Win32.WM_CLOSE, 0, 0);
                            return;
                        }
                    }
                    Thread.Sleep(500);
                    continue;
                }
                unpluggedSince = 0;
                var ep = (IPEndPoint)ctl.RemoteEndPoint;
                mac = ep.Address;
                Console.WriteLine($"Connected to {ep}.");
                ctl.ReceiveTimeout = 3000;
                ushort flags = (ushort)(Proto.HelloV2 | Proto.HelloCanH264 | (testCard ? Proto.HelloTestCard : 0) |
                                        (videoOnly ? Proto.HelloVideoOnly : 0) | (noCursor ? 0 : Proto.HelloCursor) |
                                        (h264 ? Proto.HelloH264Hybrid : 0) | (losslessOnly ? Proto.HelloLosslessOnly : 0) |
                                        (testDrag ? Proto.HelloTestDrag : 0) | (profileBytes != null ? Proto.HelloProfile : 0) |
                                        (useInput ? Proto.HelloInput : 0) |
                                        Proto.HelloStatus);  // a refusal comes back as Info, not a silent close
                ctl.Send(Proto.MakeHello(screen, flags, ptW, ptH));
                if (profileBytes != null)
                {
                    ctl.Send(Proto.WinMsg(Proto.Profile, (uint)profileBytes.Length));
                    ctl.Send(profileBytes);
                }
                var welcome = new byte[Proto.MacMsgSize];
                Proto.ReadExactly(ctl, welcome);
                uint first = BinaryPrimitives.ReadUInt32LittleEndian(welcome);
                if (first == Proto.Info)
                {
                    // Info {magic, status, version, macOS, refuse reason, accent} instead of Welcome.
                    uint refuse = BinaryPrimitives.ReadUInt32LittleEndian(welcome.AsSpan(24));
                    if (refuse == Proto.RefuseNoScreenRecording)
                    {
                        Console.WriteLine("Refused: screen recording");
                        Console.WriteLine("The Mac can't share its screen yet: on the Mac, turn on USB-C Display in System Settings > " +
                                          "Privacy & Security > Screen & System Audio Recording.");
                        exitCode = ExitRefused;
                        quitting = true;
                        Win32.PostMessageW(hwnd, Win32.WM_CLOSE, 0, 0);
                        return;  // the finally below closes the connection
                    }
                    throw new InvalidOperationException($"the Mac turned the connection down (reason {refuse})");
                }
                if (first != Proto.Welcome)
                    throw new InvalidOperationException("the Mac didn't welcome us (an older Mac side?)");
                uint token = BinaryPrimitives.ReadUInt32LittleEndian(welcome.AsSpan(4));
                frm = Discovery.ConnectTo(ep, 2000) ?? throw new InvalidOperationException("could not open the frame connection");
                frm.Send(Proto.WinMsg(Proto.Join, token));
                var f = frm;
                frames = new Thread(() => FrameLoop(f, session.Token)) { IsBackground = true, Priority = ThreadPriority.Highest, Name = "frames" };
                frames.Start();
                var c = ctl;
                Input.Sender = m => { lock (ctlSendLock) c.Send(m); };
                Input.Enabled = useInput;
                bye = ControlLoop(ctl, session.Token);
                if (bye) Console.WriteLine("The Mac went away (it is going to sleep, or its side was stopped).");
            }
            catch (Exception e) when (!quitting)
            {
                Console.WriteLine($"Disconnected: {e.Message}");
                announced = false;
            }
            finally
            {
                Input.Enabled = false;
                Input.ReleaseAll();
                Input.Sender = null;
                session.Cancel();
                try { ctl?.Dispose(); } catch { }
                try { frm?.Dispose(); } catch { }
                frames?.Join(2000);
                macCursorVisible = false;
                Win32.PostMessageW(hwnd, Win32.WM_APP_CURSOR, 0, 0);
            }
            if (quitting) break;
            if (bye || mac == null)
            {
                ShowPicture(false);
                DropRenderer();
                Thread.Sleep(500);
                continue;
            }
            if (!LinkRecovery.AdapterUp((int)mac.ScopeId))
            {
                Console.WriteLine("The cable was unplugged.");
                ShowPicture(false);
                DropRenderer();
                continue;
            }
            if (LinkRecovery.IsWedged(mac))
            {
                // The last picture stays up while the link restarts (about half a minute).
                Console.WriteLine("The USB-C link stopped passing data (a USB4 driver problem); restarting it...");
                var t0 = Stopwatch.GetTimestamp();
                if (!LinkRecovery.Restart())
                {
                    Console.WriteLine("Permission declined. Unplug and replug the cable to recover instead.");
                    ShowPicture(false);
                    DropRenderer();
                }
                else if (LinkRecovery.WaitForMac(mac, 150))
                    Console.WriteLine($"Link is back after {(Stopwatch.GetTimestamp() - t0) / Stopwatch.Frequency} s.");
                else
                {
                    Console.WriteLine("The link did not come back; unplug and replug the cable.");
                    ShowPicture(false);
                    DropRenderer();
                }
            }
            Thread.Sleep(200);
        }
    }

    // Reads the control connection: pointer, heartbeats, clock sync. Returns true on goodbye.
    static bool ControlLoop(Socket ctl, CancellationToken stop)
    {
        ctl.ReceiveTimeout = 1500;  // the Mac sends a heartbeat every 100 ms
        var msg = new byte[Proto.MacMsgSize];
        byte[] shape = Array.Empty<byte>();
        uint timeSeq = 0;
        var pendingTime = new Dictionary<uint, long>();
        long lastStats = Stopwatch.GetTimestamp();
        while (!stop.IsCancellationRequested && !quitting)
        {
            Proto.ReadExactly(ctl, msg);
            uint magic = BinaryPrimitives.ReadUInt32LittleEndian(msg);
            switch (magic)
            {
                case Proto.Mouse:
                {
                    int mx = BinaryPrimitives.ReadInt16LittleEndian(msg.AsSpan(4));
                    int my = BinaryPrimitives.ReadInt16LittleEndian(msg.AsSpan(6));
                    bool visible = BinaryPrimitives.ReadUInt16LittleEndian(msg.AsSpan(8)) == 1;
                    bool onDisplay = BinaryPrimitives.ReadUInt16LittleEndian(msg.AsSpan(10)) == 1;
                    ulong polled = BinaryPrimitives.ReadUInt64LittleEndian(msg.AsSpan(12));
                    // The pointer left this display (this trackpad then moves it relatively) or came
                    // back (the cursor goes where it is); switched on the UI thread. Coming back
                    // counts only after the Mac has reported it off this display: right after a
                    // crossing, reports from just before it are still on their way.
                    if (!onDisplay && Input.Relative) Input.SawOffDisplay = true;
                    if (Input.Enabled && windowShown && (!onDisplay && !Input.Relative || onDisplay && Input.Relative && Input.SawOffDisplay))
                        Win32.PostMessageW(hwnd, Win32.WM_APP_POINTER, onDisplay ? 0 : 1, (IntPtr)(int)((ushort)mx | (uint)(ushort)my << 16));
                    // While this PC's trackpad moves the pointer, the Mac's reports are only
                    // its own echo, a little behind: don't pull the cursor back with them.
                    bool localPointer = Stopwatch.GetTimestamp() - Input.LastLocalPointer < Stopwatch.Frequency * 3 / 10;
                    if (visible && !localPointer && !Input.Relative) Win32.SetCursorPos(winX + mx, winY + my);  // picture pixels = window pixels
                    long q = MacNsToQpc(polled);
                    if (q != 0) pointerStats.Add((Stopwatch.GetTimestamp() - q) * 1000.0 / Stopwatch.Frequency);
                    // Shown while this trackpad moves it on this display, whatever macOS says about
                    // hiding it (moving unhides it on the Mac too; this doesn't depend on the report).
                    bool show = visible || (onDisplay && localPointer);
                    if (show != macCursorVisible)
                    {
                        macCursorVisible = show;
                        Win32.PostMessageW(hwnd, Win32.WM_APP_CURSOR, 0, 0);
                        if (show) AnnouncePointer();
                    }
                    break;
                }
                case Proto.Shape:
                {
                    int cw = BinaryPrimitives.ReadUInt16LittleEndian(msg.AsSpan(4));
                    int ch = BinaryPrimitives.ReadUInt16LittleEndian(msg.AsSpan(6));
                    int hotX = BinaryPrimitives.ReadUInt16LittleEndian(msg.AsSpan(8));
                    int hotY = BinaryPrimitives.ReadUInt16LittleEndian(msg.AsSpan(10));
                    int len = BinaryPrimitives.ReadInt32LittleEndian(msg.AsSpan(12));
                    if (cw <= 0 || ch <= 0 || cw > 256 || ch > 256 || len != cw * ch * 4) throw new InvalidOperationException("bad pointer shape");
                    if (shape.Length < len) shape = new byte[len];
                    Proto.ReadExactly(ctl, shape.AsSpan(0, len));
                    IntPtr cursor;
                    fixed (byte* p = shape) cursor = Win32.CreateCursor(p, cw, ch, hotX, hotY);
                    if (cursor != 0)
                    {
                        IntPtr old = macCursor;
                        macCursor = cursor;
                        Win32.PostMessageW(hwnd, Win32.WM_APP_CURSOR, old, 0);  // applied, then the old one freed
                    }
                    break;
                }
                case Proto.Beat:
                {
                    uint seq = BinaryPrimitives.ReadUInt32LittleEndian(msg.AsSpan(4));
                    lock (ctlSendLock) ctl.Send(Proto.WinMsg(Proto.Beat, seq));
                    // Clock sync rides along: a question every other heartbeat (5 a second).
                    if ((seq & 1) == 0)
                    {
                        long now = NowNs();
                        pendingTime[++timeSeq] = now;
                        if (pendingTime.Count > 32) pendingTime.Clear();
                        lock (ctlSendLock) ctl.Send(Proto.WinMsg(Proto.Time, timeSeq, (uint)now, (uint)((ulong)now >> 32)));
                    }
                    break;
                }
                case Input.Layout:
                    Input.SetLayout(BinaryPrimitives.ReadUInt64LittleEndian(msg.AsSpan(8)), BinaryPrimitives.ReadUInt64LittleEndian(msg.AsSpan(16)));
                    break;
                case Proto.InputState:
                    // The first line is for the setup and the watcher, the second for people.
                    if (BinaryPrimitives.ReadUInt32LittleEndian(msg.AsSpan(4)) == 0)
                    {
                        Console.WriteLine("Input: not allowed");
                        Console.WriteLine("Mac: allow USB-C Display in System Settings > Privacy & Security > Device Control and Data Access " +
                                          "on the Mac, so this PC's keyboard and trackpad can control it.");
                    }
                    else
                    {
                        Console.WriteLine("Input: allowed");
                        Console.WriteLine("Mac: this PC's keyboard and trackpad are allowed to control it.");
                    }
                    break;
                case Proto.Time:
                {
                    uint seq = BinaryPrimitives.ReadUInt32LittleEndian(msg.AsSpan(4));
                    ulong macNs = BinaryPrimitives.ReadUInt64LittleEndian(msg.AsSpan(16));
                    if (pendingTime.Remove(seq, out long sent)) OnTimeReply(sent, macNs);
                    break;
                }
                case Proto.Bye:
                    return true;
                case Proto.WindowReady:
                    macWindowSeq = BinaryPrimitives.ReadUInt32LittleEndian(msg.AsSpan(4));
                    if (!windowShown && MayShow(lastAppliedSeq)) ShowPicture(true);
                    break;
                default:
                    throw new InvalidOperationException($"unexpected control message 0x{magic:X8}");
            }
            if (!windowShown && afterMacWindow && MayShow(lastAppliedSeq)) ShowPicture(true);  // the time limit

            long t = Stopwatch.GetTimestamp();
            if (t - lastStats >= (verbose ? 1 : 10) * Stopwatch.Frequency) { PrintStats(t - lastStats); lastStats = t; }
        }
        return false;
    }

    // One line per interval (every 10 s, or every second with --verbose), then starts over.
    static void PrintStats(long ticks)
    {
        double secs = (double)ticks / Stopwatch.Frequency;
        long frames = Interlocked.Exchange(ref statFrames, 0), bytes = Interlocked.Exchange(ref statBytes, 0), h = Interlocked.Exchange(ref statH264, 0);
        if (frames == 0 && !verbose) return;
        var r = renderer;
        string line = $"{DateTime.Now:HH:mm:ss} {frames / secs,4:0} fps ({h} H.264) {bytes / secs / 1e6,6:0.0} MB/s | " +
                      $"apply {applyStats.TakeSummary()} | shown after apply {r?.Shown.TakeSummary() ?? "-"} | " +
                      $"capture->screen {r?.CaptureToDisplay.TakeSummary() ?? "-"} | pointer {pointerStats.TakeSummary()} | " +
                      (r != null && r.ScanlineSync ? $"scan wait {r.ScanWait.TakeSummary()} | flip took {r.FlipDelay.TakeSummary()} | " : "") +
                      $"clock ±{(clockErrorNs == long.MaxValue ? double.NaN : clockErrorNs / 1e6):0.00} ms" +
                      (r != null && r.Presents > 0 ? $" | late {r.MissedFirstRefresh}/{r.Presents}" : "") +
                      (r != null ? $" | {(r.CompositionMode switch { 0 => "composed", 1 => "overlay", 2 => "direct", _ => "?" })}" : "") +
                      (Win32.GetForegroundWindow() == hwnd ? " fg" : " bg");
        Console.WriteLine(line);
        if (r != null) { r.Presents = 0; r.MissedFirstRefresh = 0; }
    }

    // ---- Frames ----
    struct Rect { public int X, Y, W, H, Enc, Len, Offset, Out; }

    static void FrameLoop(Socket s, CancellationToken stop)
    {
        var header = new byte[Proto.MacMsgSize];
        byte[] body = Array.Empty<byte>(), arena = Array.Empty<byte>(), decoded = Array.Empty<byte>();
        var rects = new List<Rect>();
        H264Decoder decoder = null;
        System.IO.FileStream dump = null, dumpLens = null;
        long lastDecodeError = 0;
        try
        {
            while (!stop.IsCancellationRequested && !quitting)
            {
                Proto.ReadExactly(s, header);
                if (BinaryPrimitives.ReadUInt32LittleEndian(header) != Proto.Frame) throw new InvalidOperationException("bad frame header");
                uint seq = BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(4));
                int w = BinaryPrimitives.ReadUInt16LittleEndian(header.AsSpan(8));
                int h = BinaryPrimitives.ReadUInt16LittleEndian(header.AsSpan(10));
                int count = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(12));
                int bodyLen = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(16));
                int frameFlags = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(20));
                ulong captureNs = BinaryPrimitives.ReadUInt64LittleEndian(header.AsSpan(24));
                if (bodyLen < 0 || bodyLen > 64 << 20 || count < 0) throw new InvalidOperationException("bad frame size");
                if (body.Length < bodyLen) body = GC.AllocateUninitializedArray<byte>(bodyLen, pinned: true);
                Proto.ReadExactly(s, body.AsSpan(0, bodyLen));
                long t0 = Stopwatch.GetTimestamp();

                // Where each rect's data is, and where LZ4 rects decode to.
                rects.Clear();
                int pos = 0, arenaNeed = 0;
                for (int i = 0; i < count; i++)
                {
                    if (pos + Proto.RectHeaderSize > bodyLen) throw new InvalidOperationException("bad rect list");
                    var rc = new Rect
                    {
                        X = BinaryPrimitives.ReadUInt16LittleEndian(body.AsSpan(pos)),
                        Y = BinaryPrimitives.ReadUInt16LittleEndian(body.AsSpan(pos + 2)),
                        W = BinaryPrimitives.ReadUInt16LittleEndian(body.AsSpan(pos + 4)),
                        H = BinaryPrimitives.ReadUInt16LittleEndian(body.AsSpan(pos + 6)),
                        Enc = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(pos + 8)),
                        Len = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(pos + 12)),
                    };
                    pos += Proto.RectHeaderSize;
                    int need = rc.W * rc.H * 4;
                    if (rc.X + rc.W > w || rc.Y + rc.H > h || rc.Len < 0 || pos + rc.Len > bodyLen || (rc.Enc != Proto.EncH264 && rc.Len > need))
                        throw new InvalidOperationException("bad tile");
                    if (rc.Enc == Proto.EncRaw && rc.Len != need) throw new InvalidOperationException("bad raw tile");
                    rc.Offset = pos;
                    if (rc.Enc == Proto.EncLz4) { rc.Out = arenaNeed; arenaNeed += need; }
                    pos += rc.Len;
                    rects.Add(rc);
                }
                if (arena.Length < arenaNeed) arena = GC.AllocateUninitializedArray<byte>(arenaNeed, pinned: true);

                // LZ4 tiles decode on all cores.
                var list = rects;
                fixed (byte* b = body, ar = arena)
                {
                    IntPtr bp = (IntPtr)b, ap = (IntPtr)ar;
                    bool bad = false;
                    Parallel.For(0, list.Count, i =>
                    {
                        var rc = list[i];
                        if (rc.Enc != Proto.EncLz4) return;
                        int need = rc.W * rc.H * 4;
                        if (Lz4.Decode((byte*)bp + rc.Offset, rc.Len, (byte*)ap + rc.Out, need) != need) bad = true;
                    });
                    if (bad) throw new InvalidOperationException("bad LZ4 tile");
                }

                // H.264 (only while the link can't keep up, or on request).
                bool picture = false, h264Frame = false;
                foreach (var rc in rects)
                {
                    if (rc.Enc != Proto.EncH264) continue;
                    h264Frame = true;
                    if (dumpPath != null)
                    {
                        if (dump == null)
                        {
                            dump = System.IO.File.Create(dumpPath);
                            dumpLens = System.IO.File.Create(dumpPath + ".len");
                            dumpLens.Write(BitConverter.GetBytes(rc.W));
                            dumpLens.Write(BitConverter.GetBytes(rc.H));
                        }
                        dump.Write(body, rc.Offset, rc.Len);
                        dumpLens.Write(BitConverter.GetBytes(rc.Len));
                        dump.Flush();
                        dumpLens.Flush();
                    }
                    try
                    {
                        decoder ??= new H264Decoder(rc.W, rc.H);
                        if (decoded.Length < rc.W * rc.H * 4) decoded = GC.AllocateUninitializedArray<byte>(rc.W * rc.H * 4, pinned: true);
                        fixed (byte* src = body, dst = decoded) picture = decoder.Decode(src + rc.Offset, rc.Len, dst);
                    }
                    catch (InvalidOperationException e)
                    {
                        // Start over from the next keyframe rather than show a broken picture.
                        if (Stopwatch.GetTimestamp() - lastDecodeError > Stopwatch.Frequency * 5)
                            Console.WriteLine($"Decoder: {e.Message}; asking the Mac for a keyframe.");
                        lastDecodeError = Stopwatch.GetTimestamp();
                        decoder?.Dispose();
                        decoder = null;
                        picture = false;
                        s.Send(Proto.WinMsg(Proto.Ack, Proto.AckWantKeyframe));
                    }
                }

                // Into the picture, all at once; the present thread shows it at the next refresh.
                var r = GetRenderer(w, h);
                int regions = 0;
                long applied;
                lock (r.Sync)
                {
                    fixed (byte* b = body, ar = arena, dec = decoded)
                    {
                        foreach (var rc in rects)
                        {
                            switch (rc.Enc)
                            {
                                case Proto.EncRaw: r.Update(rc.X, rc.Y, rc.W, rc.H, b + rc.Offset, rc.W * 4); break;
                                case Proto.EncLz4: r.Update(rc.X, rc.Y, rc.W, rc.H, ar + rc.Out, rc.W * 4); break;
                                case Proto.EncRegion:
                                    regions++;
                                    if (picture) r.Update(rc.X, rc.Y, rc.W, rc.H, dec + ((long)rc.Y * w + rc.X) * 4, w * 4);
                                    break;
                            }
                        }
                        if (picture && regions == 0) r.Update(0, 0, w, h, dec, w * 4);  // keyframe: the whole picture
                    }
                    applied = Stopwatch.GetTimestamp();
                    r.Applied(applied, MacNsToQpc(captureNs));
                }
                s.Send(Proto.WinMsg(Proto.Ack, seq, (uint)((applied - t0) * 1_000_000 / Stopwatch.Frequency)));
                lastAppliedSeq = seq;
                if (firstFrameAt == 0) firstFrameAt = applied;
                if (!windowShown && MayShow(seq)) ShowPicture(true);

                applyStats.Add((applied - t0) * 1000.0 / Stopwatch.Frequency);
                Interlocked.Increment(ref statFrames);
                Interlocked.Add(ref statBytes, Proto.MacMsgSize + bodyLen);
                if (h264Frame || (frameFlags & 1) != 0) Interlocked.Increment(ref statH264);
            }
        }
        catch (Exception e) when (e is SocketException || e is ObjectDisposedException || e is InvalidOperationException)
        {
            if (!stop.IsCancellationRequested && !quitting) Console.WriteLine($"Frames: {e.Message}");
        }
        finally
        {
            decoder?.Dispose();
            dump?.Dispose();
            dumpLens?.Dispose();
            try { s.Shutdown(SocketShutdown.Both); } catch { }
        }
    }
}
