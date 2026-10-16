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
// from this exe's resources). The page draws a Mac window on it, as the Mac's copy of this window
// will look after the handover: macOS's corners, edge, title bar and traffic lights. Outside its
// corners the desktop shows (no redirection surface: the WebView's alpha reaches the desktop), and
// MacShadow draws a Mac shadow under it. Elements with CSS `app-region: drag` move the window; the
// page posts "minimize" / "close".
sealed class SetupWindow : Form
{
    const string Origin = "https://setup.usbc-display.example";
    const int LogicalWidth = 960, LogicalHeight = 680;

    readonly Wizard wizard;
    readonly bool resumed;
    readonly IntPtr behind;  // the downloaded copy's window, which this one takes over from
    readonly WebView2 web;
    readonly System.Windows.Forms.Timer poster = new() { Interval = 100 };  // state at most 10 times a second
    CoreWebView2Environment env;
    bool mica;
    bool appRegion;
    MacShadow shadow;  // the runtime supports CSS app-region (WebView2 1.0.2420 and later)

    public SetupWindow(Wizard wizard, Point? at, bool resumed, IntPtr behind)
    {
        this.wizard = wizard;
        this.resumed = resumed;
        this.behind = behind;
        SuspendLayout();
        AutoScaleMode = AutoScaleMode.None;  // sized by hand below, per monitor
        Text = "USB-C Display Setup";
        FormBorderStyle = FormBorderStyle.FixedSingle;  // keeps the caption styles: snap, shadow, minimize animation
        MaximizeBox = false;
        MinimizeBox = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.Black;  // never seen: there's no redirection surface
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath); } catch { }
        Place(at);

        web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent };
        Controls.Add(web);
        ResumeLayout(false);

        poster.Tick += (_, _) => Post();
        wizard.InstalledElsewhere += () => BeginInvokeSafe(HandOff);
        wizard.ScreenClosed += () => BeginInvokeSafe(BringForward);
        wizard.WindowPlace = PanelPlace;
        wizard.RemoteClick += OnRemoteClick;
        SystemEvents.UserPreferenceChanged += OnThemeChanged;
    }

    // 960 x 680 at 100 %, centred on the screen with the pointer (or at the old window's spot).
    void Place(Point? at)
    {
        var screen = at.HasValue ? Screen.FromPoint(at.Value) : Screen.FromPoint(Cursor.Position);
        var wa = screen.WorkingArea;
        int dpi = Native.DpiOf(screen);
        var size = new Size(LogicalWidth * dpi / 96, LogicalHeight * dpi / 96);
        size = new Size(Math.Min(size.Width, wa.Width), Math.Min(size.Height, wa.Height));
        var loc = at ?? new Point(wa.Left + (wa.Width - size.Width) / 2, wa.Top + (wa.Height - size.Height) / 2);
        Bounds = new Rectangle(loc, size);
    }

    // Taking over from the downloaded copy: open in its exact spot but underneath it, and come
    // forward only when the page shows the right step ("shown"). The swap then looks like nothing.
    protected override bool ShowWithoutActivation => behind != IntPtr.Zero;

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (behind != IntPtr.Zero)
            Native.SetWindowPos(Handle, behind, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        Bounds = e.SuggestedRectangle;
    }

    // No system menu: with the frame extended over the whole window, DWM would otherwise draw its
    // own (dead) minimize and close buttons over the page's. The caption and minimize-box styles
    // stay, for snap, the shadow and the minimize animation.
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

    // Alt+F4 still closes the window (it came through the system menu). The WebView2 control
    // passes keys the page doesn't use on to the form, so this also works with the focus in the page.
    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == (Keys.Alt | Keys.F4)) { Close(); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    protected override void WndProc(ref Message m)
    {
        // The whole window is client area: the page draws the title bar.
        if (m.Msg == Native.WM_NCCALCSIZE && m.WParam != IntPtr.Zero) { m.Result = IntPtr.Zero; return; }
        base.WndProc(ref m);
        if (m.Msg == Native.WM_WINDOWPOSCHANGED) shadow?.Follow();  // moved, sized, shown, hidden or restacked
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyFrame();
        shadow ??= new MacShadow(this);
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
        mica = false;
    }

    // The page greys its traffic lights and title when the window isn't in front, as macOS does.
    protected override void OnActivated(EventArgs e) { base.OnActivated(e); SetActive(true); }
    protected override void OnDeactivate(EventArgs e) { base.OnDeactivate(e); SetActive(false); }
    void SetActive(bool on)
    {
        shadow?.SetActive(on);
        try { web?.CoreWebView2?.PostWebMessageAsJson(on ? "{\"type\":\"active\",\"on\":true}" : "{\"type\":\"active\",\"on\":false}"); } catch { }
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "USB-C Display", "WebView2");
            // Keeps painting while covered: the installed copy draws its first screen behind the
            // downloaded copy's window, so the swap shows no reload.
            env = await CoreWebView2Environment.CreateAsync(null, data, new CoreWebView2EnvironmentOptions
                { AdditionalBrowserArguments = "--disable-features=CalculateNativeWinOcclusion" });
            await web.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex)
        {
            Log.Write("webview: " + ex);
            MessageBox.Show(this, "USB-C Display Setup couldn't show its window.\n\n" + ex.Message, "USB-C Display Setup",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        try { await SetUpPage(); }
        catch (Exception ex)
        {
            Log.Write("webview: " + ex);
            MessageBox.Show(this, "USB-C Display Setup couldn't show its window.\n\n" + ex.Message, "USB-C Display Setup",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
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

    // Tells the page about the window: 'no-mica' on <html> when it must paint its own background,
    // the accent colours as CSS variables (--accent, --accent-system, --accent-light-1..3,
    // --accent-dark-1..3),
    // and window.usbcHost = { mica, dark, windowsBuild, appRegion, resumed }. Without app-region support in
    // the runtime, a press on an `app-region: drag` element posts startDrag instead.
    string HostScript()
    {
        bool dark = Machine.DarkMode();
        var vars = JsonSerializer.Serialize(Machine.AccentColors(dark));
        string host = JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["mica"] = mica, ["dark"] = dark, ["windowsBuild"] = Machine.WindowsBuild, ["appRegion"] = appRegion,
            ["resumed"] = resumed,  // the installed copy carrying on right after Install
        });
        return $$"""
            (() => {
              const vars = {{vars}};
              window.usbcHost = {{host}};
              const apply = () => {
                const d = document.documentElement;
                if (!d) return false;
                d.classList.toggle('no-mica', !window.usbcHost.mica);
                for (const k in vars) d.style.setProperty(k, vars[k]);
                return true;
              };
              if (!apply()) new MutationObserver((_, o) => { if (apply()) o.disconnect(); }).observe(document, { childList: true });
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
        <style>html,body{background:transparent;margin:0;height:100%;font:14px "Segoe UI Variable Text","Segoe UI",sans-serif;color:CanvasText}
        .bar{height:40px;app-region:drag}main{padding:8px 32px}pre{font-size:11px;white-space:pre-wrap;opacity:.7}
        button{app-region:no-drag;position:fixed;top:6px;right:8px}</style></head>
        <body><div class="bar"></div><button onclick="chrome.webview.postMessage({cmd:'close'})">Close</button>
        <main><h1>USB-C Display Setup</h1><p>This copy was built without its setup screens.</p><pre id="s"></pre></main>
        <script>chrome.webview.addEventListener('message',e=>{document.getElementById('s').textContent=JSON.stringify(e.data,null,2)});
        chrome.webview.postMessage({cmd:'ready'});</script></body></html>
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
        if (cmd != "startDrag" && cmd != "mirror" && cmd != "chrome") Log.Write("ui: " + cmd);
        switch (cmd)
        {
            case "ready": wizard.Changed(); Post(); SetActive(ActiveForm == this); break;
            case "shown": PageShown(); break;
            case "install": wizard.InstallNow(); break;
            case "elevate": wizard.Elevate(); break;
            case "macAction": wizard.MacAction(Str(m, "action")); break;
            case "saveSettings": wizard.SaveSettings(Int(m, "scale"), Bool(m, "matchColors"), Bool(m, "useLaptopInput")); break;
            case "startScreen": wizard.StartScreen(); break;
            case "stopScreen": wizard.StopScreen(); break;
            case "mirror": wizard.SetMirrorLocal(Str(m, "json") ?? ""); break;
            case "copy":
                string text = Str(m, "text");
                if (!string.IsNullOrEmpty(text)) try { Clipboard.SetText(text); } catch (Exception ex) { Log.Write("copy: " + ex.Message); }
                break;
            case "finish": wizard.Finish(); Close(); break;
            case "close": Close(); break;
            case "minimize": WindowState = FormWindowState.Minimized; break;
            case "chrome":  // the page's Mac point (CSS px), for the shadow
                if (m.TryGetProperty("point", out var pt) && pt.ValueKind == JsonValueKind.Number) shadow?.SetPoint(pt.GetDouble(), DeviceDpi);
                break;
            case "startDrag":  // fallback for pages that don't use app-region
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

    // Where the page is on the laptop's panel, in pixels, for the Mac's copy of this window. Only
    // on the laptop's own panel (where the picture shows) and while the window is up.
    (Rectangle, int)? PanelPlace()
    {
        if (!IsHandleCreated || WindowState != FormWindowState.Normal) return null;
        var screen = Screen.FromHandle(Handle);
        if (!screen.Primary) return null;
        var r = RectangleToScreen(ClientRectangle);
        r.Offset(-screen.Bounds.X, -screen.Bounds.Y);
        return (r, DeviceDpi * 100 / 96);
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
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    public void ShowFromOtherInstance() => BeginInvokeSafe(BringForward);

    // The page shows its first real step. Taking over from the downloaded copy, that copy can
    // close now: this window, right underneath it, comes forward.
    bool shownOnce;
    void PageShown()
    {
        if (shownOnce || !resumed) return;
        shownOnce = true;
        try { using var ev = EventWaitHandle.OpenExisting(Program.ResumedEventName); ev.Set(); } catch { }
        if (behind != IntPtr.Zero)
            Task.Run(async () => { await Task.Delay(150); BeginInvokeSafe(BringForward); });  // once the old window has gone
    }

    // The install just put a copy in %LOCALAPPDATA%\Programs: carry on from there, so the firewall
    // rule (which names that copy) applies. The new window opens in the same place, underneath
    // this one, and this one closes once the new one shows the same step.
    void HandOff()
    {
        Log.Write("handoff: continuing from " + Install.SetupPath);
        wizard.Shutdown();
        Program.ReleaseInstance();
        var ready = new EventWaitHandle(false, EventResetMode.ManualReset, Program.ResumedEventName);
        try
        {
            using var p = Process.Start(new ProcessStartInfo(Install.SetupPath, $"--resume --at {Left},{Top} --behind {Handle.ToInt64()}")
                { UseShellExecute = false, WorkingDirectory = Install.Dir });
            if (p != null) Native.AllowSetForegroundWindow(p.Id);  // it comes forward when this one closes
        }
        catch (Exception e)
        {
            Log.Write("handoff: " + e.Message);
            ready.Dispose();
            wizard.Resume();
            return;
        }
        Task.Run(() =>
        {
            ready.WaitOne(20000);
            ready.Dispose();
            BeginInvokeSafe(Close);
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
        shadow?.Dispose();
        shadow = null;
        wizard.Shutdown();
        base.OnFormClosed(e);
    }
}

static class Native
{
    public const int WM_NCCALCSIZE = 0x0083, WM_NCLBUTTONDOWN = 0x00A1, WM_WINDOWPOSCHANGED = 0x0047, HTCAPTION = 2;
    public const int WS_SYSMENU = 0x00080000, WS_MINIMIZEBOX = 0x00020000, WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
    public const int DWMWA_NCRENDERING_POLICY = 2, DWMWA_USE_IMMERSIVE_DARK_MODE = 20, DWMWA_WINDOW_CORNER_PREFERENCE = 33,
                     DWMWA_BORDER_COLOR = 34, DWMWA_SYSTEMBACKDROP_TYPE = 38;
    public const int DWMNCRP_DISABLED = 1, DWMWCP_DONOTROUND = 1, DWMWCP_ROUND = 2, DWMSBT_MAINWINDOW = 2;
    public const int DWMWA_COLOR_NONE = unchecked((int)0xFFFFFFFE);
    public const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20;

    [StructLayout(LayoutKind.Sequential)] public struct Margins { public int Left, Right, Top, Bottom; }

    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    [DllImport("dwmapi.dll")] public static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref Margins margins);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int processId);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point pt, int flags);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);

    public static int DpiOf(Screen screen)
    {
        try
        {
            var b = screen.Bounds;
            IntPtr m = MonitorFromPoint(new Point(b.Left + b.Width / 2, b.Top + b.Height / 2), 2 /*MONITOR_DEFAULTTONEAREST*/);
            if (GetDpiForMonitor(m, 0, out uint x, out _) == 0 && x >= 96) return (int)x;
        }
        catch { }
        return 96;
    }
}
