using System;
using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using UsbcDisplay;

namespace UsbcSetup;

// Asks the Mac app how it's doing (CONTRACT.md section 1): one connection to port 48100 over the
// cable, a Query, then Info messages whenever something changes on the Mac. A Query with no
// actions every 5 s doubles as a keep-alive. An app that closes the connection on the Query is
// an older build that doesn't know it: "Mac app needs updating".
sealed class MacProbe
{
    const int Port = 48100;
    readonly Wizard wizard;
    readonly object sendLock = new();
    volatile IPAddress target;
    volatile Socket current;
    uint pendingActions;
    DateTime pendingAt;  // an action waits at most 10 s for a connection, then it's dropped
    Thread thread;

    public MacProbe(Wizard wizard) { this.wizard = wizard; }

    // The Mac's cable address, or null when it's gone (unplugged).
    public void SetTarget(IPAddress mac)
    {
        if (Equals(mac, target)) return;
        target = mac;
        try { current?.Dispose(); } catch { }  // reconnect to the new address
        if (thread == null && mac != null)
        {
            thread = new Thread(Loop) { IsBackground = true, Name = "Mac probe" };
            thread.Start();
        }
    }

    // Runs an action on the Mac now if connected, otherwise if the probe connects within 10 s
    // (a relaunch or a move minutes later would surprise the person at the Mac).
    public void Action(uint bits)
    {
        lock (sendLock)
        {
            pendingActions |= bits;
            pendingAt = DateTime.UtcNow;
            var s = current;
            if (s != null && Send(s)) return;
        }
    }

    bool Send(Socket s)
    {
        // Called with sendLock held.
        if (pendingActions != 0 && DateTime.UtcNow - pendingAt > TimeSpan.FromSeconds(10))
        {
            Log.Write($"probe: dropped actions {pendingActions}, the Mac app wasn't reachable in time");
            pendingActions = 0;
        }
        long v = Machine.SetupBuild;
        var q = Proto.WinMsg(Proto.Query, pendingActions, (uint)v, (uint)(v >> 32));
        try
        {
            s.Send(q);
            if (pendingActions != 0) Log.Write($"probe: sent actions {pendingActions}");
            pendingActions = 0;
            return true;
        }
        catch { return false; }
    }

    void Loop()
    {
        while (true)
        {
            var mac = target;
            if (mac == null) { wizard.OnMacGone(); Thread.Sleep(1000); continue; }

            Socket s = null;
            try { s = Discovery.Connect(mac.ToString(), Port); } catch { }
            if (s == null)
            {
                wizard.OnMacUnreachable();
                Thread.Sleep(2000);
                continue;
            }
            bool answered = false;
            try
            {
                s.ReceiveTimeout = 15000;
                lock (sendLock) { current = s; if (!Send(s)) throw new SocketException((int)SocketError.ConnectionReset); }
                var keepAlive = new Timer(_ => { lock (sendLock) if (current == s) Send(s); }, null, 5000, 5000);
                try
                {
                    var msg = new byte[Proto.MacMsgSize];
                    while (target != null && Equals(target, mac))
                    {
                        Proto.ReadExactly(s, msg);
                        if (BinaryPrimitives.ReadUInt32LittleEndian(msg) != Proto.Info) continue;  // nothing else is expected here
                        answered = true;
                        wizard.OnMacInfo(Parse(msg));
                    }
                }
                finally { keepAlive.Dispose(); }
            }
            catch (Exception)
            {
                // Closed before any answer: an app that doesn't know the probe. A timeout without
                // an answer counts the same. Closed after answering: it quit or is relaunching.
                if (!answered && target != null && Equals(target, mac)) wizard.OnMacOutdated();
                else wizard.OnMacUnreachable();
            }
            finally
            {
                lock (sendLock) if (current == s) current = null;
                try { s.Dispose(); } catch { }
            }
            Thread.Sleep(2000);
        }
    }

    public sealed class Info
    {
        public uint Status, Refuse;
        public ulong AppVersion;
        public int Protocol;
        public string MacOS = "";
    }

    static Info Parse(byte[] m)
    {
        ulong version = BinaryPrimitives.ReadUInt64LittleEndian(m.AsSpan(8));
        ulong os = BinaryPrimitives.ReadUInt64LittleEndian(m.AsSpan(16));
        uint major = (uint)(os >> 32), minor = (uint)(os >> 16) & 0xFFFF, patch = (uint)os & 0xFFFF;
        return new Info
        {
            Status = BinaryPrimitives.ReadUInt32LittleEndian(m.AsSpan(4)),
            AppVersion = version >> 16,
            Protocol = (int)(version & 0xFFFF),
            MacOS = major == 0 ? "" : patch == 0 ? $"{major}.{minor}" : $"{major}.{minor}.{patch}",
            Refuse = BinaryPrimitives.ReadUInt32LittleEndian(m.AsSpan(24)),
        };
    }
}
