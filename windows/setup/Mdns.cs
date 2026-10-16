using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace UsbcSetup;

// Answers "usbc.local" on the cable only, so Safari on the Mac can open http://usbc.local.
// A minimal multicast DNS responder (RFC 6762): A and AAAA for one name, nothing else. It
// shares UDP 5353 with Windows' own mDNS (address reuse) and ignores packets from other networks.
//
// It also notices the Mac's own mDNS traffic: a packet from a 169.254 address on the cable is
// proof the Mac has its IPv4 address there (it takes ~20 s after plugging in, PLAN.md:117).
sealed class Mdns
{
    public const string HostName = "usbc.local";
    static readonly IPAddress GroupV4 = IPAddress.Parse("224.0.0.251");
    static readonly IPAddress GroupV6 = IPAddress.Parse("ff02::fb");
    const int Port = 5353, Ttl = 120;

    readonly Action<IPAddress> onMacV4;
    volatile Socket v4, v6;
    volatile CableInfo cable;
    volatile bool running;
    volatile int generation;
    public string BoundTo = "";

    public Mdns(Action<IPAddress> onMacV4) { this.onMacV4 = onMacV4; }

    public bool Running => running;

    public static string KeyFor(CableInfo c) => $"{c.Index},{c.LaptopV6},{c.LaptopV4}";

    readonly object gate = new();

    // Opens what's missing for the cable's current addresses and keeps what already works.
    // Announces whenever the addresses change.
    public void Start(CableInfo c)
    {
        lock (gate)
        {
            var old = cable;
            bool fresh = !running || old == null || old.Index != c.Index;
            if (fresh) StopLocked();
            cable = c;
            running = true;
            if (v4 != null && !Equals(c.LaptopV4, old?.LaptopV4)) { try { v4.Dispose(); } catch { } v4 = null; }  // joined by address
            if (v6 == null && c.LaptopV6 != null) v6 = Open(AddressFamily.InterNetworkV6, c);
            if (v4 == null && c.LaptopV4 != null) v4 = Open(AddressFamily.InterNetwork, c);
            BoundTo = $"{c.Index},{(v6 != null ? c.LaptopV6 : null)},{(v4 != null ? c.LaptopV4 : null)}";
            if (v4 == null && v6 == null) { running = false; return; }
            if (fresh || !Equals(c.LaptopV4, old.LaptopV4) || !Equals(c.LaptopV6, old.LaptopV6))
            {
                int gen = ++generation;
                new Thread(() => Announce(gen)) { IsBackground = true, Name = "mDNS announce" }.Start();
            }
        }
    }

    public void Stop() { lock (gate) StopLocked(); }

    void StopLocked()
    {
        running = false;
        generation++;
        try { v4?.Dispose(); } catch { }
        try { v6?.Dispose(); } catch { }
        v4 = v6 = null;
        BoundTo = "";
    }

    Socket Open(AddressFamily family, CableInfo c)
    {
        var s = new Socket(family, SocketType.Dgram, ProtocolType.Udp);
        try
        {
            s.ExclusiveAddressUse = false;
            s.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            if (family == AddressFamily.InterNetworkV6)
            {
                s.SetSocketOption(SocketOptionLevel.IPv6, SocketOptionName.IPv6Only, true);
                s.Bind(new IPEndPoint(IPAddress.IPv6Any, Port));
                s.SetSocketOption(SocketOptionLevel.IPv6, SocketOptionName.AddMembership, new IPv6MulticastOption(GroupV6, c.Index));
                s.SetSocketOption(SocketOptionLevel.IPv6, SocketOptionName.MulticastInterface, c.Index);
                s.SetSocketOption(SocketOptionLevel.IPv6, SocketOptionName.MulticastTimeToLive, 255);
                s.SetSocketOption(SocketOptionLevel.IPv6, SocketOptionName.PacketInformation, true);
            }
            else
            {
                s.Bind(new IPEndPoint(IPAddress.Any, Port));
                s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.AddMembership, new MulticastOption(GroupV4, c.LaptopV4));
                s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastInterface, c.LaptopV4.GetAddressBytes());
                s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastTimeToLive, 255);
                s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.PacketInformation, true);
            }
            new Thread(() => Receive(s)) { IsBackground = true, Name = "mDNS " + family }.Start();
            Log.Write($"mdns: listening ({family}) on interface {c.Index}");
            return s;
        }
        catch (Exception e)
        {
            Log.Write($"mdns: can't listen ({family}): {e.Message}");
            s.Dispose();
            return null;
        }
    }

    // Tells the cable about the name when the link comes up (twice, a second apart, per RFC 6762 8.3).
    void Announce(int gen)
    {
        for (int i = 0; i < 2 && running && gen == generation; i++)
        {
            SendMulticast(v6, BuildResponse(0, null, wantA: true, wantAAAA: true, cacheFlush: true));
            SendMulticast(v4, BuildResponse(0, null, wantA: true, wantAAAA: true, cacheFlush: true));
            Thread.Sleep(1000);
        }
        // Until the Mac's IPv4 shows up, ask the cable which services exist: the Mac's answer
        // comes from its 169.254 address once it has one.
        while (running && gen == generation)
        {
            Thread.Sleep(3000);
            if (v4 != null && !macV4Seen) SendMulticast(v4, BuildQuery("_services._dns-sd._udp.local", 12 /*PTR*/));
        }
    }

    volatile bool macV4Seen;
    public void ResetMacV4() => macV4Seen = false;

    void SendMulticast(Socket s, byte[] packet)
    {
        if (s == null || packet == null) return;
        try
        {
            var to = s.AddressFamily == AddressFamily.InterNetworkV6
                ? new IPEndPoint(new IPAddress(GroupV6.GetAddressBytes(), cable.Index), Port)
                : new IPEndPoint(GroupV4, Port);
            s.SendTo(packet, to);
        }
        catch { }
    }

    void Receive(Socket s)
    {
        var buf = new byte[9000];
        while (running)
        {
            EndPoint from = s.AddressFamily == AddressFamily.InterNetworkV6
                ? new IPEndPoint(IPAddress.IPv6Any, 0) : new IPEndPoint(IPAddress.Any, 0);
            int n;
            IPPacketInformation info;
            try
            {
                var flags = SocketFlags.None;
                n = s.ReceiveMessageFrom(buf, 0, buf.Length, ref flags, ref from, out info);
            }
            catch (ObjectDisposedException) { return; }
            catch (SocketException e) when (e.SocketErrorCode == SocketError.MessageSize || e.SocketErrorCode == SocketError.ConnectionReset) { continue; }
            catch (Exception) { if (!running) return; Thread.Sleep(100); continue; }

            var src = (IPEndPoint)from;
            // The cable only: arrived on its interface, from a link-local address that isn't ours.
            if (info.Interface != cable.Index) continue;
            if (src.Address.Equals(cable.LaptopV4) || Cable.Plain(src.Address) == Cable.Plain(cable.LaptopV6)) continue;
            bool linkLocal = src.AddressFamily == AddressFamily.InterNetworkV6 ? src.Address.IsIPv6LinkLocal : Cable.IsLinkLocalV4(src.Address);
            if (!linkLocal) continue;
            if (src.AddressFamily == AddressFamily.InterNetwork && !macV4Seen)
            {
                macV4Seen = true;
                onMacV4?.Invoke(src.Address);
            }
            try { Handle(s, buf, n, src); } catch { }  // a malformed packet is just ignored
        }
    }

    void Handle(Socket s, byte[] p, int n, IPEndPoint src)
    {
        if (n < 12) return;
        int id = p[0] << 8 | p[1], flags = p[2] << 8 | p[3], qd = p[4] << 8 | p[5];
        if ((flags & 0x8000) != 0 || (flags & 0x7800) != 0 || qd == 0 || qd > 32) return;  // queries only, standard opcode
        int at = 12;
        bool wantA = false, wantAAAA = false, unicast = false;
        for (int i = 0; i < qd; i++)
        {
            string name = ReadName(p, n, ref at);
            if (name == null || at + 4 > n) return;
            int type = p[at] << 8 | p[at + 1], cls = p[at + 2] << 8 | p[at + 3];
            at += 4;
            if (!string.Equals(name, HostName, StringComparison.OrdinalIgnoreCase)) continue;
            if ((cls & 0x7FFF) != 1 && (cls & 0x7FFF) != 255) continue;
            if (type == 1 || type == 255) wantA = true;
            if (type == 28 || type == 255) wantAAAA = true;
            if ((cls & 0x8000) != 0) unicast = true;  // QU: the asker wants a direct answer
        }
        if (!wantA && !wantAAAA) return;

        bool legacy = src.Port != Port;  // a plain DNS client (RFC 6762 6.7): answer it directly, echoing the id
        var reply = BuildResponse(legacy ? id : 0, legacy ? HostName : null, wantA, wantAAAA, cacheFlush: !legacy);
        if (reply == null) return;
        if (legacy || unicast) s.SendTo(reply, src);
        else SendMulticast(s, reply);
    }

    // Reads a (possibly compressed) name; null if malformed. Bounded against loops.
    static string ReadName(byte[] p, int n, ref int at)
    {
        var sb = new StringBuilder();
        int pos = at, jumps = 0;
        bool jumped = false;
        while (true)
        {
            if (pos >= n) return null;
            int len = p[pos];
            if (len == 0) { pos++; break; }
            if ((len & 0xC0) == 0xC0)
            {
                if (pos + 1 >= n || ++jumps > 16) return null;
                int target = (len & 0x3F) << 8 | p[pos + 1];
                if (!jumped) at = pos + 2;
                jumped = true;
                if (target >= n) return null;
                pos = target;
                continue;
            }
            if ((len & 0xC0) != 0 || pos + 1 + len > n || sb.Length > 255) return null;
            if (sb.Length > 0) sb.Append('.');
            sb.Append(Encoding.UTF8.GetString(p, pos + 1, len));
            pos += 1 + len;
        }
        if (!jumped) at = pos;
        return sb.ToString();
    }

    // Answers first (what was asked), the other address type as an additional record.
    byte[] BuildResponse(int id, string question, bool wantA, bool wantAAAA, bool cacheFlush)
    {
        var answers = new List<(int type, byte[] data)>();
        var extra = new List<(int type, byte[] data)>();
        var a = cable.LaptopV4?.GetAddressBytes();
        var aaaa = cable.LaptopV6?.GetAddressBytes();
        if (a != null) (wantA ? answers : extra).Add((1, a));
        if (aaaa != null) (wantAAAA ? answers : extra).Add((28, aaaa));
        if (answers.Count == 0) return null;

        var o = new List<byte>(256);
        void U16(int v) { o.Add((byte)(v >> 8)); o.Add((byte)v); }
        void U32(int v) { U16(v >> 16); U16(v & 0xFFFF); }
        void Name() { foreach (var label in HostName.Split('.')) { o.Add((byte)label.Length); o.AddRange(Encoding.ASCII.GetBytes(label)); } o.Add(0); }

        U16(id);
        U16(0x8400);                          // response, authoritative
        U16(question != null ? 1 : 0);
        U16(answers.Count);
        U16(0);
        U16(question != null ? 0 : extra.Count);
        if (question != null) { Name(); U16(answers[0].type); U16(1); }
        foreach (var (type, data) in question != null ? answers : Concat(answers, extra))
        {
            Name();
            U16(type);
            U16(cacheFlush ? 0x8001 : 1);
            U32(question != null ? 10 : Ttl);
            U16(data.Length);
            o.AddRange(data);
        }
        return o.ToArray();
    }

    static IEnumerable<T> Concat<T>(List<T> a, List<T> b) { foreach (var x in a) yield return x; foreach (var x in b) yield return x; }

    static byte[] BuildQuery(string name, int type)
    {
        var o = new List<byte>(64) { 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0 };
        foreach (var label in name.Split('.')) { o.Add((byte)label.Length); o.AddRange(Encoding.ASCII.GetBytes(label)); }
        o.Add(0);
        o.Add((byte)(type >> 8)); o.Add((byte)type);
        o.Add(0); o.Add(1);
        return o.ToArray();
    }
}
