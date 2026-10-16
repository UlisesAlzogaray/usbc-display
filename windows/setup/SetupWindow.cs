using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace UsbcSetup;

// The setup window: a transparent canvas for a transparent WebView2 that shows the wizard (ui/**,
// from this exe's resources). The page draws a Mac window on it, exactly as the Mac's copy of
// this window looks after the handover: an 800 x 600 pt OnBoardingKit window with macOS's 16 pt
// continuous corners, its edge, a transparent title band and traffic lights. Outside its corners
// the desktop shows (no redirection surface: the WebView's alpha reaches the desktop), and
// MacShadow draws the Mac's shadow under it. Elements with CSS `app-region: drag` move the
// window; the page posts "minimize" / "close".
//
// It opens cloaked (DWM keeps it invisible, shadow hidden) and appears whole once the page has
// drawn its first real screen ("shown"), or after 5 s whatever happens (15 s when it takes over
// from the downloaded copy, whose window stays up meanwhile).
sealed class SetupWindow : Form
{
    const string Origin = "https://setup.usbc-display.example";

    readonly Wizard wizard;
    readonly bool resumed;
    readonly IntPtr behind;  // the downloaded copy's window, which this one takes over from
    readonly WebView2 web;
    readonly System.Windows.Forms.Timer poster = new() { Interval = 100 };  // state at most 10 times a second
    CoreWebView2Environment env;
    bool appRegion;          // the runtime supports CSS app-region (WebView2 1.0.2420 and later)
    MacShadow shadow;
    IntPtr hwnd;             // Handle, readable from any thread
    bool revealed, closingInternally;

    public SetupWindow(Wizard wizard, Point? at, bool resumed, IntPtr behind)
    {
        this.wizard = wizard;
        this.resumed = resumed;
        this.behind = behind;
        SuspendLayout();
        AutoScaleMode = AutoScaleMode.None;  // sized by hand below
        Text = "USB-C Display Setup";
        FormBorderStyle = FormBorderStyle.FixedSingle;  // keeps the caption styles: snap, minimize animation
        MaximizeBox = false;
        MinimizeBox = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.Black;  // never seen: there's no redirection surface
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath); } catch { }
        Place(at);

        web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent };
        Controls.Add(web);
        ResumeLayout(false);

        poster.Tick += (_, _) => { Post(); wizard.MaybeReleaseHold(); };
        wizard.InstalledElsewhere += frame => BeginInvokeSafe(() => HandOff(frame));
        wizard.ScreenClosed += () => BeginInvokeSafe(BackFromScreen);
        wizard.PictureShown += OnPictureShown;
        wizard.WindowPlace = PanelPlace;
        wizard.PrepareForHandover = PrepareForHandover;
        wizard.OwnerWindow = () => hwnd;
        wizard.RemoteClick += OnRemoteClick;
        SystemEvents.UserPreferenceChanged += OnThemeChanged;
    }

    // 800 x 600 Mac points at the Mac display's scale (f panel pixels a point, the size the
    // display will use), so the Mac's copy after the handover is 800 x 600 pt at the same spot.
    // Centred on the screen with the pointer, or at the old window's spot; scaled down evenly if
    // the work area is smaller (the page follows --mpt).
    Size WindowSize(Screen screen) => FitWindow(wizard.Scale / 100.0, screen.WorkingArea, screen.Bounds, screen.Primary);

    // On this PC's own panel the window also fits below the menu bar the Mac draws at the top of
    // its new display (MenuBar, where PrepareForHandover moves it), so the Mac's copy keeps its
    // bottom edge and shadow on that display.
    internal static Size FitWindow(double f, Rectangle wa, Rectangle bounds, bool primary)
    {
        double w = 800 * f, h = 600 * f;
        double avail = primary ? wa.Bottom - Math.Max(wa.Top, bounds.Top + MenuBar(f)) : wa.Height;
        double k = Math.Min(1, Math.Min(wa.Width / w, avail / h));
        return new Size((int)Math.Round(w * k), (int)Math.Round(h * k));
    }

    // The Mac's menu bar on its new display (this PC's panel), in panel pixels: the window's top
    // stays below it at the handover.
    static int MenuBar(double f) => (int)Math.Ceiling(40 * f);

    void Place(Point? at)
    {
        var screen = at.HasValue ? Screen.FromPoint(at.Value) : Screen.FromPoint(Cursor.Position);
        var wa = screen.WorkingArea;
        var size = WindowSize(screen);
        var loc = at ?? new Point(wa.Left + (wa.Width - size.Width) / 2, wa.Top + (wa.Height - size.Height) / 2);
        Bounds = new Rectangle(loc, size);
    }

    // Taking over from the downloaded copy: open in its exact spot but underneath it, and come
    // forward only once the page shows the same frame ("shown"). The swap then looks like nothing.
    protected override bool ShowWithoutActivation => behind != IntPtr.Zero;

    readonly System.Windows.Forms.Timer failsafe = new() { Interval = 5000 };

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (behind != IntPtr.Zero)
            Native.SetWindowPos(Handle, behind, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
        // This PC's display stays on while setup is open (it's the display being set up).
        Native.SetThreadExecutionState(Native.ES_CONTINUOUS | Native.ES_DISPLAY_REQUIRED | Native.ES_SYSTEM_REQUIRED);
        // Taking over, the downloaded copy's window shows the same frame meanwhile, so a slow first
        // run (single-file extraction, WebView2, the checks) waits longer before revealing an
        // unpainted window and closing that one (it gives up by itself after 20 s).
        if (behind != IntPtr.Zero) failsafe.Interval = 15000;
        failsafe.Tick += (_, _) =>
        {
            failsafe.Stop();
            if (!revealed) Log.Write($"window: no first screen after {failsafe.Interval / 1000} s, showing it anyway");
            Reveal();
        };
        failsafe.Start();
    }

    // The window keeps its size in panel pixels on any screen: it's sized in Mac points at the
    // Mac display's scale, not by Windows' scaling.
    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        Bounds = new Rectangle(e.SuggestedRectangle.Location, Size);
    }

    // No system menu: with the frame extended over the whole window, DWM would otherwise draw its
    // own (dead) minimize and close buttons over the page's. The caption and minimize-box styles
    // stay, for snap and the minimize animation.
    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.Style = (cp.Style & ~Native.WS_SYSMENU) | Native.WS_MINIMIZEBOX;
            cp.ExStyle |= Native.WS_EX_NOREDIRECTIONBITMAP;  // the page's transparent corners show the desktop
            return cp;
        }
    }

    // Alt+F4 closes the window as the close light does (it came through the system menu). The
    // WebView2 control passes keys the page doesn't use on to the form, so this also works with
    // the focus in the page.
    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == (Keys.Alt | Keys.F4)) { UserClose(); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    protected override void WndProc(ref Message m)
    {
        // The whole window is client area: the page draws the title band.
        if (m.Msg == Native.WM_NCCALCSIZE && m.WParam != IntPtr.Zero) { m.Result = IntPtr.Zero; return; }
        base.WndProc(ref m);
        if (m.Msg == Native.WM_WINDOWPOSCHANGED) shadow?.Follow();  // moved, sized, shown, hidden or restacked
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        hwnd = Handle;
        // Invisible until the page has drawn its first screen (Reveal); DWM still composes it, so
        // the page renders meanwhile.
        int on = revealed ? 0 : 1;
        Native.DwmSetWindowAttribute(Handle, Native.DWMWA_CLOAK, ref on, 4);
        ApplyFrame();
        shadow ??= new MacShadow(this, Machine.DarkMode());
        Native.SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, Native.SWP_FRAMECHANGED | Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
    }

    // Nothing of Windows' own frame: no backdrop, no rounded corners, border or shadow from DWM
    // (the page draws macOS's corners and edge, MacShadow the shadow).
    void ApplyFrame()
    {
        int dark = Machine.DarkMode() ? 1 : 0;
        Native.DwmSetWindowAttribute(Handle, Native.DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, 4);
        int square = Native.DWMWCP_DONOTROUND;
        Native.DwmSetWindowAttribute(Handle, Native.DWMWA_WINDOW_CORNER_PREFERENCE, ref square, 4);
        int noBorder = Native.DWMWA_COLOR_NONE;
        Native.DwmSetWindowAttribute(Handle, Native.DWMWA_BORDER_COLOR, ref noBorder, 4);
        int noFrame = Native.DWMNCRP_DISABLED;
        Native.DwmSetWindowAttribute(Handle, Native.DWMWA_NCRENDERING_POLICY, ref noFrame, 4);
    }

    // The page's first real screen is drawn ("shown", or the failsafe): the window appears whole,
    // with its shadow. Taking over from the downloaded copy, it's right underneath that copy's
    // window, with the same frame: that copy hides its window and its shadow in one step and
    // closes, and this one comes forward and shows its shadow (drawn while hidden) the moment
    // that window has gone (two shadows would stack otherwise).
    void Reveal()
    {
        if (revealed || IsDisposed) return;
        revealed = true;
        failsafe.Stop();
        int off = 0;
        Native.DwmSetWindowAttribute(Handle, Native.DWMWA_CLOAK, ref off, 4);
        if (behind != IntPtr.Zero) WatchBehind();  // before the signal: that window may go at once
        if (resumed)
            try { using var ev = EventWaitHandle.OpenExisting(Program.ResumedEventName); ev.Set(); } catch { }
        if (behind == IntPtr.Zero)
        {
            if (shadow != null) shadow.Allowed = true;
            Activate();
            wizard.CameForward();
        }
    }

    // Waits for the downloaded copy's window to go: a WinEvent from that copy says so at once (a
    // poll would wait for the 15.6 ms system timer); a short poll is the fallback, 1.5 s at most.
    Native.WinEventProc behindGone;  // kept alive as long as the window (the hook calls it)
    void WatchBehind()
    {
        var t = Stopwatch.StartNew();
        var poll = new System.Windows.Forms.Timer { Interval = 10 };
        IntPtr hook = IntPtr.Zero;
        bool done = false;
        bool Gone() => !Native.IsWindow(behind) || !Native.IsWindowVisible(behind);
        void Forward(string how)
        {
            if (done) return;
            done = true;
            poll.Stop();
            poll.Dispose();
            if (hook != IntPtr.Zero) Native.UnhookWinEvent(hook);
            hook = IntPtr.Zero;
            if (IsDisposed) return;
            if (shadow != null) shadow.Allowed = true;
            BringForward();
            wizard.CameForward();
            Log.Write($"handoff: the downloaded copy's window went after {t.ElapsedMilliseconds} ms ({how}); this one is in front");
        }
        behindGone = (_, ev, w, obj, child, _, _) =>
        {
            if (w == behind && obj == 0 && child == 0 && ev != Native.EVENT_OBJECT_SHOW) Forward(ev == Native.EVENT_OBJECT_HIDE ? "hidden" : "destroyed");
        };
        Native.GetWindowThreadProcessId(behind, out uint pid);
        if (pid != 0)
            hook = Native.SetWinEventHook(Native.EVENT_OBJECT_DESTROY, Native.EVENT_OBJECT_HIDE, IntPtr.Zero, behindGone, pid, 0, Native.WINEVENT_OUTOFCONTEXT);
        if (hook == IntPtr.Zero) Log.Write("handoff: no window event hook; polling");
        poll.Tick += (_, _) => { if (Gone()) Forward("poll"); else if (t.ElapsedMilliseconds >= 1500) Forward("still there after 1.5 s"); };
        poll.Start();
        if (Gone()) Forward("already gone");
    }

    // The page greys its traffic lights when the window isn't in front, as macOS does. While the
    // window is handed over to the Mac (from startScreen until the Mac's copy closes) it doesn't
    // hear "inactive": the display takes the foreground at the cut, and the Mac's copy, which
    // draws the mirrored look until it is key itself, must not turn grey then. Otherwise every
    // real change is posted, also while the installed copy holds the downloaded copy's frame (the
    // page draws setup.hold.active until the hold ends, then this).
    protected override void OnActivated(EventArgs e) { base.OnActivated(e); SetActive(true); }
    protected override void OnDeactivate(EventArgs e) { base.OnDeactivate(e); SetActive(false); }
    void SetActive(bool on)
    {
        if (!on && wizard.Mirroring) return;
        try { web?.CoreWebView2?.PostWebMessageAsJson(on ? "{\"type\":\"active\",\"on\":true}" : "{\"type\":\"active\",\"on\":false}"); } catch { }
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "USB-C Display", "WebView2");
            // Keeps painting while cloaked or covered: the installed copy draws its first screen
            // behind the downloaded copy's window, so the swap shows no reload.
            env = await CoreWebView2Environment.CreateAsync(null, data, new CoreWebView2EnvironmentOptions
                { AdditionalBrowserArguments = "--disable-features=CalculateNativeWinOcclusion" });
            await web.EnsureCoreWebView2Async(env);
            await SetUpPage();
        }
        catch (Exception ex)
        {
            Log.Write("webview: " + ex);
            WindowFailed();
        }
    }

    // An informational alert (OK is its button), like the app's other dialogs: its icon, its own
    // OK in its language.
    void WindowFailed()
    {
        var ok = new TaskDialogButton("OK");
        var page = new TaskDialogPage
        {
            AllowCancel = true,
            Caption = "USB-C Display Setup",
            Heading = "USB-C Display Setup can’t show its window.",
            Text = "Restart this PC, then open USB-C Display Setup again.",
            Buttons = { ok },
            DefaultButton = ok,
        };
        using var icon = Program.AppIcon();
        if (icon != null) page.Icon = new TaskDialogIcon(icon);
        TaskDialog.ShowDialog(page, TaskDialogStartupLocation.CenterScreen);
        CloseNow();
    }

    async Task SetUpPage()
    {
        var core = web.CoreWebView2;
        var s = core.Settings;
        bool devTools = Environment.GetEnvironmentVariable("USBC_SETUP_DEVTOOLS") == "1";
        s.AreDevToolsEnabled = devTools;
        s.AreDefaultContextMenusEnabled = devTools;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.AreDefaultScriptDialogsEnabled = true;
        // Newer settings: an older WebView2 runtime doesn't have them, which is fine.
        Try(() => s.AreBrowserAcceleratorKeysEnabled = false, "accelerator keys");
        Try(() => s.IsGeneralAutofillEnabled = false, "autofill");
        Try(() => s.IsPasswordAutosaveEnabled = false, "password autosave");
        Try(() => s.IsPinchZoomEnabled = false, "pinch zoom");
        Try(() => s.IsSwipeNavigationEnabled = false, "swipe navigation");
        appRegion = Try(() => s.IsNonClientRegionSupportEnabled = true, "app-region");  // CSS app-region: drag moves the window

        core.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += ServeUi;
        core.WebMessageReceived += OnMessage;
        core.NewWindowRequested += (_, a) => { a.Handled = true; OpenExternal(a.Uri); };
        core.NavigationStarting += (_, a) =>
        {
            if (a.Uri.StartsWith(Origin + "/", StringComparison.OrdinalIgnoreCase)) return;
            a.Cancel = true;
            OpenExternal(a.Uri);
        };
        core.NavigationCompleted += (_, a) => web.Focus();
        await core.AddScriptToExecuteOnDocumentCreatedAsync(HostScript());
        core.Navigate(Origin + "/index.html");
        poster.Start();
    }

    static bool Try(Action a, string what)
    {
        try { a(); return true; }
        catch (Exception e) { Log.Write($"webview: no {what} setting in this runtime ({e.GetType().Name})"); return false; }
    }

    // window.usbcHost = { dark, windowsBuild, appRegion }: Windows' theme (only for the first
    // look, before the Mac's is known), and whether CSS app-region works in this runtime.
    // Without it, a press on an `app-region: drag` element posts startDrag instead. The page's
    // colours are macOS's, never Windows' accent.
    string HostScript()
    {
        string host = JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["dark"] = Machine.DarkMode(), ["windowsBuild"] = Machine.WindowsBuild, ["appRegion"] = appRegion,
        });
        return $$"""
            (() => {
              window.usbcHost = {{host}};
              if (!window.usbcHost.appRegion && !window.usbcDragFallback) {
                window.usbcDragFallback = true;
                addEventListener('mousedown', e => {
                  if (e.button !== 0) return;
                  for (let el = e.target; el && el.nodeType === 1; el = el.parentElement) {
                    const cs = getComputedStyle(el);
                    const r = cs.getPropertyValue('app-region') || cs.getPropertyValue('-webkit-app-region');
                    if (r === 'no-drag') return;
                    if (r === 'drag') { e.preventDefault(); chrome.webview.postMessage({ cmd: 'startDrag' }); return; }
                  }
                }, true);
              }
            })();
            """;
    }

    void OnThemeChanged(object sender, UserPreferenceChangedEventArgs e)
    {
        if (e.Category != UserPreferenceCategory.General && e.Category != UserPreferenceCategory.Color && e.Category != UserPreferenceCategory.VisualStyle) return;
        BeginInvokeSafe(async () =>
        {
            ApplyFrame();
            try { if (web.CoreWebView2 != null) await web.CoreWebView2.ExecuteScriptAsync(HostScript()); } catch { }
        });
    }

    void ServeUi(object sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        string path;
        try { path = Uri.UnescapeDataString(new Uri(e.Request.Uri).AbsolutePath).TrimStart('/'); }
        catch { path = ""; }
        if (path == "") path = "index.html";
        byte[] body = path.Contains("..") ? null : Resources.Get("ui/" + path);
        if (body == null && path == "index.html") body = Encoding.UTF8.GetBytes(Placeholder);
        if (body == null)
        {
            e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
            return;
        }
        e.Response = env.CreateWebResourceResponse(new MemoryStream(body), 200, "OK",
            $"Content-Type: {Resources.ContentType(path)}\r\nCache-Control: no-store");
    }

    // Shown only by a build made without the wizard screens.
    const string Placeholder = """
        <!doctype html><html><head><meta charset="utf-8"><title>USB-C Display Setup</title>
        <style>html,body{background:Canvas;margin:0;height:100%;font:14px system-ui,sans-serif;color:CanvasText}
        .bar{height:40px;app-region:drag}main{padding:8px 32px}pre{font-size:11px;white-space:pre-wrap;opacity:.7}
        button{app-region:no-drag;position:fixed;top:6px;right:8px}</style></head>
        <body><div class="bar"></div><button onclick="chrome.webview.postMessage({cmd:'close'})">Close</button>
        <main><h1>USB-C Display Setup</h1><p>This copy was built without its setup screens.</p><pre id="s"></pre></main>
        <script>chrome.webview.addEventListener('message',e=>{document.getElementById('s').textContent=JSON.stringify(e.data,null,2)});
        chrome.webview.postMessage({cmd:'ready'});chrome.webview.postMessage({cmd:'shown'});</script></body></html>
        """;

    void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!e.Source.StartsWith(Origin + "/", StringComparison.OrdinalIgnoreCase)) return;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var msg = doc.RootElement;
            if (msg.ValueKind == JsonValueKind.String)  // posted as a JSON string
            {
                using var inner = JsonDocument.Parse(msg.GetString());
                Dispatch(inner.RootElement);
            }
            else if (msg.ValueKind == JsonValueKind.Object) Dispatch(msg);
        }
        catch (Exception ex) { Log.Write("ui message: " + ex.Message); }
    }

    void Dispatch(JsonElement m)
    {
        string cmd = m.TryGetProperty("cmd", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : "";
        if (cmd is not ("startDrag" or "mirror" or "chrome" or "frame")) Log.Write("ui: " + cmd);
        switch (cmd)
        {
            case "ready": wizard.Changed(); Post(); SetActive(ActiveForm == this); break;
            case "shown": Reveal(); break;
            case "setUp":
            case "install": wizard.SetUp(); break;  // "install": the older name
            case "elevate": wizard.Elevate(); break;
            case "place":
                wizard.Place(Str(m, "axChoice"), Bool(m, "loginSkip"));
                break;
            case "frame":  // the page's current frame, for the hand-over hold (active: an older page doesn't say)
                wizard.SetFrame(Str(m, "screen"), Str(m, "sub"), Str(m, "status"), Str(m, "theme"), Str(m, "accent"),
                                Bool(m, "active") ?? ActiveForm == this);
                break;
            case "attention":  // Ready while this window isn't in front: flash its taskbar button until it is
                var fi = new Native.FLASHWINFO { cbSize = (uint)Marshal.SizeOf<Native.FLASHWINFO>(), hwnd = Handle, dwFlags = Native.FLASHW_TRAY | Native.FLASHW_TIMERNOFG };
                Native.FlashWindowEx(ref fi);
                break;
            case "macAction": wizard.MacAction(Str(m, "action")); break;
            case "saveSettings": wizard.SaveSettings(Int(m, "scale"), Bool(m, "matchColors"), Bool(m, "useLaptopInput")); break;
            case "startScreen": wizard.StartScreen(); break;
            case "stopScreen": wizard.StopScreen(); break;
            case "mirror": wizard.SetMirrorLocal(Str(m, "json") ?? ""); break;
            case "copy":
                string text = Str(m, "text");
                if (!string.IsNullOrEmpty(text)) try { Clipboard.SetText(text); } catch (Exception ex) { Log.Write("copy: " + ex.Message); }
                break;
            case "finish": wizard.Finish(); CloseNow(); break;
            case "close": UserClose(); break;
            case "minimize": WindowState = FormWindowState.Minimized; break;
            case "chrome":  // the page's Mac point (CSS px) and theme, for the shadow
                if (m.TryGetProperty("point", out var pt) && pt.ValueKind == JsonValueKind.Number && pt.GetDouble() > 0)
                {
                    string theme = Str(m, "theme");
                    shadow?.SetLook(pt.GetDouble() * DeviceDpi / 96.0, theme == null ? Machine.DarkMode() : theme == "dark");
                }
                break;
            case "startDrag":  // fallback for runtimes without app-region
                Native.ReleaseCapture();
                Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, (IntPtr)Native.HTCAPTION, IntPtr.Zero);
                break;
        }
    }

    static string Str(JsonElement m, string name) => m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    static int? Int(JsonElement m, string name) => m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out int i) ? i : null;
    static bool? Bool(JsonElement m, string name) => m.TryGetProperty(name, out var v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False) ? v.GetBoolean() : null;

    void Post()
    {
        var core = web.CoreWebView2;
        if (core == null) return;
        string json = wizard.TakeIfDirty();
        if (json == null) return;
        try { core.PostWebMessageAsJson(json); } catch { }
        wizard.StatePosted(json);
    }

    // The close light, Alt+F4: closes now (setup resumes later), except while installing or
    // handing over. The watcher keeps the cable working meanwhile.
    void UserClose()
    {
        if (!wizard.CanClose) { Log.Write("close: not now (installing or handing over)"); return; }
        if (Install.IsInstalled) Install.StartWatcher();
        CloseNow();
    }

    void CloseNow()
    {
        closingInternally = true;
        Close();
    }

    // Anything else asking the window to close (the taskbar's Close window): the same rules.
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!closingInternally && e.CloseReason == CloseReason.UserClosing)
        {
            if (!wizard.CanClose) { e.Cancel = true; Log.Write("close: not now (installing or handing over)"); }
            else if (Install.IsInstalled) Install.StartWatcher();
        }
        base.OnFormClosing(e);
    }

    // Where the page is on this PC's panel, in pixels, for the Mac's copy of this window. Only
    // on the PC's own panel (where the Mac desktop shows) and while the window is up.
    (Rectangle, int)? PanelPlace()
    {
        if (!IsHandleCreated || WindowState != FormWindowState.Normal) return null;
        var screen = Screen.FromHandle(Handle);
        if (!screen.Primary) return null;
        var r = RectangleToScreen(ClientRectangle);
        r.Offset(-screen.Bounds.X, -screen.Bounds.Y);
        return (r, DeviceDpi * 100 / 96);
    }

    // Before the display starts: this window in front, normal size, on this PC's own panel, and
    // clear of the menu bar the Mac draws at the top of its new display.
    void PrepareForHandover()
    {
        if (InvokeRequired) { Invoke(new Action(PrepareForHandover)); return; }
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
        var primary = Screen.PrimaryScreen;
        if (primary == null) return;
        double f = wizard.Scale / 100.0;
        var size = HandoverSize(Size, f, primary.Bounds, primary.WorkingArea);
        var want = new Rectangle(HandoverPlace(Location, size, Screen.FromHandle(Handle).Primary, primary.Bounds, primary.WorkingArea, f), size);
        if (want != Bounds)
        {
            Log.Write($"screen: window moved from {Bounds} to {want} for the handover");
            Bounds = want;
            if (Bounds != want) Bounds = want;  // moved across a DPI change: OnDpiChanged kept the size, not the place
        }
    }

    // The window's size for the handover: as it is, unless it was sized for another screen and
    // is too big for this PC's panel below the menu bar; then what FitWindow gives there.
    internal static Size HandoverSize(Size size, double f, Rectangle bounds, Rectangle wa)
    {
        var fit = FitWindow(f, wa, bounds, true);
        return size.Width > fit.Width || size.Height > fit.Height ? fit : size;
    }

    // Where the window goes for the handover: on the primary panel (centred in its work area if it
    // was elsewhere), its top below the Mac's menu bar, and its bottom on the panel where that
    // doesn't push the top under the menu bar (WindowSize leaves room for both).
    internal static Point HandoverPlace(Point loc, Size size, bool onPrimary, Rectangle bounds, Rectangle wa, double f)
    {
        if (!onPrimary) loc = new Point(wa.Left + (wa.Width - size.Width) / 2, wa.Top + (wa.Height - size.Height) / 2);
        int top = bounds.Top + MenuBar(f);
        if (loc.Y < top) loc.Y = top;
        int maxTop = Math.Min(wa.Bottom, bounds.Bottom) - size.Height;
        if (loc.Y > maxTop && maxTop >= top) loc.Y = maxTop;
        return loc;
    }

    // "Picture on screen": the display's window takes the keyboard. This window is still in front
    // (behind the display), so it may hand the foreground over.
    void OnPictureShown(IntPtr window, int pid)
    {
        BeginInvokeSafe(() =>
        {
            if (pid != 0) Native.AllowSetForegroundWindow(pid);
            bool ok = window != IntPtr.Zero && Native.SetForegroundWindow(window);
            Log.Write($"screen: the Mac desktop shows; the display {(ok ? "has" : "didn't get")} the keyboard");
        });
    }

    // A click in the Mac's copy of this window: this page acts on it, as if clicked here.
    void OnRemoteClick(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var m = doc.RootElement;
            string act = Str(m, "act");
            if (act == null) return;
            string data = m.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object ? d.GetRawText() : "{}";
            string msg = "{\"type\":\"remoteAct\",\"act\":" + JsonSerializer.Serialize(act) + ",\"data\":" + data + "}";
            BeginInvokeSafe(() => { try { web.CoreWebView2?.PostWebMessageAsJson(msg); } catch { } });
            Log.Write("ui: " + act + " (on the Mac)");
        }
        catch (Exception e) { Log.Write("remote click: " + e.Message); }
    }

    static void OpenExternal(string uri)
    {
        if (!uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return;
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true })?.Dispose(); } catch { }
    }

    void BringForward()
    {
        if (!revealed) return;
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    // The display ended (Return to Windows, Ctrl-Alt-Esc, an error): this window is in front
    // again, with its real active state.
    void BackFromScreen()
    {
        BringForward();
        SetActive(ActiveForm == this);
    }

    public void ShowFromOtherInstance() => BeginInvokeSafe(BringForward);

    // The install put a copy in %LOCALAPPDATA%\Programs: carry on from there, so the firewall rule
    // (which names that copy) applies. The new window opens cloaked in the same place, underneath
    // this one, paints the same frame (--hold), and this one closes once it has.
    void HandOff(string frame)
    {
        Log.Write("handoff: continuing from " + Install.SetupPath);
        wizard.Shutdown();
        Program.ReleaseInstance();
        var ready = new EventWaitHandle(false, EventResetMode.ManualReset, Program.ResumedEventName);
        int pid;
        try
        {
            using var p = Process.Start(new ProcessStartInfo(Install.SetupPath,
                    $"--resume --at {Left},{Top} --behind {Handle.ToInt64()} --hold \"{frame}\"")
                { UseShellExecute = false, WorkingDirectory = Install.Dir });
            if (p == null) throw new InvalidOperationException("the installed copy didn't start");
            pid = p.Id;
            Native.AllowSetForegroundWindow(pid);  // it may come forward by itself too (BringForward)
        }
        catch (Exception e)
        {
            Log.Write("handoff: " + e.Message);
            ready.Dispose();
            Program.ReclaimInstance();
            wizard.HandOffFailed();
            return;
        }
        Task.Run(() =>
        {
            ready.WaitOne(20000);
            ready.Dispose();
            BeginInvokeSafe(() =>
            {
                // In front (as after Windows' prompt), this window first hands that over to the
                // installed copy's window, which comes up over it with the same frame: hiding this
                // one then activates nothing else. Otherwise Windows activates the app that was in
                // front before setup, which comes up over both windows and stays there. Two
                // frames let that window finish its activation, so its shadow follows this one's
                // at once.
                if (Native.GetForegroundWindow() == Handle)
                {
                    IntPtr next = Native.TopWindowOf(pid, Text);
                    bool ok = next != IntPtr.Zero && Native.SetForegroundWindow(next);
                    Log.Write(ok ? "handoff: the installed copy's window is in front" : "handoff: couldn't put the installed copy's window in front");
                    if (ok) { Native.DwmFlush(); Native.DwmFlush(); }
                }
                // The window and its shadow leave in one step (the installed copy's, the same frame
                // in the same place, are right there).
                shadow?.Dispose();
                shadow = null;
                Hide();
                CloseNow();
            });
        });
    }

    void BeginInvokeSafe(Action a)
    {
        try { if (IsHandleCreated && !IsDisposed) BeginInvoke(a); } catch { }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        SystemEvents.UserPreferenceChanged -= OnThemeChanged;
        poster.Stop();
        failsafe.Stop();
        Native.SetThreadExecutionState(Native.ES_CONTINUOUS);
        shadow?.Dispose();
        shadow = null;
        wizard.Shutdown();
        base.OnFormClosed(e);
    }
}

static class Native
{
    public const int WM_NCCALCSIZE = 0x0083, WM_NCLBUTTONDOWN = 0x00A1, WM_WINDOWPOSCHANGED = 0x0047, HTCAPTION = 2;
    public const uint EVENT_OBJECT_DESTROY = 0x8001, EVENT_OBJECT_SHOW = 0x8002, EVENT_OBJECT_HIDE = 0x8003, WINEVENT_OUTOFCONTEXT = 0;
    public const int WS_SYSMENU = 0x00080000, WS_MINIMIZEBOX = 0x00020000, WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
    public const int DWMWA_NCRENDERING_POLICY = 2, DWMWA_CLOAK = 13, DWMWA_USE_IMMERSIVE_DARK_MODE = 20, DWMWA_WINDOW_CORNER_PREFERENCE = 33,
                     DWMWA_BORDER_COLOR = 34;
    public const int DWMNCRP_DISABLED = 1, DWMWCP_DONOTROUND = 1;
    public const int DWMWA_COLOR_NONE = unchecked((int)0xFFFFFFFE);
    public const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20;
    public const uint ES_CONTINUOUS = 0x80000000, ES_SYSTEM_REQUIRED = 0x1, ES_DISPLAY_REQUIRED = 0x2;
    public const uint FLASHW_TRAY = 0x2, FLASHW_TIMERNOFG = 0xC;

    [StructLayout(LayoutKind.Sequential)]
    public struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags, uCount, dwTimeout; }

    public delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
    [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc proc, uint pid, uint tid, uint flags);
    [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("dwmapi.dll")] public static extern int DwmFlush();

    // A process's visible (and not cloaked), unowned top-level window with this title (not a tool
    // window, so not its shadow); Zero if it has none.
    public static IntPtr TopWindowOf(int pid, string title)
    {
        IntPtr found = IntPtr.Zero;
        var text = new StringBuilder(256);
        EnumWindows((h, _) =>
        {
            GetWindowThreadProcessId(h, out uint p);
            if (p != (uint)pid || !IsWindowVisible(h) || GetWindow(h, GW_OWNER) != IntPtr.Zero
                || (GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
            if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out int cloaked, 4) == 0 && cloaked != 0) return true;
            text.Clear();
            GetWindowText(h, text, text.Capacity);
            if (text.ToString() != title) return true;
            found = h;
            return false;
        }, IntPtr.Zero);
        return found;
    }
    const uint GW_OWNER = 4;
    const int GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80, DWMWA_CLOAKED = 14;
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);

    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int processId);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO info);
    [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
}
