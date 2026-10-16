using System;
using System.Collections.Generic;
using System.Drawing;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Windows.Forms;
using Microsoft.Win32;

namespace UsbcSetup;

// Facts about this laptop: Windows, the USB4 hardware, the screen, the theme.
static class Machine
{
    public static int WindowsBuild => Environment.OSVersion.Version.Build;
    public static bool MicaSupported => WindowsBuild >= 22621;

    public static string Arch => RuntimeInformation.OSArchitecture switch
    {
        Architecture.Arm64 => "arm64",
        Architecture.X64 => "x64",
        Architecture.X86 => "x86",
        var a => a.ToString().ToLowerInvariant(),
    };

    public static long SetupBuild => long.TryParse(Metadata("SetupBuild"), out long b) ? b : 0;
    public static bool AppNotarized => string.Equals(Metadata("AppNotarized"), "true", StringComparison.OrdinalIgnoreCase);

    static string Metadata(string key)
    {
        foreach (var a in typeof(Machine).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>())
            if (a.Key == key) return a.Value;
        return null;
    }

    // ---- Administrators ----
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetTokenInformation(IntPtr token, int cls, out int value, int size, out int returned);

    // True when this account can approve the admin step itself (UAC then asks Yes/No, not for a password).
    public static bool IsAdminUser()
    {
        try
        {
            using var id = WindowsIdentity.GetCurrent();
            // 2 = elevated now, 3 = an administrator running with the UAC-filtered token.
            if (GetTokenInformation(id.Token, 18 /*TokenElevationType*/, out int type, 4, out _) && (type == 2 || type == 3))
                return true;
            return new WindowsPrincipal(id).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch { return false; }
    }

    // ---- USB4 ----
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] static extern int CM_Get_Device_ID_List_SizeW(out int len, string filter, int flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] static extern int CM_Get_Device_ID_ListW(string filter, char[] buffer, int len, int flags);
    const int CM_GETIDLIST_FILTER_PRESENT = 0x100;

    static List<string> PresentDevices()
    {
        if (CM_Get_Device_ID_List_SizeW(out int len, null, CM_GETIDLIST_FILTER_PRESENT) != 0 || len <= 0) return null;
        var buf = new char[len];
        if (CM_Get_Device_ID_ListW(null, buf, len, CM_GETIDLIST_FILTER_PRESENT) != 0) return null;
        return new List<string>(new string(buf).Split('\0', StringSplitOptions.RemoveEmptyEntries));
    }

    // "ok": a USB4 router (the part that makes the cable a network) is present. "missing": none,
    // and nothing that looks like USB4 or Thunderbolt either. "unknown": couldn't tell.
    public static string Usb4Status(out string routerHardwareId)
    {
        routerHardwareId = null;
        List<string> ids;
        try { ids = PresentDevices(); } catch { ids = null; }
        if (ids == null) return "unknown";
        bool hint = false;
        foreach (var id in ids)
        {
            string u = id.ToUpperInvariant();
            if (u.StartsWith(@"USB4\ROOT_DEVICE_ROUTER"))
            {
                // USB4\ROOT_DEVICE_ROUTER&VID_QCOM&PID_0CD1\5&2d0b... -> the part before the instance.
                int cut = id.IndexOf('\\', 5);
                routerHardwareId ??= cut > 0 ? id[..cut] : id;
            }
            else if (u.StartsWith(@"USB4\") || u.Contains("THUNDERBOLT")) hint = true;
        }
        if (routerHardwareId != null) return "ok";
        return hint ? "unknown" : "missing";
    }

    // ---- Theme ----
    public static bool DarkMode()
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return k?.GetValue("AppsUseLightTheme") is int v && v == 0;
        }
        catch { return false; }
    }

    // The accent colours for the UI's CSS, as #rrggbb. --accent is the shade Windows 11 fills
    // buttons with (AccentDark1 in light mode, AccentLight2 in dark mode); --accent-system is the
    // colour picked in Settings, and the light/dark shades are there too.
    public static Dictionary<string, string> AccentColors(bool dark)
    {
        var d = new Dictionary<string, string>();
        try
        {
            var ui = new Windows.UI.ViewManagement.UISettings();
            void Add(string name, Windows.UI.ViewManagement.UIColorType t)
            {
                var c = ui.GetColorValue(t);
                d[name] = $"#{c.R:x2}{c.G:x2}{c.B:x2}";
            }
            Add("--accent-system", Windows.UI.ViewManagement.UIColorType.Accent);
            Add("--accent", dark ? Windows.UI.ViewManagement.UIColorType.AccentLight2 : Windows.UI.ViewManagement.UIColorType.AccentDark1);
            Add("--accent-light-1", Windows.UI.ViewManagement.UIColorType.AccentLight1);
            Add("--accent-light-2", Windows.UI.ViewManagement.UIColorType.AccentLight2);
            Add("--accent-light-3", Windows.UI.ViewManagement.UIColorType.AccentLight3);
            Add("--accent-dark-1", Windows.UI.ViewManagement.UIColorType.AccentDark1);
            Add("--accent-dark-2", Windows.UI.ViewManagement.UIColorType.AccentDark2);
            Add("--accent-dark-3", Windows.UI.ViewManagement.UIColorType.AccentDark3);
            return d;
        }
        catch { }
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\DWM");
            if (k?.GetValue("AccentColor") is int abgr)
            {
                d["--accent"] = d["--accent-system"] = $"#{abgr & 0xFF:x2}{(abgr >> 8) & 0xFF:x2}{(abgr >> 16) & 0xFF:x2}";
                return d;
            }
        }
        catch { }
        d["--accent"] = dark ? "#60cdff" : "#005fb8";
        return d;
    }

    // ---- The screen ----
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point pt, int flags);

    static (int effective, int raw) PrimaryDpi()
    {
        try
        {
            IntPtr m = MonitorFromPoint(Point.Empty, 1 /*MONITOR_DEFAULTTOPRIMARY*/);
            int eff = GetDpiForMonitor(m, 0, out uint ex, out _) == 0 ? (int)ex : 96;
            int raw = GetDpiForMonitor(m, 2, out uint rx, out _) == 0 ? (int)rx : 0;
            return (eff, raw);
        }
        catch { return (96, 0); }
    }

    // How big the Mac's display can look on this panel. "Same size as on a MacBook" is computed
    // from the panel's real pixels per inch (from its EDID) against the ~129 points per inch a
    // MacBook shows; it's left out when Windows can't tell the panel's size.
    public static List<ScaleOption> ScaleOptions(out int recommended)
    {
        var (eff, raw) = PrimaryDpi();
        int windows = Math.Clamp((int)Math.Round(eff * 100.0 / 96), 100, 300);
        int same = raw >= 90 && raw <= 600 ? Math.Clamp((int)Math.Round(raw * 100.0 / 129 / 5) * 5, 100, 200) : 0;

        var list = new List<ScaleOption>();
        void Add(int id, string label, string detail)
        {
            foreach (var o in list) if (o.Id == id) return;
            list.Add(new ScaleOption { Id = id, Label = label, Detail = detail });
        }

        if (same > 0) Add(same, "Same size as a MacBook", "Text looks as big as on a Mac laptop");
        if (windows > 100 && windows < 200 && windows != same)
        {
            string label = same == 0 ? "Same size as Windows" : windows > same ? "Larger text" : "Smaller text";
            Add(windows, label, "The size Windows uses on this screen");
        }
        Add(100, "More space", "More fits, but text is small");
        if (list.Count < 3) Add(200, "Largest", "Big, easy to read text, less fits");  // three choices fit the screen
        recommended = same > 0 ? same : windows > 100 && windows < 200 ? windows : list[0].Id;
        foreach (var o in list) o.Recommended = o.Id == recommended;
        return list;
    }
}

// HKCU\Software\USB-C Display: the values the watcher reads too (windows/watcher/UsbcWatcher.cs).
static class Settings
{
    public const string Key = @"Software\USB-C Display";

    public static int? GetInt(string name)
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(Key);
            return k?.GetValue(name) is int v ? v : null;
        }
        catch { return null; }
    }

    public static void SetInt(string name, int value)
    {
        using var k = Registry.CurrentUser.CreateSubKey(Key);
        k.SetValue(name, value, RegistryValueKind.DWord);
    }

    public static int? Scale => GetInt("Scale");
    public static bool ColorManaged => GetInt("ColorManaged") != 0;   // on unless turned off
    public static bool Input => GetInt("Input") != 0;
    public static bool SetupDone => GetInt("SetupDone") is int v && v != 0;
}
