// UsbcSink: the Windows end of the USB4 link experiments (a test tool, not part of the product).
//
// Connects to usbc-bench on the Mac (tools/linkbench), asks it for a stream, acknowledges every
// frame the moment it has arrived (no Direct3D, no window, no link recovery), and logs the cable
// adapter's counters 10 times a second. Prints one JSON summary line at the end.
// Exit code: 0 = completed, 2 = wedged, 1 = error.
using System;
using System.Buffers.Binary;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Threading;

static class Sink
{
    const uint Req = 0x52424355, Frm = 0x46424355, AckMagic = 0x41424355;
    const uint ProbeMagic = 0x50424355, EchoMagic = 0x45424355, MacProbeMagic = 0x51424355;
    const int F_IpOpt = 1, F_V6Opt = 2, F_Reverse = 4, F_NoNodelay = 8, F_Small = 16;

    // options
    static string macAddr = "fe80::18e3:e082:52fa:63d5%48", mac4 = "169.254.230.136", local4 = "169.254.29.64";
    static string ifName = "Ethernet 4", logPath;
    static bool v4, ipopt, v6opt, reverse, noNodelay, small;
    static int port = 48200, frameBytes = 9216000, inflight = 2, fps, paceMBps, writeBytes, sndbuf, rcvbuf = 32 << 20, runId = 1;
    static double totalGB = 10, rotateMB, maxSeconds = 900;

    // live counters
    static long appBytes, frames, stalls, maxGapTicks, intervalMaxGapTicks, lastProgress;
    static long udpSent, udpEcho, udpMac, lastEchoAt, lastMacAt;
    static volatile bool finished;

    static int Main(string[] args)
    {
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            string Next() => args[++i];
            switch (a)
            {
                case "--mac": macAddr = Next(); break;
                case "--mac4": mac4 = Next(); break;
                case "--local4": local4 = Next(); break;
                case "--v4": v4 = true; break;
                case "--ipopt": ipopt = true; break;
                case "--v6opt": v6opt = true; break;
                case "--reverse": reverse = true; break;
                case "--no-nodelay": noNodelay = true; break;
                case "--small": small = true; break;
                case "--port": port = int.Parse(Next()); break;
                case "--frame": frameBytes = int.Parse(Next()); break;
                case "--inflight": inflight = int.Parse(Next()); break;
                case "--fps": fps = int.Parse(Next()); break;
                case "--pace": paceMBps = int.Parse(Next()); break;
                case "--wsize": writeBytes = int.Parse(Next()); break;
                case "--sndbuf": sndbuf = int.Parse(Next()); break;
                case "--rcvbuf": rcvbuf = int.Parse(Next()); break;
                case "--total": totalGB = double.Parse(Next(), CultureInfo.InvariantCulture); break;
                case "--rotate": rotateMB = double.Parse(Next(), CultureInfo.InvariantCulture); break;
                case "--seconds": maxSeconds = double.Parse(Next(), CultureInfo.InvariantCulture); break;
                case "--run": runId = int.Parse(Next()); break;
                case "--log": logPath = Next(); break;
                case "--if": ifName = Next(); break;
                default: Console.Error.WriteLine("unknown option " + a); return 1;
            }
        }
        logPath ??= Path.Combine(Path.GetTempPath(), $"usbc-sink-run{runId}.csv");

        var nic = NetworkInterface.GetAllNetworkInterfaces().FirstOrDefault(n => n.Name == ifName);
        if (nic == null) { Summary("error", "no adapter " + ifName, null, 0); return 1; }
        var st0 = nic.GetIPStatistics();
        var sw = Stopwatch.StartNew();
        lastProgress = sw.ElapsedTicks;

        var udp = new Thread(() => UdpProber(sw)) { IsBackground = true };
        udp.Start();

        // 10 Hz log
        string wedgeReason = null;
        var sampler = new Thread(() =>
        {
            using var f = new StreamWriter(logPath);
            f.WriteLine("t_ms,app_bytes,frames,max_gap_ms,if_rx_bytes,if_rx_pkts,if_tx_bytes,if_tx_pkts,udp_echo,udp_mac");
            while (!finished)
            {
                var s = nic.GetIPStatistics();
                long gap = Interlocked.Exchange(ref intervalMaxGapTicks, 0);
                f.WriteLine(string.Join(",", sw.ElapsedMilliseconds, Interlocked.Read(ref appBytes), Interlocked.Read(ref frames),
                    (gap * 1000.0 / Stopwatch.Frequency).ToString("F1", CultureInfo.InvariantCulture),
                    s.BytesReceived - st0.BytesReceived, s.UnicastPacketsReceived - st0.UnicastPacketsReceived,
                    s.BytesSent - st0.BytesSent, s.UnicastPacketsSent - st0.UnicastPacketsSent,
                    Interlocked.Read(ref udpEcho), Interlocked.Read(ref udpMac)));
                f.Flush();
                Thread.Sleep(100);
            }
        }) { IsBackground = true };
        sampler.Start();

        long total = (long)(totalGB * 1e9);
        string result = "done", detail = null;
        int connNo = 0;
        Socket s = null;
        try
        {
            s = Connect(++connNo, total);
            if (s == null) { finished = true; Summary("error", "connect failed", nic.GetIPStatistics().Diff(st0), sw.Elapsed.TotalSeconds); return 1; }
            var watchdog = new Thread(() =>
            {
                while (!finished)
                {
                    Thread.Sleep(100);
                    double idle = (sw.ElapsedTicks - Interlocked.Read(ref lastProgress)) / (double)Stopwatch.Frequency;
                    if (idle > 3 && wedgeReason == null)
                    {
                        wedgeReason = $"no data for 3 s after {Interlocked.Read(ref appBytes) / 1e9:F3} GB";
                        try { s?.Dispose(); } catch { }
                    }
                    if (sw.Elapsed.TotalSeconds > maxSeconds && wedgeReason == null) { detail = "time limit"; try { s?.Dispose(); } catch { } }
                }
            }) { IsBackground = true };
            watchdog.Start();

            if (reverse) SendFrames(s, total, sw);
            else ReceiveFrames(ref s, ref connNo, total, sw);
        }
        catch (Exception e)
        {
            if (wedgeReason == null && detail == null) { result = "error"; detail = e.GetType().Name + ": " + e.Message; }
        }
        if (wedgeReason != null)
        {
            result = "wedge";
            detail = wedgeReason;
            // Keep probing for 10 s: do UDP probes still get through, and in which direction?
            long e0 = Interlocked.Read(ref udpEcho), m0 = Interlocked.Read(ref udpMac), s0 = Interlocked.Read(ref udpSent);
            Thread.Sleep(10000);
            detail += $"; in the 10 s after: {Interlocked.Read(ref udpSent) - s0} probes sent, {Interlocked.Read(ref udpEcho) - e0} echoed, {Interlocked.Read(ref udpMac) - m0} Mac probes received";
        }
        finished = true;
        try { s?.Dispose(); } catch { }
        Thread.Sleep(150);
        Summary(result, detail, nic.GetIPStatistics().Diff(st0), sw.Elapsed.TotalSeconds);
        return result == "wedge" ? 2 : result == "error" ? 1 : 0;
    }

    static Socket Connect(int connNo, long total)
    {
        Socket s;
        IPEndPoint ep;
        if (v4)
        {
            s = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
            s.Bind(new IPEndPoint(IPAddress.Parse(local4), 0));  // 169.254/16 is routed via Wi-Fi too
            ep = new IPEndPoint(IPAddress.Parse(mac4), port);
        }
        else
        {
            s = new Socket(AddressFamily.InterNetworkV6, SocketType.Stream, ProtocolType.Tcp);
            ep = new IPEndPoint(IPAddress.Parse(macAddr), port);
        }
        s.NoDelay = true;
        s.ReceiveBufferSize = rcvbuf;
        try
        {
            if (!s.ConnectAsync(ep).Wait(3000)) { s.Dispose(); return null; }
        }
        catch { s.Dispose(); return null; }
        var req = new byte[48];
        int flags = (ipopt ? F_IpOpt : 0) | (v6opt ? F_V6Opt : 0) | (reverse ? F_Reverse : 0) | (noNodelay ? F_NoNodelay : 0) | (small ? F_Small : 0);
        uint[] w = { Req, (uint)flags, (uint)frameBytes, (uint)inflight, (uint)fps, (uint)paceMBps };
        for (int i = 0; i < w.Length; i++) BinaryPrimitives.WriteUInt32LittleEndian(req.AsSpan(i * 4), w[i]);
        BinaryPrimitives.WriteUInt64LittleEndian(req.AsSpan(24), (ulong)total);
        BinaryPrimitives.WriteUInt32LittleEndian(req.AsSpan(32), (uint)writeBytes);
        BinaryPrimitives.WriteUInt32LittleEndian(req.AsSpan(36), (uint)sndbuf);
        BinaryPrimitives.WriteUInt32LittleEndian(req.AsSpan(40), (uint)runId);
        BinaryPrimitives.WriteUInt32LittleEndian(req.AsSpan(44), (uint)connNo);
        s.Send(req);
        return s;
    }

    static void Progress(Stopwatch sw, long n)
    {
        Interlocked.Add(ref appBytes, n);
        Interlocked.Exchange(ref lastProgress, sw.ElapsedTicks);
    }

    static void ReceiveFrames(ref Socket s, ref int connNo, long total, Stopwatch sw)
    {
        var hdr = new byte[24];
        var buf = new byte[1 << 20];
        var ack = new byte[16];
        long lastFrameAt = sw.ElapsedTicks, onConn = 0;
        long rotateBytes = (long)(rotateMB * 1e6);
        while (true)
        {
            if (!ReadExactly(s, hdr, hdr.Length, sw)) return;  // the Mac closed: run complete
            if (BinaryPrimitives.ReadUInt32LittleEndian(hdr) != Frm) throw new IOException("bad frame header");
            uint seq = BinaryPrimitives.ReadUInt32LittleEndian(hdr.AsSpan(4));
            long len = BinaryPrimitives.ReadUInt32LittleEndian(hdr.AsSpan(8));
            while (len > 0)
            {
                int n = s.Receive(buf, 0, (int)Math.Min(len, buf.Length), SocketFlags.None);
                if (n <= 0) throw new IOException("closed mid-frame");
                len -= n;
                onConn += n;
                Progress(sw, n);
            }
            BinaryPrimitives.WriteUInt32LittleEndian(ack, AckMagic);
            BinaryPrimitives.WriteUInt32LittleEndian(ack.AsSpan(4), seq);
            s.Send(ack);
            Interlocked.Increment(ref frames);
            long t = sw.ElapsedTicks, gap = t - lastFrameAt;
            lastFrameAt = t;
            if (gap > Interlocked.Read(ref intervalMaxGapTicks)) Interlocked.Exchange(ref intervalMaxGapTicks, gap);
            if (gap > maxGapTicks) maxGapTicks = gap;
            if (gap > Stopwatch.Frequency / 20) stalls++;
            if (rotateBytes > 0 && onConn >= rotateBytes && Interlocked.Read(ref appBytes) < total)
            {
                // Open the next connection before dropping this one, as a product would.
                var next = Connect(++connNo, total - Interlocked.Read(ref appBytes));
                if (next == null) throw new IOException("rotate: connect failed");
                var old = s;
                s = next;
                old.Dispose();
                onConn = 0;
            }
        }
    }

    static bool ReadExactly(Socket s, byte[] b, int n, Stopwatch sw)
    {
        int got = 0;
        while (got < n)
        {
            int k = s.Receive(b, got, n - got, SocketFlags.None);
            if (k <= 0) { if (got == 0) return false; throw new IOException("closed mid-header"); }
            got += k;
            Progress(sw, k);
        }
        return true;
    }

    // Reverse direction: Windows sends frames, the Mac acknowledges them.
    static void SendFrames(Socket s, long total, Stopwatch sw)
    {
        var frame = new byte[24 + frameBytes];
        for (int i = 0; i < frameBytes; i++) frame[24 + i] = (byte)((i * 2654435761u) >> 13);
        long acked = 0, lastAckAt = sw.ElapsedTicks;
        var gate = new SemaphoreSlim(inflight, inflight);
        var acker = new Thread(() =>
        {
            var a = new byte[16];
            try
            {
                while (true)
                {
                    int got = 0;
                    while (got < 16) { int k = s.Receive(a, got, 16 - got, SocketFlags.None); if (k <= 0) return; got += k; }
                    Interlocked.Increment(ref acked);
                    Interlocked.Increment(ref frames);
                    Interlocked.Exchange(ref lastProgress, sw.ElapsedTicks);
                    gate.Release();
                }
            }
            catch { }
        }) { IsBackground = true };
        acker.Start();
        long sent = 0;
        for (uint seq = 1; sent < total; seq++)
        {
            while (!gate.Wait(200)) if (finished) return;
            BinaryPrimitives.WriteUInt32LittleEndian(frame, Frm);
            BinaryPrimitives.WriteUInt32LittleEndian(frame.AsSpan(4), seq);
            BinaryPrimitives.WriteUInt32LittleEndian(frame.AsSpan(8), (uint)frameBytes);
            int off = 0;
            while (off < frame.Length)
            {
                int n = s.Send(frame, off, frame.Length - off, SocketFlags.None);
                off += n;
                sent += n;
                Interlocked.Add(ref appBytes, n);
            }
        }
        var until = sw.Elapsed.TotalSeconds + 5;
        while (Interlocked.Read(ref acked) < sent / frame.Length && sw.Elapsed.TotalSeconds < until) Thread.Sleep(10);
    }

    static void UdpProber(Stopwatch sw)
    {
        IPEndPoint mac;
        Socket u;
        if (v4)
        {
            u = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            u.Bind(new IPEndPoint(IPAddress.Parse(local4), 0));
            mac = new IPEndPoint(IPAddress.Parse(mac4), port + 1);
        }
        else
        {
            u = new Socket(AddressFamily.InterNetworkV6, SocketType.Dgram, ProtocolType.Udp);
            mac = new IPEndPoint(IPAddress.Parse(macAddr), port + 1);
        }
        u.ReceiveTimeout = 50;
        var b = new byte[8];
        var r = new byte[64];
        uint seq = 0;
        long next = 0;
        while (!finished)
        {
            if (sw.ElapsedMilliseconds >= next)
            {
                next = sw.ElapsedMilliseconds + 200;
                BinaryPrimitives.WriteUInt32LittleEndian(b, ProbeMagic);
                BinaryPrimitives.WriteUInt32LittleEndian(b.AsSpan(4), ++seq);
                try { u.SendTo(b, mac); Interlocked.Increment(ref udpSent); } catch { }
            }
            try
            {
                EndPoint from = new IPEndPoint(v4 ? IPAddress.Any : IPAddress.IPv6Any, 0);
                int n = u.ReceiveFrom(r, ref from);
                if (n == 8)
                {
                    uint m = BinaryPrimitives.ReadUInt32LittleEndian(r);
                    if (m == EchoMagic) { Interlocked.Increment(ref udpEcho); Interlocked.Exchange(ref lastEchoAt, sw.ElapsedMilliseconds); }
                    if (m == MacProbeMagic) { Interlocked.Increment(ref udpMac); Interlocked.Exchange(ref lastMacAt, sw.ElapsedMilliseconds); }
                }
            }
            catch (SocketException) { }
        }
        u.Dispose();
    }

    static (long rxBytes, long rxPkts, long txBytes, long txPkts) Diff(this IPInterfaceStatistics a, IPInterfaceStatistics b) =>
        (a.BytesReceived - b.BytesReceived, a.UnicastPacketsReceived - b.UnicastPacketsReceived,
         a.BytesSent - b.BytesSent, a.UnicastPacketsSent - b.UnicastPacketsSent);

    static void Summary(string result, string detail, (long rxBytes, long rxPkts, long txBytes, long txPkts)? d, double secs)
    {
        var inv = CultureInfo.InvariantCulture;
        var sb = new StringBuilder("{");
        void P(string k, object v) => sb.Append(sb.Length > 1 ? "," : "").Append('"').Append(k).Append("\":").Append(
            v is string sv ? "\"" + sv.Replace("\\", "\\\\").Replace("\"", "'") + "\"" : Convert.ToString(v, inv));
        P("run", runId);
        P("result", result);
        if (detail != null) P("detail", detail);
        P("mode", (v4 ? "ipv4" : "ipv6") + (ipopt ? "+ipopt" : "") + (v6opt ? "+v6opt" : "") + (small ? "+small" : "") + (reverse ? " reverse" : "") +
                  $" frame={frameBytes} inflight={inflight} fps={fps} pace={paceMBps} wsize={writeBytes} sndbuf={sndbuf} rcvbuf={rcvbuf} rotate={rotateMB}");
        P("gb", Math.Round(Interlocked.Read(ref appBytes) / 1e9, 3));
        P("seconds", Math.Round(secs, 1));
        P("mbps", Math.Round(Interlocked.Read(ref appBytes) / 1e6 / Math.Max(secs, 0.001), 0));
        P("frames", Interlocked.Read(ref frames));
        P("max_gap_ms", Math.Round(maxGapTicks * 1000.0 / Stopwatch.Frequency, 1));
        P("stalls_50ms", stalls);
        if (d.HasValue)
        {
            var (rb, rp, tb, tp) = d.Value;
            P("if_rx_gb", Math.Round(rb / 1e9, 3));
            P("if_rx_pkts", rp);
            P("if_rx_avg_pkt", rp > 0 ? rb / rp : 0);
            P("if_tx_pkts", tp);
            P("if_tx_avg_pkt", tp > 0 ? tb / tp : 0);
        }
        P("udp_sent", Interlocked.Read(ref udpSent));
        P("udp_echo", Interlocked.Read(ref udpEcho));
        P("udp_mac", Interlocked.Read(ref udpMac));
        P("log", logPath);
        sb.Append('}');
        Console.WriteLine(sb.ToString());
    }
}
