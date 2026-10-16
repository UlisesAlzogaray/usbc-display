using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;

namespace UsbcSetup;

// The network the USB-C cable creates (USB4 P2P Network Adapter), and the Mac on it.
sealed class CableInfo
{
    public string Name = "";
    public int Index;            // interface index (the IPv6 scope id)
    public IPAddress LaptopV6;   // this laptop's link-local address on the cable
    public IPAddress LaptopV4;   // this laptop's 169.254 address on the cable, once Windows has picked one
}

static unsafe class Cable
{
    // Same matching as the watcher (UsbcWatcher.cs CableUp).
    static bool IsCable(NetworkInterface ni)
    {
        string d = ni.Description ?? "";
        return d.Contains("USB4") || d.Contains("Thunderbolt") || d.Contains("P2P Network");
    }

    public static CableInfo Find()
    {
        NetworkInterface[] all;
        try { all = NetworkInterface.GetAllNetworkInterfaces(); } catch { return null; }
        foreach (var ni in all)
        {
            if (ni.OperationalStatus != OperationalStatus.Up || !IsCable(ni)) continue;
            var info = new CableInfo { Name = ni.Name };
            try
            {
                var props = ni.GetIPProperties();
                try { info.Index = props.GetIPv6Properties().Index; } catch { }
                if (info.Index == 0) try { info.Index = props.GetIPv4Properties().Index; } catch { }
                foreach (var u in props.UnicastAddresses)
                {
                    if (u.DuplicateAddressDetectionState is DuplicateAddressDetectionState.Tentative or DuplicateAddressDetectionState.Duplicate)
                        continue;
                    var a = u.Address;
                    if (a.AddressFamily == AddressFamily.InterNetworkV6 && a.IsIPv6LinkLocal) info.LaptopV6 ??= a;
                    else if (a.AddressFamily == AddressFamily.InterNetwork && IsLinkLocalV4(a)) info.LaptopV4 ??= a;
                }
            }
            catch { }
            if (info.Index != 0) return info;
        }
        return null;
    }

    public static bool IsLinkLocalV4(IPAddress a)
    {
        if (a.AddressFamily != AddressFamily.InterNetwork) return false;
        var b = a.GetAddressBytes();
        return b[0] == 169 && b[1] == 254 && b[2] != 0 && b[2] != 255;
    }

    // An all-nodes ping makes the Mac answer, which puts it in the neighbour table
    // (Link.cs does the same). Fire and forget: the output isn't read, so the language doesn't matter.
    public static void PokeAllNodes(int index)
    {
        try
        {
            var p = Process.Start(new ProcessStartInfo("ping.exe", $"-n 1 -w 300 ff02::1%{index}")
                { CreateNoWindow = true, UseShellExecute = false });
            p?.Dispose();
        }
        catch { }
    }

    [DllImport("iphlpapi.dll")] static extern int GetIpNetTable2(ushort family, IntPtr* table);
    [DllImport("iphlpapi.dll")] static extern void FreeMibTable(IntPtr table);

    // The Mac's addresses in the neighbour table on the cable interface: link-local IPv6 and
    // 169.254 IPv4. GetIpNetTable2 rather than netsh, whose output follows the Windows language.
    // The current address (keep) wins while it's still listed, then the freshest entry:
    // reachable, then delay, probe, stale (an old plug can leave a stale one behind).
    public static (IPAddress v6, IPAddress v4) Neighbors(CableInfo cable, IPAddress keep)
    {
        IPAddress v6 = null, v4 = null;
        int rank6 = 0, rank4 = 0;
        IntPtr table;
        if (GetIpNetTable2(0 /*AF_UNSPEC*/, &table) != 0) return (null, null);
        try
        {
            int count = *(int*)table;
            byte* row = (byte*)table + 8;
            for (int i = 0; i < count; i++, row += 88)                     // sizeof(MIB_IPNET_ROW2)
            {
                int family = *(ushort*)row, ifIndex = *(int*)(row + 28), state = *(int*)(row + 76);
                int macLen = *(int*)(row + 72);
                if (ifIndex != cable.Index || state < 2 || state > 5 || macLen == 0) continue;  // probe..reachable
                int rank = state switch { 5 => 4, 3 => 3, 2 => 2, _ => 1 };  // reachable, delay, probe, stale
                if (family == 23 /*AF_INET6*/)
                {
                    var bytes = new ReadOnlySpan<byte>(row + 8, 16);
                    if (bytes[0] != 0xfe || (bytes[1] & 0xc0) != 0x80) continue;
                    var a = new IPAddress(bytes, cable.Index);
                    if (a.Equals(cable.LaptopV6)) continue;
                    if (a.Equals(keep)) rank = 9;
                    if (rank > rank6) { v6 = a; rank6 = rank; }
                }
                else if (family == 2 /*AF_INET*/)
                {
                    var a = new IPAddress(new ReadOnlySpan<byte>(row + 4, 4));
                    if (IsLinkLocalV4(a) && !a.Equals(cable.LaptopV4) && rank > rank4) { v4 = a; rank4 = rank; }
                }
            }
        }
        finally { FreeMibTable(table); }
        return (v6, v4);
    }

    // "fe80::1%12" -> "fe80::1"; the scope is this laptop's interface number, meaningless to people.
    public static string Plain(IPAddress a)
    {
        if (a == null) return "";
        string s = a.ToString();
        int pct = s.IndexOf('%');
        return pct > 0 ? s[..pct] : s;
    }
}
