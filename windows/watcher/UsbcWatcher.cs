// USB-C Display watcher (Windows). Starts at login and sits in the tray. Whenever the
// Mac shows up on the USB-C cable it asks whether to use the cable as a screen or for
// data; "screen" starts UsbcDisplay.exe, which exits by itself when the cable comes out.
//
// Built with the .NET Framework compiler that ships with Windows (build-watcher.cmd), so
// it starts at login with no runtime setup. C# 5, because that's what that compiler takes.
//
// usage: UsbcWatcher [--install | --uninstall]   (start at login, via HKCU\...\Run)
//        UsbcWatcher --started-by-setup           (a cable that's already in isn't a new plug)
//
// Until setup has finished (SetupDone), plugging in opens USB-C Display Setup instead of the
// popup: it guides both machines through the first connection.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Watcher
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunName = "USB-C Display";
    const string SettingsKey = @"Software\USB-C Display";  // remembers the screen size you picked
    static readonly string AppDir = AppDomain.CurrentDomain.BaseDirectory;
    const string SetupExe = "USB-C Display Setup.exe";
    static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"UsbcDisplay\receiver.log");

    static NotifyIcon tray;
    static ChoiceForm prompt;
    static Process receiver;
    static StreamWriter log;
    static bool linkUp, warned;
    static volatile bool showing, needAccessibility;
    static int downChecks;
    static DateTime receiverStarted;

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

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
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath));

            var menu = new ContextMenuStrip();
            menu.Items.Add("Use the Mac as a screen now", null, delegate { StartReceiver(SavedScale()); });
            menu.Items.Add("Quit", null, delegate { Application.Exit(); });
            tray = new NotifyIcon { Icon = MakeIcon(), Text = "USB-C Display", ContextMenuStrip = menu, Visible = true };

            if (args.Length > 0 && args[0] == "--started-by-setup") linkUp = CableUp();

            var timer = new System.Windows.Forms.Timer { Interval = 1000 };
            timer.Tick += delegate { Check(); };
            timer.Start();
            Check();  // the cable may already be in at login
            Application.Run();
            tray.Visible = false;
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
            if (receiver != null && !receiver.HasExited) return true;
            var others = Process.GetProcessesByName("UsbcDisplay");
            foreach (var p in others) p.Dispose();
            return others.Length > 0;
        }
    }

    static void Check()
    {
        if (CableUp())
        {
            downChecks = 0;
            // A link that comes back while the receiver runs is its own recovery, not a new plug.
            if (!linkUp && !ReceiverRunning && prompt == null && !OpenSetup()) ShowPrompt();
            linkUp = true;
            if (!ReceiverRunning) WatchForWedge();
        }
        else if (++downChecks >= 3)  // ignore blips
        {
            // A link restart we started ourselves isn't a new plug: no popup when it comes back.
            if (DateTime.UtcNow > quietUntil) linkUp = false;
            if (prompt != null) prompt.Close();
        }

        if (needAccessibility)
        {
            needAccessibility = false;
            tray.ShowBalloonTip(15000, "USB-C Display", "To use this laptop's trackpad and keyboard on the Mac, turn on usbc-display " +
                "on the Mac under System Settings > Privacy & Security > Accessibility.", ToolTipIcon.Info);
        }
        // Only for a receiver started here: one the setup started is the setup's to watch (this
        // never sees its output, so it would always look stuck).
        if (receiver != null && !receiver.HasExited && !showing && !warned && DateTime.UtcNow - receiverStarted > TimeSpan.FromSeconds(20))
        {
            warned = true;
            tray.ShowBalloonTip(10000, "USB-C Display", "Can't reach the Mac yet. Check that USB-C Display is running on the Mac " +
                "and that it's allowed under Privacy & Security > Screen Recording.", ToolTipIcon.Warning);
        }
    }

    // ---- The cable as a plain network link ----
    // Large copies from the Mac (Finder file sharing and the like) go out as bundled packets the
    // Windows USB4 driver can choke on: the link then stays "up" but nothing gets through. The
    // screen receiver avoids those packets and restarts the link itself; when it isn't running,
    // this does: if the Mac stops answering pings although the cable is still connected, the
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
            tray.ShowBalloonTip(10000, "USB-C Display", "The USB-C link keeps stopping. Unplug the cable and plug it back in.", ToolTipIcon.Warning);
            quietUntil = DateTime.UtcNow.AddMinutes(10);
            return;
        }
        resets.Add(DateTime.UtcNow);
        quietUntil = DateTime.UtcNow.AddSeconds(150);
        try
        {
            using (var p = Process.Start(new ProcessStartInfo("schtasks.exe", "/run /tn \"" + RecoveryTask + "\"") { UseShellExecute = false, CreateNoWindow = true }))
                p.WaitForExit(10000);
            tray.ShowBalloonTip(10000, "USB-C Display", "The USB-C link stopped passing data (a Windows USB4 driver problem). " +
                "Restarting it; it's back in about half a minute. Copies that were running need starting again.", ToolTipIcon.Info);
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

    // Windows' scaling for this screen, in percent (150 on this laptop).
    static int SystemScale()
    {
        using (var g = Graphics.FromHwnd(IntPtr.Zero)) return (int)Math.Round(g.DpiX * 100 / 96);
    }

    static int SavedScale()
    {
        using (var k = Registry.CurrentUser.OpenSubKey(SettingsKey))
        {
            object v = k == null ? null : k.GetValue("Scale");
            return v is int ? (int)v : 125;  // same size as on the MacBook
        }
    }

    static bool SavedColorManaged()
    {
        using (var k = Registry.CurrentUser.OpenSubKey(SettingsKey))
        {
            object v = k == null ? null : k.GetValue("ColorManaged");
            return !(v is int) || (int)v != 0;
        }
    }

    static bool SavedFlag(string name)
    {
        using (var k = Registry.CurrentUser.OpenSubKey(SettingsKey))
        {
            object v = k == null ? null : k.GetValue(name);
            return !(v is int) || (int)v != 0;  // on unless turned off
        }
    }

    // Before setup has finished, a plug-in opens the setup app (or brings it forward).
    static bool OpenSetup()
    {
        using (var k = Registry.CurrentUser.OpenSubKey(SettingsKey))
        {
            object v = k == null ? null : k.GetValue("SetupDone");
            if (v is int && (int)v != 0) return false;
        }
        string setup = Path.Combine(AppDir, SetupExe);
        if (!File.Exists(setup)) return false;
        try
        {
            using (Process.Start(new ProcessStartInfo(setup) { UseShellExecute = false, WorkingDirectory = AppDir })) { }
            return true;
        }
        catch { return false; }
    }

    static void ShowPrompt()
    {
        prompt = new ChoiceForm(SavedScale(), SystemScale(), Screen.PrimaryScreen.Bounds.Size, SavedColorManaged(), SavedFlag("Input"));
        prompt.FormClosed += delegate
        {
            bool screen = prompt.UseAsScreen;
            int scale = prompt.ChosenScale;
            bool color = prompt.ColorManaged, input = prompt.UseInput;
            prompt = null;
            if (!screen) return;
            using (var k = Registry.CurrentUser.CreateSubKey(SettingsKey))
            {
                k.SetValue("Scale", scale, RegistryValueKind.DWord);
                k.SetValue("ColorManaged", color ? 1 : 0, RegistryValueKind.DWord);
                k.SetValue("Input", input ? 1 : 0, RegistryValueKind.DWord);
            }
            StartReceiver(scale);
        };
        prompt.Show();
        prompt.Activate();
    }

    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);

    static void StartReceiver(int scale)
    {
        if (ReceiverRunning) return;
        string args = "--exit-when-unplugged --scale " + scale + (SavedColorManaged() ? "" : " --no-color-profile") +
                      (SavedFlag("Input") ? "" : " --no-input");
        // The screen should have the keyboard as soon as it shows (you just clicked here).
        AllowSetForegroundWindow(-1);
        var psi = new ProcessStartInfo(Path.Combine(AppDir, "UsbcDisplay.exe"), args)
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

        showing = warned = false;
        receiverStarted = DateTime.UtcNow;
        try { log = new StreamWriter(LogPath, false) { AutoFlush = true }; } catch { log = null; }
        receiver = new Process { StartInfo = psi };
        DataReceivedEventHandler onLine = delegate(object s, DataReceivedEventArgs e)
        {
            if (e.Data == null) return;
            if (e.Data.StartsWith("Showing")) showing = true;
            if (e.Data.StartsWith("Mac: allow")) needAccessibility = true;  // shown from the UI thread (Check)
            var l = log;
            if (l != null) lock (l) { try { l.WriteLine(e.Data); } catch { } }
        };
        receiver.OutputDataReceived += onLine;
        receiver.ErrorDataReceived += onLine;
        try
        {
            receiver.Start();
            receiver.BeginOutputReadLine();
            receiver.BeginErrorReadLine();
        }
        catch (Exception e)
        {
            receiver = null;
            MessageBox.Show("Could not start the screen receiver:\n" + e.Message, "USB-C Display", MessageBoxButtons.OK, MessageBoxIcon.Error);
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

    // A small blue monitor, readable on light and dark taskbars.
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
}

sealed class ChoiceForm : Form
{
    public bool UseAsScreen, ColorManaged, UseInput;
    public int ChosenScale;  // what to tell the Mac: 100 = 1:1 pixels, 200 = exactly 2x, else scaled like Windows
    readonly List<KeyValuePair<RadioButton, int>> sizes = new List<KeyValuePair<RadioButton, int>>();

    public ChoiceForm(int current, int systemScale, Size native, bool colorManaged, bool useInput)
    {
        SuspendLayout();
        Text = "USB-C Display";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        ShowIcon = false;
        TopMost = true;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 10f);

        // Screen sizes for the Mac's display. macOS draws everything but 1:1 at 2x (Retina) and
        // the picture is then fitted to this panel, like the MacBook's own default mode.
        // A MacBook Air shows about 129 points per inch; this 14" 1920x1200 panel has 162 pixels
        // per inch, so 125% gives the same physical size as on the Mac.
        int w = native.Width, h = native.Height, sys = Math.Max(systemScale, 100);
        AddSize(125, "Same size as on the MacBook", LooksLike(native, 125) + " (recommended)", current);
        if (sys != 125 && sys != 100 && sys != 200) AddSize(sys, "Larger text", LooksLike(native, sys) + ", like Windows here", current);
        AddSize(100, "More space", w + "×" + h + ", drawn at 1x, not Retina: thinner text", current);
        AddSize(200, "Largest", LooksLike(native, 200) + ", exactly 2x", current);
        bool anyChecked = false;
        foreach (var s in sizes) anyChecked |= s.Key.Checked;
        if (!anyChecked) sizes[0].Key.Checked = true;  // e.g. Windows' scaling changed since

        var sizeLabel = new Label { Text = "Screen size", Font = new Font("Segoe UI Semibold", 10f), AutoSize = true, Location = new Point(20, 194) };
        Controls.Add(sizeLabel);
        for (int i = 0; i < sizes.Count; i++)
        {
            sizes[i].Key.Location = new Point(24, 222 + i * 28);
            Controls.Add(sizes[i].Key);
        }
        // macOS colour-manages its own screen; with this it does the same for this panel.
        var color = new CheckBox
        {
            Text = "Match colours to this screen (uses its factory colour profile)",
            AutoSize = true,
            Checked = colorManaged,
            Location = new Point(22, 232 + sizes.Count * 28),
        };
        Controls.Add(color);
        var input = new CheckBox
        {
            Text = "Use this laptop's trackpad and keyboard on the Mac (Alt is ⌘, Windows key is ⌥)",
            AutoSize = true,
            Checked = useInput,
            Location = new Point(22, 260 + sizes.Count * 28),
        };
        Controls.Add(input);
        ClientSize = new Size(560, 296 + sizes.Count * 28);

        var title = new Label
        {
            Text = "Your Mac is connected over USB-C",
            Font = new Font("Segoe UI Semibold", 13f),
            AutoSize = true,
            Location = new Point(20, 16),
        };
        var subtitle = new Label
        {
            Text = "How do you want to use this connection?",
            ForeColor = SystemColors.GrayText,
            AutoSize = true,
            Location = new Point(21, 50),
        };
        var screen = MakeButton("Use as a screen", new Point(20, 88));
        screen.Click += delegate
        {
            foreach (var s in sizes) if (s.Key.Checked) ChosenScale = s.Value;
            ColorManaged = color.Checked;
            UseInput = input.Checked;
            UseAsScreen = true;
            Close();
        };
        var data = MakeButton("Data transfer", new Point(234, 88));
        data.Click += delegate { Close(); };
        Controls.AddRange(new Control[] {
            title, subtitle,
            screen, MakeNote("Show the Mac's extra display on this laptop", new Point(20, 140)),
            data, MakeNote("Keep the cable as a plain network link", new Point(234, 140)),
        });
        AcceptButton = screen;
        CancelButton = data;  // Esc
        // Sizes above are 96-DPI pixels; scale them to the screen like the fonts already are.
        AutoScaleDimensions = new SizeF(96f, 96f);
        AutoScaleMode = AutoScaleMode.Dpi;
        ResumeLayout(false);
    }

    public static string LooksLike(Size native, int scale)
    {
        return "looks like " + native.Width * 100 / scale + "×" + native.Height * 100 / scale;
    }

    void AddSize(int scale, string name, string detail, int current)
    {
        var r = new RadioButton { Text = name + ": " + detail, AutoSize = true, Checked = scale == current };
        sizes.Add(new KeyValuePair<RadioButton, int>(r, scale));
    }

    static Button MakeButton(string label, Point at)
    {
        return new Button
        {
            Text = label,
            Font = new Font("Segoe UI Semibold", 11f),
            Location = at,
            Size = new Size(198, 46),
            UseVisualStyleBackColor = true,
        };
    }

    static Label MakeNote(string text, Point at)
    {
        return new Label
        {
            Text = text,
            ForeColor = SystemColors.GrayText,
            Location = at,
            Size = new Size(198, 44),
            TextAlign = ContentAlignment.TopCenter,
        };
    }
}
