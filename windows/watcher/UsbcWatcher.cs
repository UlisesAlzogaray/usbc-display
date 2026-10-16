// USB-C Display watcher (Windows). Starts at login and sits in the tray.
//
// Once setup has finished (SetupDone), connecting the cable to your Mac extends the Mac desktop
// onto this PC at once, with the saved size, colours and input, and no popup (UsbcDisplay.exe,
// which exits by itself when the cable comes out). If the Mac hasn't answered within 15 s (a
// second Mac, a Mac without the app, or one that refuses because Screen Recording is off), it
// opens USB-C Display Setup instead, which knows what to show. Before SetupDone, connecting the
// cable opens setup. While setup is open (its mutex exists), a plug is left to setup.
//
// Tray menu: Show Mac Desktop (Stop Showing Mac Desktop while the display runs), Display
// Options... (size, colours, keyboard and trackpad), Quit.
//
// Built with the .NET Framework compiler that ships with Windows (build-watcher.cmd), or by
// tools/build-windows.sh, so it starts at login with no runtime setup. C# 5, because that's what
// that compiler takes; non-ASCII characters are written as \u escapes for the same reason.
//
// usage: UsbcWatcher [--install | --uninstall]   (start at login, via HKCU\...\Run)
//        UsbcWatcher --started-by-setup           (a cable that's already in isn't a new plug)

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Watcher
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunName = "USB-C Display";
    const string SettingsKey = @"Software\USB-C Display";  // shared with the setup (windows/setup/Machine.cs Settings)
    const string SetupMutex = @"Local\UsbcDisplaySetup";   // the setup's single-instance mutex (windows/setup/Program.cs)
    const string SetupShowEvent = @"Local\UsbcDisplaySetupShow";  // and its "come forward" event (same file)
    const string ReceiverClass = "UsbcDisplayWindow";      // the receiver's window class (windows/Program.cs CreateWindow)
    const string SetupExe = "USB-C Display Setup.exe", ReceiverExe = "UsbcDisplay.exe";
    const int ExitRefused = 3;                              // the receiver: the Mac can't record its screen
    static readonly TimeSpan ConnectLimit = TimeSpan.FromSeconds(15);
    static readonly string AppDir = AppDomain.CurrentDomain.BaseDirectory;
    static readonly string LogDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UsbcDisplay");

    // Copy (windows/setup/ui/strings.js voice: "this PC", "your Mac").
    const string Title = "USB-C Display";
    const string ShowLabel = "Show Mac Desktop", StopLabel = "Stop Showing Mac Desktop";
    const string OptionsLabel = "Display Options\u2026", QuitLabel = "Quit";
    const string KeyboardNote = "To use this PC\u2019s keyboard and trackpad with your Mac, turn on USB-C Display in " +
                                "System Settings > Privacy & Security > Device Control and Data Access on your Mac.";
    const string KeepsStoppingNote = "The cable connection keeps stopping. Disconnect the cable, then connect it again.";
    const string RestartingNote = "The cable connection stopped responding. USB-C Display is restarting it, which takes about half a minute.";
    const string MissingFilesNote = "Some USB-C Display files are missing on this PC. Download USB-C Display Setup again, then open it.";

    static NotifyIcon tray;
    static ToolStripMenuItem showItem;
    static ChoiceForm options;
    static StreamWriter log;
    static bool linkUp;
    static int downChecks;

    // The display this watcher started (one the setup started is the setup's to watch).
    static Process receiver;
    static DateTime receiverStarted;
    static bool stopRequested, inputAsked, inputNoted;
    static volatile bool connected, inputRefused;  // from its output, on a thread-pool thread
    // Stop Showing Mac Desktop: closes politely, then ends what's left after 3 s.
    static DateTime killAt = DateTime.MinValue;
    // Display Options' Show Mac Desktop while a display runs: start again once it has stopped.
    static bool restartPending;
    static DateTime restartUntil;
    static System.Windows.Forms.Timer quick;

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
    const uint WM_CLOSE = 0x0010;

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--install")
        {
            using (var k = Registry.CurrentUser.CreateSubKey(RunKey)) k.SetValue(RunName, "\"" + Application.ExecutablePath + "\"");
            return 0;
        }
        if (args.Length > 0 && args[0] == "--uninstall")
        {
            using (var k = Registry.CurrentUser.CreateSubKey(RunKey)) k.DeleteValue(RunName, false);
            return 0;
        }

        bool first;
        using (var mutex = new Mutex(true, @"Local\UsbcDisplayWatcher", out first))
        {
            if (!first) return 0;  // already running
            SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var menu = new ContextMenuStrip();
            showItem = new ToolStripMenuItem(ShowLabel, null, delegate { ShowOrStop(); });
            menu.Items.Add(showItem);
            menu.Items.Add(new ToolStripMenuItem(OptionsLabel, null, delegate { ShowOptions(); }));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem(QuitLabel, null, delegate { Application.Exit(); }));
            menu.Opening += delegate { UpdateMenu(); };
            tray = new NotifyIcon { Icon = MakeIcon(), Text = Title, ContextMenuStrip = menu, Visible = true };
            tray.MouseUp += delegate(object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) OpenTrayMenu(); };

            bool bySetup = args.Length > 0 && args[0] == "--started-by-setup";
            if (bySetup) linkUp = CableUp();
            Note("watcher: start" + (bySetup ? " (by setup)" : "") + ", cable " + (CableUp() ? "connected" : "not connected"));

            quick = new System.Windows.Forms.Timer { Interval = 200 };
            quick.Tick += delegate { CheckRestart(); };
            var timer = new System.Windows.Forms.Timer { Interval = 1000 };
            timer.Tick += delegate { Check(); };
            timer.Start();
            Check();  // the cable may already be in at login
            Application.Run();
            tray.Visible = false;
            Note("watcher: quit");
        }
        return 0;
    }

    static bool CableUp()
    {
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            string d = ni.Description;
            if (ni.OperationalStatus == OperationalStatus.Up &&
                (d.Contains("USB4") || d.Contains("Thunderbolt") || d.Contains("P2P Network"))) return true;
        }
        return false;
    }

    // Ours, or one the setup app started.
    static bool ReceiverRunning
    {
        get
        {
            if (receiver != null)
            {
                try { if (!receiver.HasExited) return true; } catch { }
            }
            var others = Process.GetProcessesByName("UsbcDisplay");
            foreach (var p in others) p.Dispose();
            return others.Length > 0;
        }
    }

    // Setup is open (the downloaded copy or the installed one): it is in charge of the cable.
    // Its mutex, or its "show" event, which every setup process keeps for its whole life: the
    // downloaded copy releases the mutex a moment before the installed copy it hands over to
    // takes it, but keeps the event until it closes. Handles are closed at once, so the setup's
    // next start still creates the mutex itself.
    static bool SetupOpen()
    {
        try
        {
            Mutex m;
            if (Mutex.TryOpenExisting(SetupMutex, out m)) { m.Dispose(); return true; }
        }
        catch (UnauthorizedAccessException) { return true; }  // it exists
        catch { }
        try
        {
            EventWaitHandle e;
            if (EventWaitHandle.TryOpenExisting(SetupShowEvent, out e)) { e.Dispose(); return true; }
        }
        catch (UnauthorizedAccessException) { return true; }
        catch { }
        return false;
    }

    static bool SetupDone
    {
        get
        {
            using (var k = Registry.CurrentUser.OpenSubKey(SettingsKey))
            {
                object v = k == null ? null : k.GetValue("SetupDone");
                return v is int && (int)v != 0;
            }
        }
    }

    static void Check()
    {
        if (CableUp())
        {
            downChecks = 0;
            if (!linkUp)
            {
                linkUp = true;
                OnPlug();
            }
            if (!ReceiverRunning) WatchForWedge();
        }
        else if (++downChecks >= 3)  // ignore blips
        {
            // A link restart started here isn't a new plug: nothing happens when it comes back.
            if (DateTime.UtcNow > quietUntil) linkUp = false;
            macAddress = null;  // the next Mac may be another one
            missedPings = 0;
        }
        CheckReceiver();
        if (killAt != DateTime.MinValue && DateTime.UtcNow >= killAt)
        {
            killAt = DateTime.MinValue;
            foreach (var p in Process.GetProcessesByName("UsbcDisplay"))
            {
                try { if (!p.HasExited) { Note("display: still running 3 s after Stop; ending it"); p.Kill(); } }
                catch { }
                finally { p.Dispose(); }
            }
        }
    }

    // The cable just came up, or was already in when this started at login.
    static void OnPlug()
    {
        if (ReceiverRunning) return;  // a link that comes back while the display runs is its own recovery
        if (SetupOpen())
        {
            Note("plug: setup is open, so it takes it from here");
            return;
        }
        if (!SetupDone)
        {
            Note("plug: setup isn't done; opening it");
            if (OpenSetup(false)) return;
        }
        Note("plug: showing the Mac desktop");
        StartDisplay();
    }

    // Opens USB-C Display Setup, or brings the open one forward. Without force, only until setup
    // has finished (SetupDone).
    static bool OpenSetup(bool force)
    {
        if (!force && SetupDone) return false;
        string setup = Path.Combine(AppDir, SetupExe);
        if (!File.Exists(setup)) return false;
        try
        {
            using (Process.Start(new ProcessStartInfo(setup) { UseShellExecute = false, WorkingDirectory = AppDir })) { }
            Note("setup: opened" + (force ? " (after setup was done)" : ""));
            return true;
        }
        catch (Exception e)
        {
            Note("setup: can't open: " + e.Message);
            return false;
        }
    }

    // The automatic fallbacks never bring an open setup forward: it's already showing what to do.
    static void OpenSetupUnlessOpen()
    {
        if (!SetupOpen()) OpenSetup(true);
    }

    // ---- The display ----

    static void UpdateMenu()
    {
        showItem.Text = ReceiverRunning ? StopLabel : ShowLabel;
    }

    static void ShowOrStop()
    {
        if (ReceiverRunning) StopDisplay();
        else StartDisplay();
    }

    static void StartDisplay()
    {
        if (ReceiverRunning) return;
        if (!CableUp() && OpenSetup(true)) return;  // no cable yet: setup shows how to connect your Mac
        StartReceiver();
    }

    // Closes the display the way Ctrl-Alt-Esc does (its window closes and it quits), whoever
    // started it; anything still running 3 s later is ended (Check).
    static void StopDisplay()
    {
        stopRequested = true;
        int n = 0;
        for (IntPtr w = FindWindowEx(IntPtr.Zero, IntPtr.Zero, ReceiverClass, null); w != IntPtr.Zero;
             w = FindWindowEx(IntPtr.Zero, w, ReceiverClass, null))
        {
            PostMessage(w, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            n++;
        }
        Note("display: stop (" + n + " window" + (n == 1 ? "" : "s") + ")");
        killAt = DateTime.UtcNow.AddSeconds(3);
    }

    static void StartReceiver()
    {
        if (ReceiverRunning) return;
        string exe = Path.Combine(AppDir, ReceiverExe);
        if (!File.Exists(exe))
        {
            Note("display: " + exe + " is missing");
            MissingFiles();
            return;
        }
        bool input = SavedInput();
        string args = "--exit-when-unplugged --scale " + SavedScale() + (SavedColorManaged() ? "" : " --no-color-profile") +
                      (input ? "" : " --no-input");
        // The display should have the keyboard as soon as it shows (this works when the start
        // came from a click in the tray menu; on a plug the receiver takes the foreground itself).
        AllowSetForegroundWindow(-1);
        var psi = new ProcessStartInfo(exe, args)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = AppDir,
        };
        // A framework-dependent UsbcDisplay (a development build) uses the SDK in the home folder;
        // the installed one is self-contained and needs nothing.
        if (FrameworkDependent(psi.FileName))
            psi.EnvironmentVariables["DOTNET_ROOT"] = Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\.dotnet-sdk");

        connected = inputRefused = false;
        stopRequested = inputNoted = false;
        inputAsked = input;
        killAt = DateTime.MinValue;
        receiverStarted = DateTime.UtcNow;
        CloseLog();
        try
        {
            Directory.CreateDirectory(LogDir);
            log = new StreamWriter(Path.Combine(LogDir, "receiver.log"), false) { AutoFlush = true };
        }
        catch { log = null; }
        var p = new Process { StartInfo = psi };
        DataReceivedEventHandler onLine = delegate(object s, DataReceivedEventArgs e)
        {
            if (e.Data == null) return;
            if (e.Data.StartsWith("Connected to")) connected = true;
            if (e.Data.StartsWith("Input: not allowed")) inputRefused = true;  // noted from the UI thread (CheckReceiver)
            var l = log;
            if (l != null) lock (l) { try { l.WriteLine(e.Data); } catch { } }
        };
        p.OutputDataReceived += onLine;
        p.ErrorDataReceived += onLine;
        try
        {
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            receiver = p;
            Note("display: started " + ReceiverExe + " " + args);
        }
        catch (Exception e)
        {
            p.Dispose();
            Note("display: can't start: " + e.Message);
            MissingFiles();
        }
    }

    static void MissingFiles()
    {
        // Setup's Ready screen explains it and how to fix it; without setup, a note in the tray.
        if (!OpenSetup(true)) tray.ShowBalloonTip(15000, Title, MissingFilesNote, ToolTipIcon.Warning);
    }

    static void CloseLog()
    {
        var l = log;
        log = null;
        if (l != null) lock (l) { try { l.Dispose(); } catch { } }
    }

    // Once a second: how the display this watcher started is doing.
    static void CheckReceiver()
    {
        var p = receiver;
        if (p == null) return;
        bool exited;
        try { exited = p.HasExited; } catch { exited = true; }
        if (exited)
        {
            int code = -1;
            try { p.WaitForExit(500); code = p.ExitCode; } catch { }  // its last lines
            receiver = null;
            p.Dispose();
            CloseLog();
            Note("display: ended, exit code " + code + (connected ? "" : ", never reached your Mac"));
            if (stopRequested) return;
            if (code == ExitRefused) OpenSetupUnlessOpen();               // Screen Recording is off: setup shows how to turn it on
            else if (!connected && CableUp()) OpenSetupUnlessOpen();      // it gave up without reaching your Mac
            return;
        }
        if (inputRefused && inputAsked && !inputNoted)
        {
            inputNoted = true;  // once per start
            tray.ShowBalloonTip(15000, Title, KeyboardNote, ToolTipIcon.Info);
        }
        if (!connected && !stopRequested && DateTime.UtcNow - receiverStarted >= ConnectLimit)
        {
            // A second Mac, a Mac without the app, or one that's asleep: setup knows what to show.
            Note("display: no answer from your Mac in 15 s; opening setup");
            stopRequested = true;
            try { p.Kill(); } catch { }
            if (CableUp()) OpenSetupUnlessOpen();
        }
    }

    static bool FrameworkDependent(string exe)
    {
        try
        {
            string config = Path.ChangeExtension(exe, ".runtimeconfig.json");
            return File.Exists(config) && File.ReadAllText(config).Contains("\"framework");
        }
        catch { return false; }
    }

    // ---- Display Options ----

    static void ShowOptions()
    {
        if (options != null)
        {
            options.Activate();
            return;
        }
        int recommended;
        Size native;
        var choices = ScaleChoices(out recommended, out native);
        options = new ChoiceForm(choices, SavedScale(), native, SavedColorManaged(), SavedInput());
        options.FormClosed += delegate
        {
            var f = options;
            options = null;
            if (!f.Accepted) return;
            try
            {
                using (var k = Registry.CurrentUser.CreateSubKey(SettingsKey))
                {
                    k.SetValue("Scale", f.ChosenScale, RegistryValueKind.DWord);
                    k.SetValue("ColorManaged", f.ColorManaged ? 1 : 0, RegistryValueKind.DWord);
                    k.SetValue("Input", f.UseInput ? 1 : 0, RegistryValueKind.DWord);
                }
            }
            catch (Exception e) { Note("options: can't save: " + e.Message); }
            Note("options: scale " + f.ChosenScale + ", colours " + (f.ColorManaged ? "on" : "off") + ", input " + (f.UseInput ? "on" : "off"));
            if (ReceiverRunning)
            {
                // The new size needs a new display: stop this one, then start again (CheckRestart).
                StopDisplay();
                restartPending = true;
                restartUntil = DateTime.UtcNow.AddSeconds(6);
                quick.Start();
            }
            else StartDisplay();
        };
        options.Show();
        options.Activate();
    }

    static void CheckRestart()
    {
        if (!restartPending) { quick.Stop(); return; }
        if (!ReceiverRunning)
        {
            restartPending = false;
            quick.Stop();
            StartDisplay();
        }
        else if (DateTime.UtcNow > restartUntil)
        {
            restartPending = false;
            quick.Stop();
            Note("options: the display didn't stop; not restarting it");
        }
    }

    // ---- Saved settings (HKCU\Software\USB-C Display, as the setup writes them) ----

    static int? SavedInt(string name)
    {
        try
        {
            using (var k = Registry.CurrentUser.OpenSubKey(SettingsKey))
            {
                object v = k == null ? null : k.GetValue(name);
                if (v is int) return (int)v;
                return null;
            }
        }
        catch { return null; }
    }

    // The saved size, else the one setup recommends (the same size as on a MacBook).
    static int SavedScale()
    {
        int? v = SavedInt("Scale");
        if (v.HasValue && v.Value >= 100 && v.Value <= 300) return v.Value;
        int recommended;
        Size native;
        ScaleChoices(out recommended, out native);
        return recommended;
    }

    static bool SavedColorManaged()
    {
        int? v = SavedInt("ColorManaged");
        return !v.HasValue || v.Value != 0;  // on unless turned off
    }

    static bool SavedInput()
    {
        int? v = SavedInt("Input");
        return v.HasValue && v.Value != 0;  // off unless setup (or Display Options) turned it on
    }

    // ---- Display sizes, computed as the setup does (windows/setup/Machine.cs ScaleOptions) ----
    // "Default" is the same size as on a MacBook: the panel's real pixels per inch (from its
    // EDID) against the ~129 points per inch a MacBook shows. Without it, Windows' own scaling.

    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    public static List<KeyValuePair<int, string>> ScaleChoices(out int recommended, out Size native)
    {
        int eff = 96, raw = 0;
        native = Screen.PrimaryScreen.Bounds.Size;
        IntPtr old = IntPtr.Zero;
        try { old = SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }  // per-monitor v2: real pixels, current scaling
        try
        {
            var p = new POINT();
            IntPtr m = MonitorFromPoint(p, 1 /*MONITOR_DEFAULTTOPRIMARY*/);
            var mi = new MONITORINFO { Size = Marshal.SizeOf(typeof(MONITORINFO)) };
            if (GetMonitorInfo(m, ref mi)) native = new Size(mi.Monitor.Right - mi.Monitor.Left, mi.Monitor.Bottom - mi.Monitor.Top);
            uint x, y;
            if (GetDpiForMonitor(m, 0 /*MDT_EFFECTIVE_DPI*/, out x, out y) == 0) eff = (int)x;
            if (GetDpiForMonitor(m, 2 /*MDT_RAW_DPI*/, out x, out y) == 0) raw = (int)x;
        }
        catch { }
        finally
        {
            try { if (old != IntPtr.Zero) SetThreadDpiAwarenessContext(old); } catch { }
        }

        int windows = Clamp((int)Math.Round(eff * 100.0 / 96), 100, 300);
        int same = raw >= 90 && raw <= 600 ? Clamp((int)Math.Round(raw * 100.0 / 129 / 5) * 5, 100, 200) : 0;
        recommended = same > 0 ? same : windows > 100 && windows < 200 ? windows : 100;

        var list = new List<KeyValuePair<int, string>>();
        list.Add(new KeyValuePair<int, string>(recommended, "Default"));
        if (windows > recommended && windows < 200) list.Add(new KeyValuePair<int, string>(windows, "Larger Text"));
        if (recommended > 100) list.Add(new KeyValuePair<int, string>(100, "More Space"));
        if (recommended < 200) list.Add(new KeyValuePair<int, string>(200, "Largest Text"));
        // By size, as macOS lists them: the largest text first, More Space last.
        list.Sort((a, b) => b.Key.CompareTo(a.Key));
        return list;
    }

    static int Clamp(int v, int min, int max) { return v < min ? min : v > max ? max : v; }

    // ---- The cable as a plain network link ----
    // Large copies from the Mac (Finder file sharing and the like) go out as bundled packets the
    // Windows USB4 driver can choke on: the link then stays "up" but nothing gets through. The
    // display avoids those packets and restarts the link itself; when it isn't running, this
    // does: if the Mac stops answering pings although the cable is still connected, the
    // registered task restarts the link (no permission prompt), at most twice in 10 minutes.
    const string RecoveryTask = @"\USB-C Display\Restart USB4 link";
    static string macAddress;      // the Mac's link-local address on the cable, once seen
    static int missedPings, checkTick;
    static DateTime quietUntil = DateTime.MinValue;
    static readonly List<DateTime> resets = new List<DateTime>();

    static void WatchForWedge()
    {
        if (++checkTick % 3 != 0) return;  // every 3 s
        if (macAddress == null) { macAddress = FindMac(); missedPings = 0; return; }
        bool answered = false;
        try
        {
            using (var p = new Ping()) answered = p.Send(System.Net.IPAddress.Parse(macAddress), 1000).Status == IPStatus.Success;
        }
        catch { }
        if (answered) { missedPings = 0; return; }
        if (++missedPings < 3 || DateTime.UtcNow < quietUntil) return;
        missedPings = 0;
        resets.RemoveAll(t => DateTime.UtcNow - t > TimeSpan.FromMinutes(10));
        if (resets.Count >= 2)
        {
            Note("link: stopped again; asking to reconnect the cable");
            tray.ShowBalloonTip(10000, Title, KeepsStoppingNote, ToolTipIcon.Warning);
            quietUntil = DateTime.UtcNow.AddMinutes(10);
            return;
        }
        resets.Add(DateTime.UtcNow);
        quietUntil = DateTime.UtcNow.AddSeconds(150);
        try
        {
            Note("link: your Mac stopped answering on a connected cable; restarting the link");
            using (var p = Process.Start(new ProcessStartInfo("schtasks.exe", "/run /tn \"" + RecoveryTask + "\"") { UseShellExecute = false, CreateNoWindow = true }))
                p.WaitForExit(10000);
            tray.ShowBalloonTip(10000, Title, RestartingNote, ToolTipIcon.Info);
        }
        catch { }
    }

    // The Mac answers an all-nodes ping on the cable interface, which puts it in the neighbour
    // table (ping.exe itself doesn't show replies to multicast).
    static string FindMac()
    {
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            string d = ni.Description;
            if (ni.OperationalStatus != OperationalStatus.Up || !(d.Contains("USB4") || d.Contains("Thunderbolt") || d.Contains("P2P Network"))) continue;
            int index;
            try { index = ni.GetIPProperties().GetIPv6Properties().Index; } catch { continue; }
            try
            {
                Run("ping.exe", "-n 1 -w 500 ff02::1%" + index);
                string table = Run("netsh.exe", "interface ipv6 show neighbors interface=" + index);
                var m = System.Text.RegularExpressions.Regex.Match(table, @"^(fe80::[0-9a-fA-F:]+)\s", System.Text.RegularExpressions.RegexOptions.Multiline);
                if (m.Success) return m.Groups[1].Value + "%" + index;
            }
            catch { }
        }
        return null;
    }

    static string Run(string exe, string args)
    {
        var psi = new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
        using (var p = Process.Start(psi))
        {
            string output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(3000);
            return output;
        }
    }

    // ---- Tray ----

    // A left click opens the same menu as a right click (NotifyIcon only does that for the right).
    static void OpenTrayMenu()
    {
        try
        {
            var show = typeof(NotifyIcon).GetMethod("ShowContextMenu", BindingFlags.Instance | BindingFlags.NonPublic);
            if (show != null) show.Invoke(tray, null);
        }
        catch { }
    }

    // A small monitor, readable on light and dark taskbars (our own drawing).
    static Icon MakeIcon()
    {
        var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using (var frame = new SolidBrush(Color.FromArgb(60, 60, 60))) g.FillRectangle(frame, 2, 4, 28, 19);
            using (var screen = new SolidBrush(Color.FromArgb(0, 120, 215))) g.FillRectangle(screen, 4, 6, 24, 15);
            using (var stand = new SolidBrush(Color.FromArgb(60, 60, 60)))
            {
                g.FillRectangle(stand, 13, 23, 6, 4);
                g.FillRectangle(stand, 9, 27, 14, 3);
            }
        }
        return Icon.FromHandle(bmp.GetHicon());
    }

    // A plain log for when something goes wrong on a real PC, next to the setup's and the
    // receiver's (%LOCALAPPDATA%\UsbcDisplay\watcher.log).
    static bool noteStarted;

    static void Note(string line)
    {
        try
        {
            Directory.CreateDirectory(LogDir);
            string path = Path.Combine(LogDir, "watcher.log");
            if (!noteStarted)
            {
                noteStarted = true;
                if (File.Exists(path) && new FileInfo(path).Length > (1 << 20)) File.Delete(path);
            }
            File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " [" + Process.GetCurrentProcess().Id + "] " + line + "\r\n");
        }
        catch { }
    }
}

// Display Options, from the tray menu: how your Mac desktop looks on this PC. A small, plain
// Windows dialog; Show Mac Desktop saves the choices and (re)starts the display with them.
sealed class ChoiceForm : Form
{
    public bool Accepted, ColorManaged, UseInput;
    public int ChosenScale;
    readonly List<KeyValuePair<RadioButton, int>> sizes = new List<KeyValuePair<RadioButton, int>>();

    // Layout in 96-DPI pixels; AutoScaleMode.Dpi scales it to the screen like the fonts.
    const int Width0 = 400, Margin0 = 24, DetailX = 196, Row = 28, FooterHeight = 64;

    public ChoiceForm(List<KeyValuePair<int, string>> choices, int current, Size native, bool colorManaged, bool useInput)
    {
        SuspendLayout();
        Text = "USB-C Display";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        ShowIcon = false;
        TopMost = true;  // opened from the tray: it must not open behind other windows
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = SystemColors.Window;
        Font = new Font("Segoe UI", 9.75f);

        var heading = new Label
        {
            Text = "Display Options",
            Font = new Font("Segoe UI Semibold", 15f),
            AutoSize = true,
            Location = new Point(Margin0 - 3, 18),
        };
        var subheading = new Label
        {
            Text = "Choose how your Mac desktop looks on this PC.",
            ForeColor = SystemColors.GrayText,
            AutoSize = true,
            Location = new Point(Margin0 - 1, 54),
        };
        var sizeLabel = new Label
        {
            Text = "Display Size",
            Font = new Font("Segoe UI Semibold", 9.75f),
            AutoSize = true,
            Location = new Point(Margin0 - 1, 92),
        };
        Controls.AddRange(new Control[] { heading, subheading, sizeLabel });

        int y = 116;
        RadioButton def = null;  // the Default size (the list runs by size, so it isn't always first)
        foreach (var c in choices)
        {
            string detail = "Looks like " + native.Width * 100 / c.Key + " \u00D7 " + native.Height * 100 / c.Key;
            var r = new RadioButton
            {
                Text = c.Value,
                AutoSize = false,
                Size = new Size(DetailX - Margin0, 24),
                CheckAlign = ContentAlignment.MiddleLeft,
                TextAlign = ContentAlignment.MiddleLeft,
                Location = new Point(Margin0, y),
                Checked = c.Key == current,
                AccessibleDescription = detail,
            };
            var d = new Label
            {
                Text = detail,
                ForeColor = SystemColors.GrayText,
                AutoSize = false,
                Size = new Size(Width0 - Margin0 - DetailX, 24),
                TextAlign = ContentAlignment.MiddleLeft,
                Location = new Point(DetailX, y),
            };
            var radio = r;
            d.Click += delegate { radio.Checked = true; radio.Focus(); };
            sizes.Add(new KeyValuePair<RadioButton, int>(r, c.Key));
            if (c.Value == "Default") def = r;
            Controls.Add(r);
            Controls.Add(d);
            y += Row;
        }
        bool anyChecked = false;
        foreach (var s in sizes) anyChecked |= s.Key.Checked;
        if (!anyChecked && sizes.Count > 0) (def ?? sizes[0].Key).Checked = true;  // e.g. Windows' scaling changed since

        y += 14;
        var color = new CheckBox
        {
            Text = "Match colors with your Mac",
            AutoSize = true,
            Checked = colorManaged,
            Location = new Point(Margin0, y),
        };
        y += Row;
        var input = new CheckBox
        {
            Text = "Use this PC\u2019s keyboard and trackpad with your Mac",
            AutoSize = true,
            Checked = useInput,
            Location = new Point(Margin0, y),
        };
        y += Row + 10;
        Controls.Add(color);
        Controls.Add(input);

        // The button row, on the grey band Windows dialogs use, primary first.
        var footer = new Panel
        {
            BackColor = SystemColors.Control,
            Location = new Point(0, y),
            Size = new Size(Width0, FooterHeight),
        };
        footer.Paint += delegate(object s, PaintEventArgs e)
        {
            using (var line = new Pen(SystemColors.ControlLight)) e.Graphics.DrawLine(line, 0, 0, footer.Width, 0);
        };
        var cancel = new Button
        {
            Text = "Cancel",
            Size = new Size(100, 32),
            Location = new Point(Width0 - Margin0 - 100, (FooterHeight - 32) / 2),
            UseVisualStyleBackColor = true,
            DialogResult = DialogResult.Cancel,
        };
        var show = new Button
        {
            Text = "Show Mac Desktop",
            Size = new Size(148, 32),
            Location = new Point(cancel.Left - 8 - 148, (FooterHeight - 32) / 2),
            UseVisualStyleBackColor = true,
        };
        show.Click += delegate
        {
            foreach (var s in sizes) if (s.Key.Checked) ChosenScale = s.Value;
            ColorManaged = color.Checked;
            UseInput = input.Checked;
            Accepted = true;
            Close();
        };
        cancel.Click += delegate { Close(); };
        footer.Controls.Add(show);
        footer.Controls.Add(cancel);
        Controls.Add(footer);
        ClientSize = new Size(Width0, y + FooterHeight);

        // Tab order: sizes, the two options, then the buttons.
        int tab = 0;
        foreach (Control c in Controls) c.TabIndex = tab++;
        show.TabIndex = 0;
        cancel.TabIndex = 1;
        AcceptButton = show;    // Return
        CancelButton = cancel;  // Esc
        AutoScaleDimensions = new SizeF(96f, 96f);
        AutoScaleMode = AutoScaleMode.Dpi;
        ResumeLayout(false);
        PerformLayout();
    }

    // The selected size has the focus when the dialog opens, as in a Windows dialog.
    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        foreach (var s in sizes) if (s.Key.Checked) { s.Key.Focus(); break; }
    }
}
