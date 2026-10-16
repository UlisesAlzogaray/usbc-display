// USB-C Display Setup (Windows). The one download: installs USB-C Display for this account,
// makes the one admin change it needs, serves the Mac app to the Mac over the cable, and walks
// through every step on both computers (windows/setup/README.md, CONTRACT.md).
//
// usage: "USB-C Display Setup.exe" [--uninstall]
//   --resume --at X,Y --behind HWND --hold "screen|sub|status|theme|accent|active"
//                          the installed copy taking over from the downloaded one, holding its
//                          last frame until it has looked at everything itself (internal)
//   --elevated <SID>       the admin step, run through UAC by the app itself (internal)
//   --elevated-remove      undoes the admin step when uninstalling (internal)

using System;
using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace UsbcSetup;

static class Program
{
    public const string ResumedEventName = @"Local\UsbcDisplaySetupResumed";
    // The watcher checks this mutex too: while setup is open, it leaves the cable to setup.
    const string InstanceName = @"Local\UsbcDisplaySetup", ShowEventName = @"Local\UsbcDisplaySetupShow";
    static Mutex instance;

    [STAThread]
    static int Main(string[] args)
    {
        string first = args.Length > 0 ? args[0] : "";
        if (first == "--elevated") return Elevation.ElevatedSetup(args.Length > 1 ? args[1] : null);
        if (first == "--elevated-remove") return Elevation.ElevatedRemove();

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (first == "--uninstall") return Install.Uninstall();

        // One window at a time: a second start (the watcher on a plug-in, the Start menu) brings
        // the open one forward instead.
        instance = new Mutex(true, InstanceName, out bool firstInstance);
        var show = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        if (!firstInstance)
        {
            Native.AllowSetForegroundWindow(-1 /*ASFW_ANY*/);
            show.Set();
            return 0;
        }

        try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch (WebView2RuntimeNotFoundException)
        {
            // The app's own buttons, in its language (Windows' standard Cancel follows the Windows
            // language); Esc and the close box still cancel.
            var download = new TaskDialogButton("Download…");
            var cancel = new TaskDialogButton("Cancel");
            var page = new TaskDialogPage
            {
                AllowCancel = true,
                Caption = "USB-C Display Setup",
                Heading = "USB-C Display Setup needs Microsoft Edge WebView2, which isn’t on this PC.",
                Text = "Download and install it from Microsoft, then open USB-C Display Setup again.",
                Buttons = { download, cancel },
                DefaultButton = cancel,
            };
            using var icon = AppIcon();
            if (icon != null) page.Icon = new TaskDialogIcon(icon);
            if (TaskDialog.ShowDialog(page, TaskDialogStartupLocation.CenterScreen) == download)
                try { Process.Start(new ProcessStartInfo("https://go.microsoft.com/fwlink/p/?LinkId=2124703") { UseShellExecute = true }); } catch { }
            return 1;
        }

        // No white flash while the page loads: the window's backdrop shows until it paints.
        Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0");

        bool resumed = false;
        Point? at = null;
        IntPtr behind = IntPtr.Zero;
        HoldState hold = null;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--resume") resumed = true;
            else if (args[i] == "--at" && i + 1 < args.Length)
            {
                var p = args[++i].Split(',');
                if (p.Length == 2 && int.TryParse(p[0], out int x) && int.TryParse(p[1], out int y)) at = new Point(x, y);
            }
            else if (args[i] == "--behind" && i + 1 < args.Length && long.TryParse(args[++i], out long h)) behind = new IntPtr(h);
            else if (args[i] == "--hold" && i + 1 < args.Length) hold = HoldState.Parse(args[++i]);
        }

        Log.Write($"setup: start {Environment.ProcessPath} {string.Join(' ', args)}");
        var wizard = new Wizard(hold);
        var window = new SetupWindow(wizard, at, resumed, behind);
        new Thread(() => { while (show.WaitOne()) window.ShowFromOtherInstance(); }) { IsBackground = true, Name = "Show" }.Start();
        Application.Run(window);
        return 0;
    }

    // The app's own icon for its dialogs (as a Mac alert shows the app's icon), at the size a
    // task dialog draws it on the primary screen; null if it can't be read.
    public static Icon AppIcon()
    {
        try
        {
            int size = (int)Math.Round(32 * Native.GetDpiForSystem() / 96.0);
            return Icon.ExtractIcon(Environment.ProcessPath, 0, size);
        }
        catch { return null; }
    }

    // The handoff to the installed copy: it becomes the one instance.
    public static void ReleaseInstance()
    {
        if (instance == null) return;
        try { instance.ReleaseMutex(); } catch { }
        instance.Dispose();
        instance = null;
    }

    // The handoff didn't start: this copy stays the one instance.
    public static void ReclaimInstance()
    {
        if (instance != null) return;
        try { instance = new Mutex(true, InstanceName, out _); } catch { }
    }
}
