using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;

namespace UsbcDisplay;

// Wire protocol v2, shared with mac/usbc-display.m (little-endian). Two TCP connections over
// the cable's IPv6 link-local addresses, both opened from here:
//   control: Hello (24 bytes) -> Welcome (with a token); then the pointer, heartbeats, clock sync
//            and goodbye. Messages from the Mac are 32 bytes (+ payload), from here 16 bytes.
//   frames:  Join with the token, then Frames from the Mac and Acks from here.
static class Proto
{
    public const uint Hello = 0x48444355, Welcome = 0x57444355, Join = 0x4A444355;  // "UCDH" "UCDW" "UCDJ"
    public const uint Frame = 0x46444355, Ack = 0x41444355;                         // "UCDF" "UCDA"
    public const uint Mouse = 0x4D444355, Shape = 0x53444355;                       // "UCDM" "UCDS"
    public const uint Beat = 0x42444355, Time = 0x54444355, Bye = 0x47444355;        // "UCDB" "UCDT" "UCDG"
    public const int HelloSize = 24, MacMsgSize = 32, RectHeaderSize = 16, WinMsgSize = 16;
    public const int EncRaw = 0, EncLz4 = 1, EncH264 = 2, EncRegion = 3;
    public const ushort HelloCanH264 = 1, HelloTestCard = 2, HelloVideoOnly = 4, HelloCursor = 8,
                        HelloV2 = 16, HelloH264Hybrid = 32, HelloLosslessOnly = 64, HelloTestDrag = 128,
                        HelloProfile = 256,  // this screen's colour profile follows the Hello
                        HelloInput = 512;    // this laptop's keyboard and trackpad drive the Mac (Input.cs)
    public const uint InputState = 0x4E444355;  // "UCDN" from the Mac: 1 = it may post input, 0 = needs permission
    public const uint Profile = 0x50444355;  // "UCDP": 16-byte header (magic, length) + ICC bytes
    public const uint AckWantKeyframe = 0xFFFFFFFF;

    // Setup status probe (windows/setup/CONTRACT.md): Query {actions, wizard version lo, hi} from
    // here, Info {status bits, version, macOS, refuse reason} from the Mac.
    public const uint Query = 0x51444355, Info = 0x49444355;                        // "UCDQ" "UCDI"
    public const uint QueryScreen = 1, QueryAccessibility = 2, QueryLoginItems = 4,
                      QueryRelaunch = 8, QueryMoveToApplications = 16;
    public const uint StatusScreenOk = 1, StatusAxOk = 2, StatusScreenPrompted = 4, StatusAxPrompted = 8,
                      StatusLoginItemEnabled = 16, StatusLoginItemNeedsApproval = 32, StatusSessionActive = 64,
                      StatusRunningAsAgent = 128, StatusInApplications = 256, StatusScreenNeedsRelaunch = 512,
                      // What's on the Mac's screen now (Mac app 4): the setup shows the same.
                      StatusSettingsFront = 1024, StatusPromptUp = 2048, StatusMacDark = 4096,
                      // Where the Mac's Displays settings put this screen, relative to the main
                      // display (at most one bit; none = not known yet), and the authentication
                      // sheet over System Settings (a password or Touch ID request is showing).
                      StatusDisplayRight = 8192, StatusDisplayLeft = 16384, StatusDisplayAbove = 32768,
                      StatusDisplayBelow = 65536, StatusAuthUp = 131072;
    public const uint RefuseNone = 0, RefuseNoScreenRecording = 1;
    // The handover when the picture starts (Mac app 4): the setup tells the Mac where its window
    // is ("UCDX" {x | y << 16, w | h << 16, dpi %} in panel pixels; w = 0 closes it) and mirrors
    // its state ("UCDE" {length} + JSON); the Mac's copy sends clicks back ("UCDC", 32 bytes:
    // {magic, length} + JSON) and tells the receiver once it's drawn ("UCDV" {first frame with it}).
    public const uint SetupWindow = 0x58444355, Mirror = 0x45444355, Click = 0x43444355, WindowReady = 0x56444355;
    public const ushort HelloStatus = 1024;  // answer a refused Hello with Info instead of closing

    // ptW x ptH: the size the Mac's display should look like, in points (0 = from the scale).
    public static byte[] MakeHello(ScreenInfo s, ushort flags, int ptW, int ptH)
    {
        var b = new byte[HelloSize];
        BinaryPrimitives.WriteUInt32LittleEndian(b, Hello);
        BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(4), 2);                  // version
        BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(6), flags);
        BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(8), (ushort)s.Width);
        BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(10), (ushort)s.Height);
        BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(12), (ushort)s.ScalePercent);
        BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(14), (ushort)s.Hz);
        BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(16), (ushort)s.WidthMm);
        BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(18), (ushort)s.HeightMm);
        BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(20), (ushort)ptW);
        BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(22), (ushort)ptH);
        return b;
    }

    // A 16-byte message to the Mac: magic, a, b, c.
    public static byte[] WinMsg(uint magic, uint a, uint b = 0, uint c = 0)
    {
        var m = new byte[WinMsgSize];
        BinaryPrimitives.WriteUInt32LittleEndian(m, magic);
        BinaryPrimitives.WriteUInt32LittleEndian(m.AsSpan(4), a);
        BinaryPrimitives.WriteUInt32LittleEndian(m.AsSpan(8), b);
        BinaryPrimitives.WriteUInt32LittleEndian(m.AsSpan(12), c);
        return m;
    }

    public static void ReadExactly(Socket s, Span<byte> buf)
    {
        while (buf.Length > 0)
        {
            int n = s.Receive(buf);
            if (n <= 0) throw new SocketException((int)SocketError.ConnectionReset);
            buf = buf[n..];
        }
    }
}

// This laptop panel's factory colour profile. The Mac colour-manages its display for it, the
// way it does for its own screen, so colours come out as intended within what the panel can
// show. ASUS installs one per panel model, named after the panel's EDID ID (CMN 1441 ->
// ..._AE0D1441.icm).
static unsafe class PanelProfile
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DisplayDevice
    {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
        public int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevicesW(string device, int index, ref DisplayDevice dd, int flags);

    public static string Find(string gdiDeviceName)
    {
        try
        {
            var dd = new DisplayDevice { cb = Marshal.SizeOf<DisplayDevice>() };
            if (!EnumDisplayDevicesW(gdiDeviceName, 0, ref dd, 0)) return null;  // the monitor on that output
            var parts = dd.DeviceID.Split('\\');                                 // MONITOR\CMN1441\{...}\0001
            if (parts.Length < 2 || parts[1].Length < 7) return null;
            string maker = parts[1][..3].ToUpperInvariant(), product = parts[1][3..7].ToUpperInvariant();
            int eisa = ((maker[0] - '@') << 10) | ((maker[1] - '@') << 5) | (maker[2] - '@');
            string tag = $"_{eisa & 0xFF:X2}{eisa >> 8:X2}{product}";
            string dir = System.IO.Path.Combine(Environment.SystemDirectory, @"spool\drivers\color");
            foreach (var f in System.IO.Directory.EnumerateFiles(dir, "*.ic*", System.IO.SearchOption.AllDirectories))
                if (System.IO.Path.GetFileNameWithoutExtension(f).ToUpperInvariant().EndsWith(tag)) return f;
        }
        catch { }
        return null;
    }
}

// Finds the Mac on the USB4 / Thunderbolt network that the cable creates.
static unsafe class Discovery
{
    [DllImport("iphlpapi.dll")] static extern int GetIpNetTable2(ushort family, IntPtr* table);
    [DllImport("iphlpapi.dll")] static extern void FreeMibTable(IntPtr table);

    public static Socket Connect(string host, int port)
    {
        if (host != null)
        {
            var addrs = IPAddress.TryParse(host, out var ip) ? new[] { ip } : Dns.GetHostAddresses(host);
            foreach (var a in addrs)
                if (TryConnect(a, port, 2000) is Socket s) return s;
            return null;
        }
        foreach (var a in CableNeighbors())
            if (TryConnect(a, port, 500) is Socket s) return s;
        return null;
    }

    public static List<string> CableInterfaces()
    {
        var names = new List<string>();
        foreach (var (name, _) in CableInterfaceIndexes()) names.Add(name);
        return names;
    }

    static IEnumerable<(string name, int index)> CableInterfaceIndexes()
    {
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != OperationalStatus.Up) continue;
            string d = ni.Description;
            if (!d.Contains("USB4") && !d.Contains("Thunderbolt") && !d.Contains("P2P Network")) continue;
            int index;
            try { index = ni.GetIPProperties().GetIPv6Properties().Index; } catch { continue; }
            yield return (ni.Name, index);
        }
    }

    // Link-local IPv6 neighbours on the cable interfaces (in practice: the Mac).
    static List<IPAddress> CableNeighbors()
    {
        var found = new List<IPAddress>();
        foreach (var (_, index) in CableInterfaceIndexes())
        {
            // An all-nodes ping makes the Mac answer, which puts it in the neighbour table.
            try
            {
                using var p = Process.Start(new ProcessStartInfo("ping.exe", $"-n 1 -w 300 ff02::1%{index}")
                    { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true });
                p.WaitForExit(1500);
            }
            catch { }

            IntPtr table;
            if (GetIpNetTable2(23 /*AF_INET6*/, &table) != 0) continue;
            try
            {
                int count = *(int*)table;
                byte* row = (byte*)table + 8;
                for (int i = 0; i < count; i++, row += 88)                  // sizeof(MIB_IPNET_ROW2)
                {
                    int ifIndex = *(int*)(row + 28), state = *(int*)(row + 76);
                    if (ifIndex != index || state < 2 || state > 5) continue; // probe..reachable
                    var bytes = new ReadOnlySpan<byte>(row + 8, 16);          // sockaddr_in6.sin6_addr
                    if (bytes[0] != 0xfe || (bytes[1] & 0xc0) != 0x80) continue;
                    found.Add(new IPAddress(bytes, index));
                }
            }
            finally { FreeMibTable(table); }
        }
        return found;
    }

    // The frame connection: same address as the control connection.
    public static Socket ConnectTo(IPEndPoint ep, int timeoutMs) => TryConnect(ep.Address, ep.Port, timeoutMs);

    static Socket TryConnect(IPAddress a, int port, int timeoutMs)
    {
        var s = new Socket(a.AddressFamily, SocketType.Stream, ProtocolType.Tcp)
        {
            NoDelay = true,
            ReceiveBufferSize = 32 << 20,
        };
        try
        {
            if (s.ConnectAsync(a, port).Wait(timeoutMs) && s.Connected) return s;
        }
        catch { }
        s.Dispose();
        return null;
    }
}

// The USB4 network between Windows and macOS can wedge after a few GB: the adapter stays
// "Up" but nothing gets through either way until the USB4 connection is restarted.
static class LinkRecovery
{
    public static bool IsWedged(IPAddress mac)
    {
        if (!mac.IsIPv6LinkLocal) return false;
        bool adapterUp = false;
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            try
            {
                if (ni.GetIPProperties().GetIPv6Properties().Index == mac.ScopeId)
                    adapterUp = ni.OperationalStatus == OperationalStatus.Up;
            }
            catch { }
        }
        if (!adapterUp) return false;  // unplugged, not wedged
        using var ping = new Ping();
        for (int i = 0; i < 4; i++)
        {
            try { if (ping.Send(mac, 1000).Status == IPStatus.Success) return false; } catch { }
        }
        return true;
    }

    // Restarts the USB4 router device: the software equivalent of replugging the cable.
    // Uses the task tools\register-recovery-task.ps1 set up (no prompt), after checking it still
    // runs exactly that command; otherwise asks Windows for permission.
    const string TaskName = @"\USB-C Display\Restart USB4 link";
    const string TaskCommand = @"C:\Windows\System32\pnputil.exe";
    const string TaskArgs = "/restart-device /deviceid \"USB4\\ROOT_DEVICE_ROUTER&VID_QCOM&PID_0CD1\"";

    public static bool HasSilentRestart()
    {
        try
        {
            var psi = new ProcessStartInfo("schtasks.exe", $"/query /tn \"{TaskName}\" /xml")
            { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
            using var p = Process.Start(psi);
            string xml = p.StandardOutput.ReadToEnd();
            p.WaitForExit(5000);
            if (p.ExitCode != 0) return false;
            var doc = System.Xml.Linq.XDocument.Parse(xml);
            var ns = doc.Root.Name.Namespace;
            var execs = new List<System.Xml.Linq.XElement>(doc.Root.Element(ns + "Actions")?.Elements(ns + "Exec") ?? Array.Empty<System.Xml.Linq.XElement>());
            return execs.Count == 1 &&
                   string.Equals((string)execs[0].Element(ns + "Command"), TaskCommand, StringComparison.OrdinalIgnoreCase) &&
                   (string)execs[0].Element(ns + "Arguments") == TaskArgs;
        }
        catch { return false; }
    }

    public static bool Restart()
    {
        if (HasSilentRestart())
        {
            using var p = Process.Start(new ProcessStartInfo("schtasks.exe", $"/run /tn \"{TaskName}\"")
                { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true });
            p.WaitForExit(10000);
            if (p.ExitCode == 0) return true;
        }
        var psi = new ProcessStartInfo("powershell.exe",
            "-NoProfile -Command \"Get-PnpDevice -PresentOnly | Where-Object InstanceId -like 'USB4\\ROOT_DEVICE_ROUTER*' | " +
            "ForEach-Object { pnputil /restart-device $_.InstanceId }\"")
        { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
        try
        {
            using var p = Process.Start(psi);
            p.WaitForExit(30000);
            return true;
        }
        catch (System.ComponentModel.Win32Exception) { return false; }  // permission declined
    }

    public static bool AdapterUp(int ifIndex)
    {
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            try
            {
                if (ni.GetIPProperties().GetIPv6Properties().Index == ifIndex)
                    return ni.OperationalStatus == OperationalStatus.Up;
            }
            catch { }
        }
        return false;
    }

    public static bool WaitForMac(IPAddress mac, int seconds)
    {
        using var ping = new Ping();
        var until = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < until)
        {
            try { if (ping.Send(mac, 1000).Status == IPStatus.Success) return true; } catch { Thread.Sleep(1000); }
        }
        return false;
    }
}

// LZ4 block decoder (matches COMPRESSION_LZ4_RAW from Apple's Compression framework).
static unsafe class Lz4
{
    public static int Decode(byte* src, int srcLen, byte* dst, int dstCap)
    {
        byte* ip = src, iend = src + srcLen, op = dst, oend = dst + dstCap;
        while (ip < iend)
        {
            int token = *ip++;
            int lit = token >> 4;
            if (lit == 15) { int b; do { if (ip >= iend) return -1; b = *ip++; lit += b; } while (b == 255); }
            if (lit > iend - ip || lit > oend - op) return -1;
            Buffer.MemoryCopy(ip, op, lit, lit);
            ip += lit;
            op += lit;
            if (ip >= iend) break;                       // the last sequence is literals only

            if (iend - ip < 2) return -1;
            int offset = ip[0] | ip[1] << 8;
            ip += 2;
            int len = token & 15;
            if (len == 15) { int b; do { if (ip >= iend) return -1; b = *ip++; len += b; } while (b == 255); }
            len += 4;
            byte* match = op - offset;
            if (offset == 0 || match < dst || len > oend - op) return -1;
            // Overlapping copies repeat the pattern; copy in chunks that never overlap.
            while (len > 0)
            {
                int n = (int)Math.Min(op - match, len);
                Buffer.MemoryCopy(match, op, n, n);
                op += n;
                len -= n;
            }
        }
        return (int)(op - dst);
    }
}
