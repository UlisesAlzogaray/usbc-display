// USB-C Display Setup (Windows). The one download: installs USB-C Display for this account,
// makes the one admin change it needs, serves the Mac app to the Mac over the cable, and walks
// through every step on both machines (windows/setup/README.md, CONTRACT.md).
//
// usage: "USB-C Display Setup.exe" [--uninstall]
//   --resume --at X,Y      the installed copy taking over from the downloaded one (internal)
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
            var answer = MessageBox.Show(
                "USB-C Display Setup needs Microsoft Edge WebView2 to show its screens. It comes with Windows 11, " +
                "but it's missing on this laptop.\n\n" +
                "Click OK to download it from Microsoft. Open the file, let it install, then open this setup again.",
                "USB-C Display Setup", MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
            if (answer == DialogResult.OK)
                try { Process.Start(new ProcessStartInfo("https://go.microsoft.com/fwlink/p/?LinkId=2124703") { UseShellExecute = true }); } catch { }
            return 1;
        }

        // No white flash while the page loads: the window's backdrop shows until it paints.
        Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0");

        bool resumed = false;
        Point? at = null;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--resume") resumed = true;
            else if (args[i] == "--at" && i + 1 < args.Length)
            {
                var p = args[++i].Split(',');
                if (p.Length == 2 && int.TryParse(p[0], out int x) && int.TryParse(p[1], out int y)) at = new Point(x, y);
            }
        }

        Log.Write($"setup: start {Environment.ProcessPath} {string.Join(' ', args)}");
        var wizard = new Wizard();
        var window = new SetupWindow(wizard, at, resumed);
        new Thread(() => { while (show.WaitOne()) window.ShowFromOtherInstance(); }) { IsBackground = true, Name = "Show" }.Start();
        Application.Run(window);
        return 0;
    }

    // The handoff to the installed copy: it becomes the one instance.
    public static void ReleaseInstance()
    {
        if (instance == null) return;
        try { instance.ReleaseMutex(); } catch { }
        instance.Dispose();
        instance = null;
    }
}
