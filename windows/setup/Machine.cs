using System;
using System.Collections.Generic;
using System.Drawing;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Windows.Forms;
using Microsoft.Win32;

namespace UsbcSetup;

// Facts about this PC: Windows, the USB4 hardware, the screen, the theme, this exe's signature.
static class Machine
{
    public static int WindowsBuild => Environment.OSVersion.Version.Build;

    public static string Arch => RuntimeInformation.OSArchitecture switch
    {
        Architecture.Arm64 => "arm64",
        Architecture.X64 => "x64",
        Architecture.X86 => "x86",
        var a => a.ToString().ToLowerInvariant(),
    };

    public static long SetupBuild => long.TryParse(Metadata("SetupBuild"), out long b) ? b : 0;
    public static bool AppNotarized => string.Equals(Metadata("AppNotarized"), "true", StringComparison.OrdinalIgnoreCase);
    // The Mac app version this build carries, when its Info.plist can't be read from the zip.
    public static string MacAppVersion => Metadata("MacAppVersion") ?? "";

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
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] static extern int CM_Locate_DevNodeW(out int devInst, string id, int flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] static extern int CM_Get_DevNode_Registry_PropertyW(int devInst, int property, out int type, char[] buffer, ref int len, int flags);
    const int CM_GETIDLIST_FILTER_PRESENT = 0x100;
    const int CM_DRP_SERVICE = 5;

    // All devices Windows knows, or only the ones present now.
    static List<string> Devices(bool presentOnly)
    {
        int filter = presentOnly ? CM_GETIDLIST_FILTER_PRESENT : 0;
        if (CM_Get_Device_ID_List_SizeW(out int len, null, filter) != 0 || len <= 0) return null;
        var buf = new char[len];
        if (CM_Get_Device_ID_ListW(null, buf, len, filter) != 0) return null;
        return new List<string>(new string(buf).Split('\0', StringSplitOptions.RemoveEmptyEntries));
    }

    // The driver service of a present device ("Usb4HostRouter", "QcUsb4Bus"...), or "".
    static string Service(string id)
    {
        if (CM_Locate_DevNodeW(out int dev, id, 0) != 0) return "";
        var buf = new char[256];
        int len = buf.Length * 2;
        if (CM_Get_DevNode_Registry_PropertyW(dev, CM_DRP_SERVICE, out _, buf, ref len, 0) != 0) return "";
        return new string(buf).Split('\0')[0];
    }

    // USB4\ROOT_DEVICE_ROUTER&VID_QCOM&PID_0CD1\5&2d0b... -> the part before the instance.
    static string RouterHardwareId(string id)
    {
        if (!id.StartsWith(@"USB4\ROOT_DEVICE_ROUTER", StringComparison.OrdinalIgnoreCase)) return null;
        int cut = id.IndexOf('\\', 5);
        return cut > 0 ? id[..cut] : id;
    }

    // "ok": this PC has USB4 (what makes the cable a network). "missing": nothing that looks
    // like USB4 or Thunderbolt. "unknown": couldn't tell.
    // Some PCs (Qualcomm's) only list their USB4 routers while something is plugged into the
    // port; what's always there is the USB4 bus or host router, recognised by its driver service.
    // The router's hardware ID (for the link restart task) then comes from an earlier connection,
    // or stays null until the cable is plugged in.
    public static string Usb4Status(out string routerHardwareId)
    {
        routerHardwareId = null;
        List<string> ids;
        try { ids = Devices(presentOnly: true); } catch { ids = null; }
        if (ids == null) return "unknown";
        bool usb4 = false, hint = false;
        foreach (var id in ids)
        {
            string router = RouterHardwareId(id);
            if (router != null) { routerHardwareId ??= router; usb4 = true; continue; }
            string u = id.ToUpperInvariant();
            if (u.StartsWith(@"USB4\") || u.Contains("THUNDERBOLT")) hint = true;
            if (!usb4)
                try { usb4 = Service(id).Contains("usb4", StringComparison.OrdinalIgnoreCase); } catch { }
        }
        if (!usb4) return hint ? "unknown" : "missing";
        if (routerHardwareId == null)
            try
            {
                foreach (var id in Devices(presentOnly: false) ?? new List<string>())
                    if ((routerHardwareId = RouterHardwareId(id)) != null) break;
            }
            catch { }
        return "ok";
    }

    // ---- Theme ----
    // Only the page's first look before it knows the Mac's: the window draws macOS's colours, never
    // Windows' accent.
    public static bool DarkMode()
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return k?.GetValue("AppsUseLightTheme") is int v && v == 0;
        }
        catch { return false; }
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

    // How big the Mac's display can look on this panel, as a scale (panel pixels per Mac point,
    // in percent). The recommended one makes things as big as on a MacBook: it comes from the
    // panel's real pixels per inch (from its EDID) against the ~129 points per inch a MacBook
    // shows, or Windows' own scaling when Windows can't tell the panel's size. Setup doesn't offer
    // the choice (the tray's Display Options does); it uses the recommended size, or a saved one.
    public static List<ScaleOption> ScaleOptions(out int recommended)
    {
        var (eff, raw) = PrimaryDpi();
        int windows = Math.Clamp((int)Math.Round(eff * 100.0 / 96), 100, 300);
        int same = raw >= 90 && raw <= 600 ? Math.Clamp((int)Math.Round(raw * 100.0 / 129 / 5) * 5, 100, 200) : 0;
        Size panel;
        try { panel = Screen.PrimaryScreen?.Bounds.Size ?? Size.Empty; } catch { panel = Size.Empty; }

        var list = new List<ScaleOption>();
        void Add(int id, string label)
        {
            foreach (var o in list) if (o.Id == id) return;
            string detail = panel.Width > 0 ? $"Looks like {panel.Width * 100 / id} × {panel.Height * 100 / id}" : "";
            list.Add(new ScaleOption { Id = id, Label = label, Detail = detail });
        }

        if (same > 0) Add(same, "Default");
        if (windows > 100 && windows < 200 && windows != same)
            Add(windows, same == 0 ? "Default" : windows > same ? "Larger Text" : "Smaller Text");
        Add(100, "More Space");
        if (list.Count < 3) Add(200, "Largest Text");
        recommended = same > 0 ? same : windows > 100 && windows < 200 ? windows : list[0].Id;
        foreach (var o in list) o.Recommended = o.Id == recommended;
        return list;
    }

    // ---- This exe's signature ----
    // True when Windows trusts this file's Authenticode signature, so UAC shows a publisher
    // instead of "Unknown". Offline: no revocation check, no downloads.
    public static bool IsSigned(string path)
    {
        if (string.IsNullOrEmpty(path)) return false;
        IntPtr file = IntPtr.Zero;
        var fileInfo = new WINTRUST_FILE_INFO { cbStruct = Marshal.SizeOf<WINTRUST_FILE_INFO>(), pcwszFilePath = path };
        try
        {
            file = Marshal.AllocHGlobal(Marshal.SizeOf<WINTRUST_FILE_INFO>());
            Marshal.StructureToPtr(fileInfo, file, false);
            var wd = new WINTRUST_DATA
            {
                cbStruct = Marshal.SizeOf<WINTRUST_DATA>(),
                dwUIChoice = 2,                  // WTD_UI_NONE
                fdwRevocationChecks = 0,         // WTD_REVOKE_NONE
                dwUnionChoice = 1,               // WTD_CHOICE_FILE
                pFile = file,
                dwStateAction = 1,               // WTD_STATEACTION_VERIFY
                dwProvFlags = 0x10 | 0x1000,     // WTD_REVOCATION_CHECK_NONE | WTD_CACHE_ONLY_URL_RETRIEVAL
            };
            var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");  // WINTRUST_ACTION_GENERIC_VERIFY_V2
            int result = WinVerifyTrust(new IntPtr(-1) /*INVALID_HANDLE_VALUE: no UI*/, ref action, ref wd);
            wd.dwStateAction = 2;                // WTD_STATEACTION_CLOSE
            WinVerifyTrust(new IntPtr(-1), ref action, ref wd);
            return result == 0;
        }
        catch (Exception e)
        {
            Log.Write("signature: " + e.Message);
            return false;
        }
        finally
        {
            if (file != IntPtr.Zero)
            {
                Marshal.DestroyStructure<WINTRUST_FILE_INFO>(file);
                Marshal.FreeHGlobal(file);
            }
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WINTRUST_FILE_INFO
    {
        public int cbStruct;
        [MarshalAs(UnmanagedType.LPWStr)] public string pcwszFilePath;
        public IntPtr hFile, pgKnownSubject;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct WINTRUST_DATA
    {
        public int cbStruct;
        public IntPtr pPolicyCallbackData, pSIPClientData;
        public int dwUIChoice, fdwRevocationChecks, dwUnionChoice;
        public IntPtr pFile;
        public int dwStateAction;
        public IntPtr hWVTStateData, pwszURLReference;
        public int dwProvFlags, dwUIContext;
        public IntPtr pSignatureSettings;
    }

    [DllImport("wintrust.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
    static extern int WinVerifyTrust(IntPtr hwnd, ref Guid action, ref WINTRUST_DATA data);
}

// HKCU\Software\USB-C Display: the values the watcher reads too (windows/watcher/UsbcWatcher.cs),
// and the place in setup (CONTRACT.md section 2, `setup`).
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

    // SetInt that only logs when the registry says no: setup carries on in memory.
    public static void Save(string name, int value)
    {
        try { SetInt(name, value); }
        catch (Exception e) { Log.Write($"settings: can't save {name}: {e.Message}"); }
    }

    public static int? Scale => GetInt("Scale");
    public static bool ColorManaged => GetInt("ColorManaged") != 0;   // on unless turned off
    public static bool Input => GetInt("Input") == 1;                 // off unless turned on
    public static bool SetupDone => GetInt("SetupDone") is int v && v != 0;

    // The place in setup.
    public static bool SetupStarted => GetInt("SetupStarted") == 1;
    public static string AxChoice => GetInt("AxChoice") switch { 1 => "yes", 2 => "no", _ => "" };
    public static bool LoginSkip => GetInt("LoginSkip") == 1;
    public static bool ElevationAsked => GetInt("ElevationAsked") == 1;
    public static int ElevationResult => GetInt("ElevationResult") ?? 0;   // 1 done, 2 refused, 3 failed
}
