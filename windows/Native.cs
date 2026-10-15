using System;
using System.Runtime.InteropServices;

namespace UsbcDisplay;

static unsafe class Win32
{
    public const uint WM_DESTROY = 0x0002, WM_ACTIVATE = 0x0006, WM_CLOSE = 0x0010, WM_SETCURSOR = 0x0020, WM_KEYDOWN = 0x0100, WM_CHAR = 0x0102;
    public const uint WM_APP_CURSOR = 0x8001;  // the Mac's pointer changed shape or visibility
    public const uint WM_APP_SHOW = 0x8002;    // wParam 1: show the picture, 0: hide it
    public const uint WM_APP_POINTER = 0x8003; // wParam 1: the Mac's pointer left this display, 0: it's back at lParam (x | y << 16)
    public const uint WM_HOTKEY = 0x0312, MOD_ALT = 1, MOD_CONTROL = 2, MOD_NOREPEAT = 0x4000;
    [DllImport("user32.dll")] public static extern int RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint vk);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern int SystemParametersInfoW(uint action, uint param, void* value, uint flags);

    // Windows' pointer shadow, turned off while the Mac's pointer is shown. Not saved to the
    // profile (no SPIF_UPDATEINIFILE), so it comes back at the next sign-in whatever happens.
    static int savedShadow = -1;
    public static void HidePointerShadow()
    {
        if (savedShadow >= 0) return;
        int on = 0;
        if (SystemParametersInfoW(0x101A /*SPI_GETCURSORSHADOW*/, 0, &on, 0) == 0 || on == 0) return;
        savedShadow = on;
        SystemParametersInfoW(0x101B /*SPI_SETCURSORSHADOW*/, 0, null, 2 /*SPIF_SENDCHANGE*/);
    }
    public static void RestorePointerShadow()
    {
        if (savedShadow <= 0) return;
        SystemParametersInfoW(0x101B, 0, (void*)1, 2);
        savedShadow = -1;
    }
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetMonitorInfoW(IntPtr monitor, byte* info);

    // "\\.\DISPLAY1" for the monitor the window is on.
    public static string MonitorDeviceName(IntPtr hwnd)
    {
        byte* mi = stackalloc byte[104];  // MONITORINFOEXW
        new Span<byte>(mi, 104).Clear();
        *(int*)mi = 104;
        if (GetMonitorInfoW(MonitorFromWindow(hwnd, 2 /*nearest*/), mi) == 0) return @"\\.\DISPLAY1";
        return new string((char*)(mi + 40));
    }
    public const uint WS_POPUP = 0x80000000, WS_EX_TOPMOST = 0x8, WS_EX_TOOLWINDOW = 0x80;
    public const int SW_HIDE = 0, SW_SHOW = 5;

    [StructLayout(LayoutKind.Sequential)]
    public struct WNDCLASSEXW
    {
        public uint cbSize, style;
        public IntPtr lpfnWndProc;
        public int cbClsExtra, cbWndExtra;
        public IntPtr hInstance, hIcon, hCursor, hbrBackground, lpszMenuName, lpszClassName, hIconSm;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam, lParam;
        public uint time;
        public int x, y;
    }

    [DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern ushort RegisterClassExW(WNDCLASSEXW* wc);
    [DllImport("user32.dll")] public static extern IntPtr CreateWindowExW(uint exStyle, char* cls, char* title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
    [DllImport("user32.dll")] public static extern IntPtr DefWindowProcW(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] public static extern int GetMessageW(MSG* msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] public static extern int TranslateMessage(MSG* msg);
    [DllImport("user32.dll")] public static extern IntPtr DispatchMessageW(MSG* msg);
    [DllImport("user32.dll")] public static extern void PostQuitMessage(int code);
    [DllImport("user32.dll")] public static extern int PostMessageW(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] public static extern int DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] public static extern int SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr SetCursor(IntPtr cursor);
    [DllImport("user32.dll")] public static extern int SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern IntPtr CreateIconIndirect(ICONINFO* info);
    [DllImport("user32.dll")] public static extern int DestroyCursor(IntPtr cursor);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateDIBSection(IntPtr dc, byte* bitmapInfo, uint usage, void** bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateBitmap(int w, int h, uint planes, uint bitsPerPixel, void* bits);
    [DllImport("gdi32.dll")] public static extern int DeleteObject(IntPtr obj);

    [StructLayout(LayoutKind.Sequential)]
    public struct ICONINFO
    {
        public int fIcon;
        public uint xHotspot, yHotspot;
        public IntPtr hbmMask, hbmColor;
    }

    // A cursor from straight-alpha BGRA pixels (top row first) with its hot spot.
    public static IntPtr CreateCursor(byte* bgra, int w, int h, int hotX, int hotY)
    {
        byte* bmi = stackalloc byte[40];  // BITMAPINFOHEADER
        new Span<byte>(bmi, 40).Clear();
        *(int*)bmi = 40;
        *(int*)(bmi + 4) = w;
        *(int*)(bmi + 8) = -h;            // top-down
        *(ushort*)(bmi + 12) = 1;         // planes
        *(ushort*)(bmi + 14) = 32;        // bits per pixel
        void* bits;
        IntPtr color = CreateDIBSection(IntPtr.Zero, bmi, 0, &bits, IntPtr.Zero, 0);
        if (color == IntPtr.Zero) return IntPtr.Zero;
        Buffer.MemoryCopy(bgra, bits, (long)w * h * 4, (long)w * h * 4);
        IntPtr mask = CreateBitmap(w, h, 1, 1, null);  // required, unused with 32-bit alpha
        var info = new ICONINFO { fIcon = 0, xHotspot = (uint)hotX, yHotspot = (uint)hotY, hbmMask = mask, hbmColor = color };
        IntPtr cursor = CreateIconIndirect(&info);
        DeleteObject(color);
        DeleteObject(mask);
        return cursor;
    }
    [DllImport("user32.dll")] public static extern int EnumDisplaySettingsW(char* device, int mode, byte* devmode);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr dc, int index);
    [DllImport("gdi32.dll")] public static extern IntPtr GetStockObject(int obj);
    [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandleW(char* name);
    [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
    [DllImport("kernel32.dll")] public static extern uint WaitForSingleObjectEx(IntPtr handle, uint ms, int alertable);
    [DllImport("kernel32.dll")] public static extern int CloseHandle(IntPtr handle);
    [DllImport("winmm.dll")] public static extern uint timeBeginPeriod(uint ms);

    public static void MessageLoop()
    {
        MSG msg;
        while (GetMessageW(&msg, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

// Native resolution, scale and refresh of the main screen.
record struct ScreenInfo(int Width, int Height, int ScalePercent, int Hz, int WidthMm, int HeightMm)
{
    public static unsafe ScreenInfo Primary()
    {
        byte* dm = stackalloc byte[220];
        new Span<byte>(dm, 220).Clear();
        *(ushort*)(dm + 68) = 220;                                     // dmSize
        int w = Win32.GetSystemMetrics(0), h = Win32.GetSystemMetrics(1), hz = 60;
        if (Win32.EnumDisplaySettingsW(null, -1, dm) != 0)
        {
            w = *(int*)(dm + 172);                                     // dmPelsWidth
            h = *(int*)(dm + 176);                                     // dmPelsHeight
            hz = Math.Max(*(int*)(dm + 184), 1);                       // dmDisplayFrequency
        }
        var dc = Win32.GetDC(IntPtr.Zero);
        int mmW = Win32.GetDeviceCaps(dc, 4), mmH = Win32.GetDeviceCaps(dc, 6);
        Win32.ReleaseDC(IntPtr.Zero, dc);
        int scale = (int)Math.Round(Win32.GetDpiForSystem() * 100 / 96.0);
        return new ScreenInfo(w, h, scale, hz, mmW, mmH);
    }
}

// Direct3D 11 flip-model swap chain fed straight from the network buffers.
// Calls COM methods by vtable slot so no interop packages are needed.
//
// Two threads use it: the link thread writes each complete frame into the canvas (Update,
// then Applied), and the present thread (PresentLoop) shows the newest canvas at the next
// refresh. Frames that arrive within one refresh simply merge, so nothing queues up.
// Every use of the Direct3D context happens under `Sync`.
unsafe sealed class Renderer : IDisposable
{
    public readonly object Sync = new();
    readonly System.Threading.AutoResetEvent applied = new(false);
    bool dirty;
    long newestApplied;      // QPC time the newest frame in the canvas was applied
    long newestCapture;      // its capture time, as QPC (0 if unknown)
    // What each present carried, to match with the display's own statistics.
    readonly long[] presentApplied = new long[64], presentCapture = new long[64];
    readonly uint[] presentIds = new uint[64];
    uint lastStatsPresent;
    public LatencyStats Shown = new(), CaptureToDisplay = new();
    public int Presents, MissedFirstRefresh;

    static readonly Guid IID_IDXGIFactory2 = new("50c83a1c-e072-4c48-87b0-3630fa36a6d0");
    static readonly Guid IID_IDXGIFactory5 = new("7632e1f5-ee65-4dca-87fd-84cd75f8838d");
    static readonly Guid IID_IDXGISwapChain2 = new("a8be2ac4-199f-4946-b331-79599fb98de7");
    static readonly Guid IID_ID3D11Texture2D = new("6f15aaf2-d208-4e89-9ab4-489535d34f9c");

    const uint DXGI_FORMAT_B8G8R8A8_UNORM = 87;
    const uint FLAG_FRAME_LATENCY_WAITABLE = 0x40, FLAG_ALLOW_TEARING = 0x800, PRESENT_ALLOW_TEARING = 0x200;

    [StructLayout(LayoutKind.Sequential)]
    struct SwapChainDesc1
    {
        public uint Width, Height, Format;
        public int Stereo;
        public uint SampleCount, SampleQuality, BufferUsage, BufferCount, Scaling, SwapEffect, AlphaMode, Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Texture2DDesc
    {
        public uint Width, Height, MipLevels, ArraySize, Format, SampleCount, SampleQuality, Usage, BindFlags, CpuAccessFlags, MiscFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Box { public uint Left, Top, Front, Right, Bottom, Back; }

    [DllImport("d3d11.dll")]
    static extern int D3D11CreateDevice(void* adapter, int driverType, IntPtr software, uint flags, int* levels, uint numLevels, uint sdkVersion, void** device, int* level, void** context);
    [DllImport("dxgi.dll")]
    static extern int CreateDXGIFactory2(uint flags, Guid* riid, void** factory);

    public readonly int Width, Height;
    public readonly bool Tearing;
    readonly bool vsync;
    void* device, context, swapChain, backBuffer, canvas;
    IntPtr waitable;

    static void** Vt(void* obj) => *(void***)obj;
    static void Release(void* obj) { if (obj != null) ((delegate* unmanaged<void*, uint>)Vt(obj)[2])(obj); }
    static int QueryInterface(void* obj, Guid iid, void** result) => ((delegate* unmanaged<void*, Guid*, void**, int>)Vt(obj)[0])(obj, &iid, result);
    static void Check(int hr, string what) { if (hr < 0) throw new InvalidOperationException($"{what} failed (0x{hr:X8})"); }

    // vsync: show frames at refreshes (unless ScanlineSync is enabled); allowTearing: make
    // immediate flips possible (needed for --tearing and ScanlineSync).
    public Renderer(IntPtr hwnd, int width, int height, bool vsync, bool allowTearing)
    {
        Width = width;
        Height = height;
        this.vsync = vsync;
        void* dev, ctx, factory, sc, buf, tex;
        int level;
        Check(D3D11CreateDevice(null, 1, IntPtr.Zero, 0x20, null, 0, 7, &dev, &level, &ctx), "D3D11CreateDevice");
        device = dev;
        context = ctx;

        Guid iid = IID_IDXGIFactory2;
        Check(CreateDXGIFactory2(0, &iid, &factory), "CreateDXGIFactory2");
        void* factory5;
        if (allowTearing && QueryInterface(factory, IID_IDXGIFactory5, &factory5) >= 0)
        {
            int allow = 0;  // IDXGIFactory5::CheckFeatureSupport(DXGI_FEATURE_PRESENT_ALLOW_TEARING)
            ((delegate* unmanaged<void*, int, void*, uint, int>)Vt(factory5)[28])(factory5, 0, &allow, 4);
            Tearing = allow != 0;
            Release(factory5);
        }

        var desc = new SwapChainDesc1
        {
            Width = (uint)width, Height = (uint)height, Format = DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleCount = 1, BufferUsage = 0x20, BufferCount = 2,
            Scaling = 0,     // stretch if the window and frame sizes ever differ
            // Flip sequential: a full-screen window can skip the compositor, and each buffer
            // keeps its picture, so a present only copies what changed since that buffer was
            // last shown (copying all 9 MB made frames miss refreshes they arrived in time for).
            SwapEffect = 3,
            Flags = FLAG_FRAME_LATENCY_WAITABLE | (Tearing ? FLAG_ALLOW_TEARING : 0),
        };
        int hr = ((delegate* unmanaged<void*, void*, IntPtr, SwapChainDesc1*, void*, void*, void**, int>)Vt(factory)[15])(factory, dev, hwnd, &desc, null, null, &sc);
        ((delegate* unmanaged<void*, IntPtr, uint, int>)Vt(factory)[8])(factory, hwnd, 2);  // MakeWindowAssociation: no Alt+Enter
        Release(factory);
        Check(hr, "CreateSwapChainForHwnd");
        swapChain = sc;

        void* sc2;
        if (QueryInterface(sc, IID_IDXGISwapChain2, &sc2) >= 0)
        {
            ((delegate* unmanaged<void*, uint, int>)Vt(sc2)[31])(sc2, 1);                    // SetMaximumFrameLatency
            waitable = ((delegate* unmanaged<void*, IntPtr>)Vt(sc2)[33])(sc2);                // GetFrameLatencyWaitableObject
            Release(sc2);
        }

        iid = IID_ID3D11Texture2D;
        Check(((delegate* unmanaged<void*, uint, Guid*, void**, int>)Vt(sc)[9])(sc, 0, &iid, &buf), "GetBuffer");
        backBuffer = buf;

        // The canvas holds the whole picture; tiles land here and it is copied to the back buffer.
        var td = new Texture2DDesc
        {
            Width = (uint)width, Height = (uint)height, MipLevels = 1, ArraySize = 1,
            Format = DXGI_FORMAT_B8G8R8A8_UNORM, SampleCount = 1, BindFlags = 0x8,
        };
        Check(((delegate* unmanaged<void*, Texture2DDesc*, void*, void**, int>)Vt(dev)[5])(dev, &td, null, &tex), "CreateTexture2D");
        canvas = tex;
    }

    // ID3D11DeviceContext::UpdateSubresource. Call under Sync.
    public void Update(int x, int y, int w, int h, byte* pixels, int pitch)
    {
        var box = new Box { Left = (uint)x, Top = (uint)y, Front = 0, Right = (uint)(x + w), Bottom = (uint)(y + h), Back = 1 };
        ((delegate* unmanaged<void*, void*, uint, Box*, void*, uint, uint, void>)Vt(context)[48])(context, canvas, 0, &box, pixels, (uint)pitch, 0);
        pendingRects.Add(box);
    }

    // Areas changed since the last present, and the ones that present changed: the back buffer
    // we draw into next was last shown two presents ago, so it lacks both.
    readonly System.Collections.Generic.List<Box> pendingRects = new(), lastRects = new();
    int fullCopies = 2;  // both buffers start empty

    void CopyChangedToBackBuffer()
    {
        int count = pendingRects.Count + lastRects.Count;
        if (fullCopies > 0 || count > 512)
        {
            ((delegate* unmanaged<void*, void*, void*, void>)Vt(context)[47])(context, backBuffer, canvas);   // CopyResource
            fullCopies = fullCopies > 0 ? fullCopies - 1 : 1;  // the other buffer needs it too
        }
        else
        {
            var copy = (delegate* unmanaged<void*, void*, uint, uint, uint, uint, void*, uint, Box*, void>)Vt(context)[46];  // CopySubresourceRegion
            foreach (var list in new[] { pendingRects, lastRects })
                foreach (var b in list)
                {
                    var box = b;
                    copy(context, backBuffer, 0, box.Left, box.Top, 0, canvas, 0, &box);
                }
        }
        lastRects.Clear();
        lastRects.AddRange(pendingRects);
        pendingRects.Clear();
    }

    // A whole frame is in the canvas (call under Sync, after its Updates).
    public void Applied(long appliedQpc, long captureQpc)
    {
        dirty = true;
        newestApplied = appliedQpc;
        newestCapture = captureQpc;
        applied.Set();
    }

    // ---- Tear-free immediate flips (ScanlineSync) ----
    // The panel draws top to bottom, one line after another. A flip taking effect while it
    // draws line L shows the old picture above L and the new one below, for that refresh. If
    // nothing changed around L, that split can't be seen: so a frame is flipped the moment the
    // line being drawn (plus a margin for the flip to take effect) is clear of the area that
    // changed, instead of waiting for the next refresh. Only when the panel is drawing right
    // through the changed area does the flip wait until it has passed.
    public bool ScanlineSync { get; private set; }
    uint kmtAdapter, kmtSource;
    int vTotal;             // lines per refresh, active + blanking (largest scan line seen)
    double marginMs = 2.0;  // from Present() to the flip taking effect, with room to spare
    public LatencyStats ScanWait = new(), FlipDelay = new();
    void* gpuDone;  // event query: the GPU has finished what came before it

    // An immediate flip takes effect once the GPU has finished the copy before it; that time
    // (from Present) is what the scan-line margin must cover. Called under Sync.
    void MeasureFlipWork(long presentAt)
    {
        if (gpuDone == null)
        {
            long desc = 0;  // D3D11_QUERY_DESC { D3D11_QUERY_EVENT, 0 }
            void* q;
            if (((delegate* unmanaged<void*, long*, void**, int>)Vt(device)[24])(device, &desc, &q) < 0) return;  // CreateQuery
            gpuDone = q;
        }
        ((delegate* unmanaged<void*, void*, void>)Vt(context)[28])(context, gpuDone);  // End
        long limit = presentAt + System.Diagnostics.Stopwatch.Frequency / 100;
        int done = 0;
        while (((delegate* unmanaged<void*, void*, void*, uint, uint, int>)Vt(context)[29])(context, gpuDone, &done, 4, 0) != 0)  // GetData: S_FALSE while busy
            if (System.Diagnostics.Stopwatch.GetTimestamp() > limit) return;
        double ms = (System.Diagnostics.Stopwatch.GetTimestamp() - presentAt) * 1000.0 / System.Diagnostics.Stopwatch.Frequency;
        FlipDelay.Add(ms);
        // Keep the margin comfortably above the slowest recent flip (bigger changes copy longer).
        slowestFlip = Math.Max(ms, slowestFlip * 0.995);
        marginMs = Math.Clamp(slowestFlip * 1.5 + 0.5, 2.0, 5.0);
    }
    double slowestFlip;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct OpenAdapterFromGdiDisplayName { [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName; public uint hAdapter, LuidLow; public int LuidHigh; public uint VidPnSourceId; }
    [StructLayout(LayoutKind.Sequential)]
    struct GetScanLineArgs { public uint hAdapter, VidPnSourceId; public byte InVerticalBlank; public uint ScanLine; }
    [DllImport("gdi32.dll")] static extern int D3DKMTOpenAdapterFromGdiDisplayName(ref OpenAdapterFromGdiDisplayName a);
    [DllImport("gdi32.dll")] static extern int D3DKMTGetScanLine(ref GetScanLineArgs a);

    public bool EnableScanlineSync(string gdiDeviceName)
    {
        if (!Tearing) return false;
        var o = new OpenAdapterFromGdiDisplayName { DeviceName = gdiDeviceName };
        if (D3DKMTOpenAdapterFromGdiDisplayName(ref o) != 0) return false;
        kmtAdapter = o.hAdapter;
        kmtSource = o.VidPnSourceId;
        vTotal = Height + 1;
        for (int i = 0; i < 400; i++) { if (ScanLine(out _) < 0) return false; System.Threading.Thread.SpinWait(2000); }  // learn the blanking
        ScanlineSync = true;
        return true;
    }

    int ScanLine(out bool blank)
    {
        var a = new GetScanLineArgs { hAdapter = kmtAdapter, VidPnSourceId = kmtSource };
        blank = false;
        if (D3DKMTGetScanLine(ref a) != 0) return -1;
        blank = a.InVerticalBlank != 0;
        int line = (int)a.ScanLine;
        if (line + 1 > vTotal && line < 4 * Height) vTotal = line + 1;
        return blank && line < Height ? Height : line;  // some drivers report 0 during blanking
    }

    // Waits until flipping can't show a seam in rows [top, bottom); returns the line being drawn.
    int WaitForCleanFlip(int top, int bottom, Func<bool> stop)
    {
        long start = System.Diagnostics.Stopwatch.GetTimestamp(), limit = System.Diagnostics.Stopwatch.Frequency / 25;
        while (true)
        {
            int s = ScanLine(out _);
            if (s < 0) return 0;
            double linesPerMs = vTotal / RefreshMs;
            int reach = (int)(marginMs * linesPerMs) + 8;  // lines drawn before the flip lands, at most
            int end = s + reach;
            bool hit = end < vTotal ? top < end && bottom > s : bottom > s || top < end - vTotal;
            if (!hit || System.Diagnostics.Stopwatch.GetTimestamp() - start > limit || stop()) return s;
            System.Threading.Thread.SpinWait(200);
        }
    }

    // The present thread: shows the newest canvas as soon as it can be shown cleanly (or at
    // each refresh, without ScanlineSync).
    public void PresentLoop(Func<bool> stop)
    {
        // Windows shows a full-screen window directly (no compositor, a frame sooner) only
        // after a run of presents; give it that run right away instead of on the first motion.
        int warm = 90;
        while (!stop())
        {
            bool fresh = true;  // carries a newly applied frame (warm-up repeats don't count in the stats)
            if (warm > 0)
            {
                warm--;
                lock (Sync) { fresh = dirty; dirty = true; }
                if (ScanlineSync) System.Threading.Thread.Sleep(15);
            }
            else if (!applied.WaitOne(100)) { ReadStats(); continue; }
            // Waits until the previous present has reached the screen (frame latency 1), so
            // anything applied meanwhile joins this present instead of queueing behind it.
            if (waitable != IntPtr.Zero && vsync && !ScanlineSync) Win32.WaitForSingleObjectEx(waitable, 100, 1);
            int top = int.MaxValue, bottom = 0;
            bool clean = false;  // this present flips at once, timed by the scan line
            if (ScanlineSync)
            {
                lock (Sync) foreach (var b in pendingRects) { top = Math.Min(top, (int)b.Top); bottom = Math.Max(bottom, (int)b.Bottom); }
                // A change taller than what the panel draws outside it, plus the margin, never
                // has a clean moment (most of the screen changing): that one waits for a refresh.
                int reach = (int)(marginMs * vTotal / RefreshMs) + 8;
                clean = bottom == 0 || bottom - top + reach < vTotal - 4;
                long t0 = System.Diagnostics.Stopwatch.GetTimestamp();
                if (clean && bottom > 0) WaitForCleanFlip(top, bottom, stop);
                else if (!clean && waitable != IntPtr.Zero) Win32.WaitForSingleObjectEx(waitable, 100, 1);
                ScanWait.Add((System.Diagnostics.Stopwatch.GetTimestamp() - t0) * 1000.0 / System.Diagnostics.Stopwatch.Frequency);
            }
            lock (Sync)
            {
                if (device == null) return;
                if (!dirty) continue;
                dirty = false;
                if (ScanlineSync)  // what arrived while waiting counts too
                    foreach (var b in pendingRects) { top = Math.Min(top, (int)b.Top); bottom = Math.Max(bottom, (int)b.Bottom); }
                CopyChangedToBackBuffer();
                bool tear = (ScanlineSync && clean) || (Tearing && !vsync && !ScanlineSync);
                long presentAt = System.Diagnostics.Stopwatch.GetTimestamp();
                int hr = ((delegate* unmanaged<void*, uint, uint, int>)Vt(swapChain)[8])(swapChain, tear ? 0u : 1u, tear ? PRESENT_ALLOW_TEARING : 0);
                if (hr < 0) throw new InvalidOperationException($"Present failed (0x{hr:X8})");
                if (ScanlineSync && clean && bottom > 0 && fresh) MeasureFlipWork(presentAt);
                if (ScanlineSync && clean && fresh && bottom > 0)
                {
                    // When the changed rows go out: the next time the panel draws `top` after the flip.
                    long now = System.Diagnostics.Stopwatch.GetTimestamp();
                    int s = ScanLine(out _);
                    double linesPerMs = vTotal / RefreshMs, flipAt = s + marginMs * linesPerMs / 2;
                    double ms = (top >= flipAt ? top - s : vTotal - s + top) / linesPerMs;
                    double shown = (now - newestApplied) * 1000.0 / System.Diagnostics.Stopwatch.Frequency + ms;
                    Shown.Add(shown);
                    if (shown > RefreshMs + 1.0) MissedFirstRefresh++;
                    if (newestCapture != 0) CaptureToDisplay.Add((now - newestCapture) * 1000.0 / System.Diagnostics.Stopwatch.Frequency + ms);
                    Presents++;
                    continue;
                }
                uint id;
                ((delegate* unmanaged<void*, uint*, int>)Vt(swapChain)[17])(swapChain, &id);  // GetLastPresentCount
                int slot = (int)(id & 63);
                presentIds[slot] = id;
                presentApplied[slot] = fresh ? newestApplied : 0;
                presentCapture[slot] = fresh ? newestCapture : 0;
                if (fresh) Presents++;
                ReadStats();
            }
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    struct FrameStatistics { public uint PresentCount, PresentRefreshCount, SyncRefreshCount; public long SyncQPCTime, SyncGPUTime; }

    [StructLayout(LayoutKind.Sequential)]
    struct FrameStatisticsMedia { public uint PresentCount, PresentRefreshCount, SyncRefreshCount; public long SyncQPCTime, SyncGPUTime; public int CompositionMode; public uint ApprovedPresentDuration; }
    static readonly Guid IID_IDXGISwapChainMedia = new("dd95b90b-f05f-4f6a-bd65-25bfb264bd84");
    // How Windows showed the last present: 0 composed by DWM (a frame later), 1 overlay,
    // 2 directly ("independent flip"), -1 unknown.
    public int CompositionMode = -1;

    // IDXGISwapChain::GetFrameStatistics: when the newest displayed present reached the screen.
    void ReadStats()
    {
        if (swapChain == null) return;
        void* media;
        if (QueryInterface(swapChain, IID_IDXGISwapChainMedia, &media) >= 0)
        {
            FrameStatisticsMedia fm;
            if (((delegate* unmanaged<void*, FrameStatisticsMedia*, int>)Vt(media)[3])(media, &fm) >= 0) CompositionMode = fm.CompositionMode;
            Release(media);
        }
        FrameStatistics fs;
        int hr = ((delegate* unmanaged<void*, FrameStatistics*, int>)Vt(swapChain)[16])(swapChain, &fs);
        if (hr < 0 || fs.PresentCount == lastStatsPresent || fs.SyncQPCTime == 0) return;
        lastStatsPresent = fs.PresentCount;
        int slot = (int)(fs.PresentCount & 63);
        if (presentIds[slot] != fs.PresentCount || presentApplied[slot] == 0) return;
        double ms = (fs.SyncQPCTime - presentApplied[slot]) * 1000.0 / System.Diagnostics.Stopwatch.Frequency;
        if (ms < 0 || ms > 1000) return;
        Shown.Add(ms);
        if (ms > RefreshMs + 1.0) MissedFirstRefresh++;
        if (presentCapture[slot] != 0)
            CaptureToDisplay.Add((fs.SyncQPCTime - presentCapture[slot]) * 1000.0 / System.Diagnostics.Stopwatch.Frequency);
    }

    public double RefreshMs = 1000.0 / 60;

    public void Dispose()
    {
        applied.Set();
        lock (Sync)
        {
            Release(gpuDone);
            gpuDone = null;
            Release(canvas); Release(backBuffer); Release(swapChain); Release(context); Release(device);
            canvas = backBuffer = swapChain = context = device = null;
            if (waitable != IntPtr.Zero) Win32.CloseHandle(waitable);
            waitable = IntPtr.Zero;
        }
    }
}

// Running percentiles over a window of samples (milliseconds).
sealed class LatencyStats
{
    readonly System.Collections.Generic.List<double> v = new();
    public void Add(double ms) { lock (v) v.Add(ms); }
    public int Count { get { lock (v) return v.Count; } }
    // "p50 x / p95 y / max z ms (n)", then starts a new window.
    public string TakeSummary()
    {
        double[] a;
        lock (v) { a = v.ToArray(); v.Clear(); }
        if (a.Length == 0) return "-";
        Array.Sort(a);
        double P(double q) => a[Math.Min(a.Length - 1, (int)(q * a.Length))];
        return $"p50 {P(0.5):0.0} / p95 {P(0.95):0.0} / max {a[^1]:0.0} ms ({a.Length})";
    }
}
