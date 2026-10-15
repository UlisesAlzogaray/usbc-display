// Stand-in for mac/usbc-display, for testing the Windows receiver without a Mac.
// Same protocol and tile diff; draws a moving square over a gradient.
//
// usage: FakeMac [--port N] [--seconds N] [--lz4] [--full]
//   --full  change every pixel every frame (throughput test)

using System;
using System.Buffers.Binary;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;

const int TileW = 64, TileH = 32;
int port = 48100, seconds = 5;
bool lz4 = false, fullEveryFrame = false;
for (int i = 0; i < args.Length; i++)
{
    if (args[i] == "--port") port = int.Parse(args[++i]);
    else if (args[i] == "--seconds") seconds = int.Parse(args[++i]);
    else if (args[i] == "--lz4") lz4 = true;
    else if (args[i] == "--full") fullEveryFrame = true;
}

// Loopback only, so Windows Firewall doesn't ask about it.
var listener = new Socket(AddressFamily.InterNetworkV6, SocketType.Stream, ProtocolType.Tcp);
listener.Bind(new IPEndPoint(IPAddress.IPv6Loopback, port));
listener.Listen(1);
Console.WriteLine($"FakeMac listening on {port}");
using var s = listener.Accept();
s.NoDelay = true;
s.SendBufferSize = 8 << 20;
var hello = new byte[24];
ReadExactly(s, hello);
if (BinaryPrimitives.ReadUInt32LittleEndian(hello) != 0x48444355) throw new Exception("bad hello");
int W = BinaryPrimitives.ReadUInt16LittleEndian(hello.AsSpan(8)), H = BinaryPrimitives.ReadUInt16LittleEndian(hello.AsSpan(10));
Console.WriteLine($"Receiver: {W}x{H} scale {BinaryPrimitives.ReadUInt16LittleEndian(hello.AsSpan(12))}% {BinaryPrimitives.ReadUInt16LittleEndian(hello.AsSpan(14))} Hz");

byte[] frame = new byte[W * H * 4], sent = new byte[W * H * 4], stage = new byte[W * H * 4];
var msg = new MemoryStream();
int inflight = 0;
long[] sendTime = new long[256];
double rttSum = 0, rxSum = 0; int acks = 0;
var gate = new object();

var ackThread = new Thread(() =>
{
    var a = new byte[12];
    try
    {
        while (true)
        {
            ReadExactly(s, a);
            long t = Stopwatch.GetTimestamp();
            uint seq = BinaryPrimitives.ReadUInt32LittleEndian(a.AsSpan(4));
            lock (gate)
            {
                inflight--;
                rttSum += (t - sendTime[seq & 255]) * 1000.0 / Stopwatch.Frequency;
                rxSum += BinaryPrimitives.ReadUInt32LittleEndian(a.AsSpan(8)) / 1000.0;
                acks++;
                Monitor.PulseAll(gate);
            }
        }
    }
    catch { }
}) { IsBackground = true };
ackThread.Start();

var clock = Stopwatch.StartNew();
uint frameNo = 0;
bool first = true;
long totalBytes = 0; int sentFrames = 0;
double lastPrint = 0;
while (clock.Elapsed.TotalSeconds < seconds)
{
    Draw(frameNo);
    lock (gate) { while (inflight >= 2) Monitor.Wait(gate); }
    int len = Build(frameNo + 1, first || fullEveryFrame);
    first = false;
    if (len > 0)
    {
        frameNo++;
        lock (gate) { inflight++; sendTime[frameNo & 255] = Stopwatch.GetTimestamp(); }
        s.Send(msg.GetBuffer(), 0, len, SocketFlags.None);
        totalBytes += len; sentFrames++;
    }
    if (!fullEveryFrame) Thread.Sleep(16);
    if (clock.Elapsed.TotalSeconds - lastPrint >= 1)
    {
        lock (gate)
            Console.WriteLine($"{sentFrames} fps  {totalBytes / 1e6:0.0} MB/s  round trip {(acks > 0 ? rttSum / acks : 0):0.00} ms  receiver {(acks > 0 ? rxSum / acks : 0):0.00} ms");
        lock (gate) { rttSum = rxSum = 0; acks = 0; }
        totalBytes = 0; sentFrames = 0;
        lastPrint = clock.Elapsed.TotalSeconds;
    }
}
// Final frame known: square position for frameNo; print a probe for verification.
Console.WriteLine($"DONE frames={frameNo} square={SquarePos(frameNo - 1)}");
Thread.Sleep(500);

void Draw(uint n)
{
    if (n == 0 || fullEveryFrame)
    {
        for (int y = 0; y < H; y++)
            for (int x = 0; x < W; x++)
            {
                int o = (y * W + x) * 4;
                frame[o] = (byte)(x * 255 / W);                 // B
                frame[o + 1] = (byte)(y * 255 / H);             // G
                frame[o + 2] = (byte)(fullEveryFrame ? n * 7 : 64); // R
                frame[o + 3] = 255;
            }
        if (fullEveryFrame) return;
    }
    if (n > 0) Square(SquarePos(n - 1), restore: true);
    Square(SquarePos(n), restore: false);
}

(int x, int y) SquarePos(uint n) => ((int)(n * 8 % (uint)(W - 160)), (int)(n * 5 % (uint)(H - 160)));

void Square((int x, int y) p, bool restore)
{
    for (int y = p.y; y < p.y + 160; y++)
        for (int x = p.x; x < p.x + 160; x++)
        {
            int o = (y * W + x) * 4;
            if (restore) { frame[o] = (byte)(x * 255 / W); frame[o + 1] = (byte)(y * 255 / H); frame[o + 2] = 64; }
            else { frame[o] = 255; frame[o + 1] = 255; frame[o + 2] = 255; }   // white square
            frame[o + 3] = 255;
        }
}

int Build(uint seq, bool full)
{
    msg.SetLength(0);
    var bw = new BinaryWriter(msg);
    bw.Write(new byte[24]);
    int rects = 0, tilesX = (W + TileW - 1) / TileW, rowBytes = W * 4;
    var dirty = new bool[tilesX];
    for (int ty = 0; ty < H; ty += TileH)
    {
        int th = Math.Min(TileH, H - ty);
        for (int tx = 0; tx < tilesX; tx++)
        {
            bool d = full;
            int x = tx * TileW, tw = Math.Min(TileW, W - x);
            for (int r = 0; r < th && !d; r++)
                d = !frame.AsSpan((ty + r) * rowBytes + x * 4, tw * 4).SequenceEqual(sent.AsSpan((ty + r) * rowBytes + x * 4, tw * 4));
            dirty[tx] = d;
        }
        for (int tx = 0; tx < tilesX;)
        {
            if (!dirty[tx]) { tx++; continue; }
            int t0 = tx;
            while (tx < tilesX && dirty[tx]) tx++;
            int x = t0 * TileW, rw = Math.Min(tx * TileW, W) - x, run = rw * 4, n = run * th;
            for (int r = 0; r < th; r++)
            {
                Buffer.BlockCopy(frame, (ty + r) * rowBytes + x * 4, stage, r * run, run);
                Buffer.BlockCopy(frame, (ty + r) * rowBytes + x * 4, sent, (ty + r) * rowBytes + x * 4, run);
            }
            byte[] payload = lz4 ? Lz4Encode(stage, n, run) : null;
            bool packed = payload != null && payload.Length < n;
            bw.Write((ushort)x); bw.Write((ushort)ty); bw.Write((ushort)rw); bw.Write((ushort)th);
            bw.Write(packed ? 1 : 0);
            bw.Write(packed ? payload.Length : n);
            if (packed) bw.Write(payload); else bw.Write(stage, 0, n);
            rects++;
        }
    }
    if (rects == 0) return 0;
    int len = (int)msg.Length;
    var b = msg.GetBuffer().AsSpan();
    BinaryPrimitives.WriteUInt32LittleEndian(b, 0x46444355);
    BinaryPrimitives.WriteUInt32LittleEndian(b[4..], seq);
    BinaryPrimitives.WriteUInt16LittleEndian(b[8..], (ushort)W);
    BinaryPrimitives.WriteUInt16LittleEndian(b[10..], (ushort)H);
    BinaryPrimitives.WriteInt32LittleEndian(b[12..], rects);
    BinaryPrimitives.WriteInt32LittleEndian(b[16..], len - 24);
    return len;
}

// Minimal LZ4 block encoder: matches against the previous pixel or the previous row only.
static byte[] Lz4Encode(byte[] src, int n, int rowBytes)
{
    var o = new MemoryStream();
    int anchor = 0, i = 4;
    while (i + 12 < n)
    {
        int best = 0, bestOff = 0;
        foreach (int off in new[] { 4, rowBytes })
        {
            if (off > i || off > 65535) continue;
            int len = 0;
            while (i + len < n - 5 && src[i + len] == src[i + len - off]) len++;
            if (len > best) { best = len; bestOff = off; }
        }
        if (best < 4) { i++; continue; }
        Emit(o, src, anchor, i - anchor, bestOff, best);
        i += best;
        anchor = i;
    }
    Emit(o, src, anchor, n - anchor, 0, 0);
    return o.ToArray();

    static void Emit(MemoryStream o, byte[] src, int start, int lit, int off, int match)
    {
        int ml = match > 0 ? match - 4 : 0;
        o.WriteByte((byte)((Math.Min(lit, 15) << 4) | Math.Min(ml, 15)));
        if (lit >= 15) { int r = lit - 15; while (r >= 255) { o.WriteByte(255); r -= 255; } o.WriteByte((byte)r); }
        o.Write(src, start, lit);
        if (match == 0) return;
        o.WriteByte((byte)off); o.WriteByte((byte)(off >> 8));
        if (ml >= 15) { int r = ml - 15; while (r >= 255) { o.WriteByte(255); r -= 255; } o.WriteByte((byte)r); }
    }
}

static void ReadExactly(Socket s, Span<byte> buf)
{
    while (buf.Length > 0)
    {
        int n = s.Receive(buf);
        if (n <= 0) throw new IOException("closed");
        buf = buf[n..];
    }
}
