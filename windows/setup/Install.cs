using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

namespace UsbcSetup;

// What this exe carries besides itself (each only if it was built, see UsbcDisplaySetup.csproj).
static class Payload
{
    public const string Receiver = "UsbcDisplay.exe", Watcher = "UsbcWatcher.exe", MacZip = "USB-C-Display.zip";
    public static readonly string[] All = { Receiver, Watcher, MacZip };

    public static List<string> Missing()
    {
        var list = new List<string>();
        foreach (var f in All) if (!Resources.Has("payload/" + f)) list.Add(f);
        return list;
    }

    // The Mac app this copy serves: the zip's size in bytes and its CFBundleVersion (from the
    // app's Info.plist inside the zip, else the version this build was made with). (0, "") when
    // there is no Mac app.
    public static (long Size, string Version) MacAppInfo()
    {
        try
        {
            using var s = OpenMacZip(out long size);
            if (s == null) return (0, "");
            string version = "";
            try
            {
                using var zip = new ZipArchive(s, ZipArchiveMode.Read, leaveOpen: true);
                foreach (var e in zip.Entries)
                {
                    if (!e.FullName.EndsWith(".app/Contents/Info.plist", StringComparison.OrdinalIgnoreCase)) continue;
                    if (e.Length > 1 << 20) break;
                    using var r = new StreamReader(e.Open());
                    var m = Regex.Match(r.ReadToEnd(), @"<key>\s*CFBundleVersion\s*</key>\s*<string>\s*([^<\s]+)\s*</string>");
                    if (m.Success) version = m.Groups[1].Value;
                    break;
                }
            }
            catch (Exception e) { Log.Write("payload: can't read the Mac app's version: " + e.Message); }
            if (version == "") version = Machine.MacAppVersion;
            return (size, version);
        }
        catch (Exception e)
        {
            Log.Write("payload: " + e.Message);
            return (0, "");
        }
    }

    // This build's Mac app if it carries one, else the installed copy.
    public static Stream OpenMacZip(out long size)
    {
        size = 0;
        var s = Resources.Open("payload/" + MacZip);
        if (s != null) { size = s.Length; return s; }
        string f = Path.Combine(Install.Dir, MacZip);
        try
        {
            if (File.Exists(f))
            {
                var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.Read);
                size = fs.Length;
                return fs;
            }
        }
        catch { }
        return null;
    }
}

// Installs for this Windows account only (no admin): %LOCALAPPDATA%\Programs\USB-C Display,
// the watcher at login, a Start menu entry and an entry in Settings > Apps.
static class Install
{
    public static readonly string Dir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "USB-C Display");
    public const string SetupExe = "USB-C Display Setup.exe";
    public static string SetupPath => Path.Combine(Dir, SetupExe);
    public static string WatcherPath => Path.Combine(Dir, Payload.Watcher);
    public static string ReceiverPath => Path.Combine(Dir, Payload.Receiver);

    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunName = "USB-C Display";  // the same value UsbcWatcher --install writes
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\USB-C Display";
    static string ShortcutPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.Programs), "USB-C Display.lnk");

    public static bool RunningInstalled =>
        string.Equals(Path.GetFullPath(Environment.ProcessPath ?? ""), Path.GetFullPath(SetupPath), StringComparison.OrdinalIgnoreCase);

    public static bool IsInstalled
    {
        get
        {
            try
            {
                using var k = Registry.CurrentUser.OpenSubKey(UninstallKey);
                return k != null && File.Exists(SetupPath);
            }
            catch { return false; }
        }
    }

    // Copies everything into place. Throws on failure: the message goes to the log, and InUse
    // tells "another copy is open" from anything else.
    public static void Run()
    {
        Log.Write("install: to " + Dir);
        try { Directory.CreateDirectory(Dir); }
        catch (Exception e) { throw new IOException("Windows didn't let setup create its folder: " + e.Message, e); }
        RemoveLeftovers();
        StopInstalled("UsbcWatcher");

        if (!RunningInstalled)
        {
            Place(Environment.ProcessPath, SetupPath);
            // The copy would keep the browser's "downloaded from the internet" mark, and with it
            // extra security warnings every time it starts.
            try { File.Delete(SetupPath + ":Zone.Identifier"); } catch { }
        }
        foreach (var f in Payload.All)
        {
            using var s = Resources.Open("payload/" + f);
            if (s == null) { Log.Write("install: not in this build: " + f); continue; }
            string tmp = Path.Combine(Dir, f + ".new");
            using (var o = File.Create(tmp)) s.CopyTo(o);
            Place(tmp, Path.Combine(Dir, f), move: true);
        }

        if (File.Exists(WatcherPath))
            using (var k = Registry.CurrentUser.CreateSubKey(RunKey)) k.SetValue(RunName, "\"" + WatcherPath + "\"");
        try { MakeShortcut(); } catch (Exception e) { Log.Write("install: shortcut: " + e.Message); }
        using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            k.SetValue("DisplayName", "USB-C Display");
            k.SetValue("DisplayIcon", "\"" + SetupPath + "\",0");
            k.SetValue("DisplayVersion", "1.0." + Machine.SetupBuild);
            k.SetValue("Publisher", "USB-C Display");
            k.SetValue("InstallLocation", Dir);
            k.SetValue("UninstallString", "\"" + SetupPath + "\" --uninstall");
            k.SetValue("QuietUninstallString", "\"" + SetupPath + "\" --uninstall");
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            k.SetValue("EstimatedSize", (int)(DirSize() / 1024), RegistryValueKind.DWord);
        }
        StartWatcher();
        Log.Write("install: done");
    }

    // Puts a file in place even if the old one is running: a running exe can't be overwritten
    // or deleted, but it can be renamed out of the way (removed on the next install).
    static void Place(string from, string to, bool move = false)
    {
        try
        {
            if (File.Exists(to))
            {
                try { File.Delete(to); }
                catch { File.Move(to, to + ".old-" + DateTime.UtcNow.Ticks); }
            }
            if (move) File.Move(from, to);
            else File.Copy(from, to);
        }
        catch (Exception e)
        {
            throw new IOException($"Couldn't put {Path.GetFileName(to)} in place: {e.Message}", e);
        }
    }

    // A file held open by another program (another copy of USB-C Display, most likely): Windows'
    // sharing or lock violation, anywhere in the chain.
    public static bool InUse(Exception e)
    {
        for (; e != null; e = e.InnerException)
            if (e is IOException && (e.HResult & 0xFFFF) is 32 or 33) return true;  // ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION
        return false;
    }

    static void RemoveLeftovers()
    {
        try
        {
            foreach (var f in Directory.EnumerateFiles(Dir))
                if (f.Contains(".old-") || f.EndsWith(".new")) try { File.Delete(f); } catch { }
        }
        catch { }
    }

    static long DirSize()
    {
        long n = 0;
        try { foreach (var f in Directory.EnumerateFiles(Dir)) n += new FileInfo(f).Length; } catch { }
        return n;
    }

    static void MakeShortcut()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(ShortcutPath));
        var type = Type.GetTypeFromProgID("WScript.Shell");
        dynamic shell = Activator.CreateInstance(type);
        try
        {
            dynamic lnk = shell.CreateShortcut(ShortcutPath);
            lnk.TargetPath = SetupPath;
            lnk.WorkingDirectory = Dir;
            lnk.Description = "Use this PC as a display for your Mac";
            lnk.IconLocation = SetupPath + ",0";
            lnk.Save();
        }
        finally { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); }
    }

    // The tray watcher. "--started-by-setup": a cable that's already in isn't a new plug.
    public static void StartWatcher()
    {
        if (!File.Exists(WatcherPath)) return;
        foreach (var p in Process.GetProcessesByName("UsbcWatcher")) { p.Dispose(); return; }  // already running
        try
        {
            using var p = Process.Start(new ProcessStartInfo(WatcherPath, "--started-by-setup")
                { UseShellExecute = false, WorkingDirectory = Dir });
        }
        catch (Exception e) { Log.Write("install: start watcher: " + e.Message); }
    }

    // Stops our copies of a program (by name, only those running from the install folder, never
    // this process).
    static void StopInstalled(string name)
    {
        int self = Environment.ProcessId;
        foreach (var p in Process.GetProcessesByName(name))
        {
            using (p)
            {
                try
                {
                    if (p.Id == self) continue;
                    string path = ImagePath(p.Id);
                    if (!path.StartsWith(Dir + "\\", StringComparison.OrdinalIgnoreCase)) continue;
                    p.Kill();
                    p.WaitForExit(3000);
                }
                catch (Exception e) { Log.Write($"install: couldn't stop {name}: {e.Message}"); }
            }
        }
    }

    // Works across architectures and without reading the other process's memory (MainModule can't).
    static string ImagePath(int pid)
    {
        IntPtr h = OpenProcess(0x1000 /*PROCESS_QUERY_LIMITED_INFORMATION*/, false, pid);
        if (h == IntPtr.Zero) return "";
        try
        {
            var sb = new System.Text.StringBuilder(1024);
            int size = sb.Capacity;
            return QueryFullProcessImageNameW(h, 0, sb, ref size) ? sb.ToString(0, size) : "";
        }
        finally { CloseHandle(h); }
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(int access, bool inherit, int pid);
    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
    static extern bool QueryFullProcessImageNameW(IntPtr process, int flags, System.Text.StringBuilder name, ref int size);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);

    // "USB-C Display Setup.exe --uninstall", from Settings > Apps.
    public static int Uninstall()
    {
        if (!ConfirmRemove()) return 1;

        StopInstalled("UsbcWatcher");
        StopInstalled("UsbcDisplay");
        StopInstalled(Path.GetFileNameWithoutExtension(SetupExe));  // an open setup window

        bool adminPartRemoved = true;
        if (Elevation.FirewallRuleExists() || Elevation.AnyTaskExists())
            adminPartRemoved = Elevation.RunElevated("--elevated-remove", out _) == 0;

        try { using var k = Registry.CurrentUser.CreateSubKey(RunKey); k.DeleteValue(RunName, false); } catch { }
        try { Registry.CurrentUser.DeleteSubKeyTree(Settings.Key, false); } catch { }
        try { File.Delete(ShortcutPath); } catch { }
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        try { Directory.Delete(Path.Combine(local, "USB-C Display"), true); } catch { }  // the wizard's WebView2 data
        try { Directory.Delete(Log.Dir, true); } catch { }                                // logs

        if (adminPartRemoved)
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
            // This exe is running from the folder: a short-lived cmd removes it once we've exited,
            // trying for about half a minute in case something still holds a file.
            try
            {
                Process.Start(new ProcessStartInfo("cmd.exe",
                    $"/d /c for /l %i in (1,1,10) do (ping -n 3 127.0.0.1 >nul & rmdir /s /q \"{Dir}\" 2>nul & if not exist \"{Dir}\" exit)")
                    { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetTempPath() })?.Dispose();
            }
            catch { }
        }
        else
        {
            // The firewall rules and tasks need Windows' permission to go: the Settings > Apps entry
            // and this exe stay, so removing USB-C Display again can ask for it. The rest goes.
            try
            {
                foreach (var f in Directory.EnumerateFiles(Dir))
                    if (!string.Equals(Path.GetFullPath(f), Path.GetFullPath(SetupPath), StringComparison.OrdinalIgnoreCase))
                        try { File.Delete(f); } catch { }
                using var k = Registry.CurrentUser.OpenSubKey(UninstallKey, true);
                k?.SetValue("EstimatedSize", (int)(DirSize() / 1024), RegistryValueKind.DWord);
            }
            catch { }
        }

        Removed(adminPartRemoved);
        return 0;
    }

    // Remove USB-C Display from this PC? The verb on the button, Cancel the default. The app's
    // own buttons, in its language (Windows' standard ones follow the Windows language); Esc and
    // the close box still cancel.
    static bool ConfirmRemove()
    {
        var remove = new TaskDialogButton("Remove");
        var cancel = new TaskDialogButton("Cancel");
        var page = new TaskDialogPage
        {
            AllowCancel = true,
            Caption = "Remove USB-C Display",
            Heading = "Remove USB-C Display from this PC?",
            Text = "This removes the app, its settings, its firewall rules, and the tasks that restart the cable connection " +
                   "when it stops responding. Windows asks for permission to remove the rules and tasks.",
            Footnote = new TaskDialogFootnote("To remove USB-C Display from your Mac, drag it from Applications to the Trash."),
            Buttons = { remove, cancel },
            DefaultButton = cancel,
        };
        using var icon = Program.AppIcon();
        if (icon != null) page.Icon = new TaskDialogIcon(icon);
        return TaskDialog.ShowDialog(page, TaskDialogStartupLocation.CenterScreen) == remove;
    }

    // What was removed (an informational alert: OK is its button).
    static void Removed(bool all)
    {
        var ok = new TaskDialogButton("OK");
        var page = new TaskDialogPage
        {
            AllowCancel = true,
            Caption = "Remove USB-C Display",
            // A no-break space keeps "this PC." together when the short heading wraps.
            Heading = all
                ? "USB-C Display was removed from this\u00A0PC."
                : "USB-C Display was removed from this PC, except for its firewall rules and cable tasks, which need permission to remove.",
            Text = all ? null : "To remove them, remove USB-C Display again in Settings > Apps > Installed apps, then click Yes when Windows asks.",
            Buttons = { ok },
            DefaultButton = ok,
        };
        using var icon = Program.AppIcon();
        if (icon != null) page.Icon = new TaskDialogIcon(icon);
        TaskDialog.ShowDialog(page, TaskDialogStartupLocation.CenterScreen);
    }
}
