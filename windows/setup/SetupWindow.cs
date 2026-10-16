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

// The setup window: no title bar of its own, Mica behind a transparent WebView2 that shows the
// wizard (ui/**, from this exe's resources). The page draws its own caption: elements with CSS
// `app-region: drag` move the window, and it posts "minimize" / "close".
sealed class SetupWindow : Form
{
    const string Origin = "https://setup.usbc-display.example";
    const int LogicalWidth = 960, LogicalHeight = 680;

    readonly Wizard wizard;
    readonly bool resumed;
    readonly WebView2 web;
    readonly System.Windows.Forms.Timer poster = new() { Interval = 100 };  // state at most 10 times a second
    CoreWebView2Environment env;
    bool mica;
    bool appRegion;  // the runtime supports CSS app-region (WebView2 1.0.2420 and later)

    public SetupWindow(Wizard wizard, Point? at, bool resumed)
    {
        this.wizard = wizard;
        this.resumed = resumed;
        SuspendLayout();
        AutoScaleMode = AutoScaleMode.None;  // sized by hand below, per monitor
        Text = "USB-C Display Setup";
        FormBorderStyle = FormBorderStyle.FixedSingle;  // keeps the caption styles: snap, shadow, minimize animation
        MaximizeBox = false;
        MinimizeBox = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.Black;  // black is where the Mica backdrop shows through
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath); } catch { }
        Place(at);

        web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent };
        Controls.Add(web);
        ResumeLayout(false);

        poster.Tick += (_, _) => Post();
        wizard.InstalledElsewhere += () => BeginInvokeSafe(HandOff);
        wizard.ScreenClosed += () => BeginInvokeSafe(BringForward);
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
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyFrame();
        Native.SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, Native.SWP_FRAMECHANGED | Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
    }

    // Mica (Windows 11 22H2 and later), dark title colours with the system, rounded corners.
    void ApplyFrame()
    {
        int dark = Machine.DarkMode() ? 1 : 0;
        Native.DwmSetWindowAttribute(Handle, Native.DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, 4);
        int round = Native.DWMWCP_ROUND;
        Native.DwmSetWindowAttribute(Handle, Native.DWMWA_WINDOW_CORNER_PREFERENCE, ref round, 4);
        mica = false;
        if (Machine.MicaSupported)
        {
            int backdrop = Native.DWMSBT_MAINWINDOW;
            mica = Native.DwmSetWindowAttribute(Handle, Native.DWMWA_SYSTEMBACKDROP_TYPE, ref backdrop, 4) == 0;
            var margins = new Native.Margins { Left = -1, Right = -1, Top = -1, Bottom = -1 };
            if (mica) mica = Native.DwmExtendFrameIntoClientArea(Handle, ref margins) == 0;
        }
        // Without Mica the page paints its own solid background; this only shows while it loads.
        BackColor = mica ? Color.Black : dark == 1 ? Color.FromArgb(32, 32, 32) : Color.FromArgb(243, 243, 243);
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "USB-C Display", "WebView2");
            env = await CoreWebView2Environment.CreateAsync(null, data, new CoreWebView2EnvironmentOptions());
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
        core.NavigationCompleted += (_, a) =>
        {
            web.Focus();
            if (!resumed) return;
            // Tell the copy that started this one that it can close now.
            try { using var ev = EventWaitHandle.OpenExisting(Program.ResumedEventName); ev.Set(); } catch { }
        };
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
    // and window.usbcHost = { mica, dark, windowsBuild, appRegion }. Without app-region support in
    // the runtime, a press on an `app-region: drag` element posts startDrag instead.
    string HostScript()
    {
        bool dark = Machine.DarkMode();
        var vars = JsonSerializer.Serialize(Machine.AccentColors(dark));
        string host = JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["mica"] = mica, ["dark"] = dark, ["windowsBuild"] = Machine.WindowsBuild, ["appRegion"] = appRegion,
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
        if (cmd != "startDrag") Log.Write("ui: " + cmd);
        switch (cmd)
        {
            case "ready": wizard.Changed(); Post(); break;
            case "install": wizard.InstallNow(); break;
            case "elevate": wizard.Elevate(); break;
            case "macAction": wizard.MacAction(Str(m, "action")); break;
            case "saveSettings": wizard.SaveSettings(Int(m, "scale"), Bool(m, "matchColors"), Bool(m, "useLaptopInput")); break;
            case "startScreen": wizard.StartScreen(); break;
            case "copy":
                string text = Str(m, "text");
                if (!string.IsNullOrEmpty(text)) try { Clipboard.SetText(text); } catch (Exception ex) { Log.Write("copy: " + ex.Message); }
                break;
            case "finish": wizard.Finish(); Close(); break;
            case "close": Close(); break;
            case "minimize": WindowState = FormWindowState.Minimized; break;
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
        if (json != null) try { core.PostWebMessageAsJson(json); } catch { }
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

    // The install just put a copy in %LOCALAPPDATA%\Programs: carry on from there, so the firewall
    // rule (which names that copy) applies. The new window opens in the same place; this one
    // closes once it shows.
    void HandOff()
    {
        Log.Write("handoff: continuing from " + Install.SetupPath);
        wizard.Shutdown();
        Program.ReleaseInstance();
        var ready = new EventWaitHandle(false, EventResetMode.ManualReset, Program.ResumedEventName);
        try
        {
            Process.Start(new ProcessStartInfo(Install.SetupPath, $"--resume --at {Left},{Top}")
                { UseShellExecute = false, WorkingDirectory = Install.Dir })?.Dispose();
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
        wizard.Shutdown();
        base.OnFormClosed(e);
    }
}

static class Native
{
    public const int WM_NCCALCSIZE = 0x0083, WM_NCLBUTTONDOWN = 0x00A1, HTCAPTION = 2;
    public const int WS_SYSMENU = 0x00080000, WS_MINIMIZEBOX = 0x00020000;
    public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20, DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWA_SYSTEMBACKDROP_TYPE = 38;
    public const int DWMWCP_ROUND = 2, DWMSBT_MAINWINDOW = 2;
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
