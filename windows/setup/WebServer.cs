using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace UsbcSetup;

// The Mac downloads its app from here (CONTRACT.md section 4): a tiny HTTP/1.1 server on port 80,
// listening only on this laptop's cable addresses and answering only peers on the cable.
// Three fixed paths; nothing is ever read from a path the request names.
sealed class WebServer
{
    readonly Wizard wizard;
    readonly Dictionary<IPAddress, TcpListener> listeners = new();
    readonly SemaphoreSlim clients = new(8);  // the Mac needs two or three connections at most
    readonly object gate = new();
    int cableIndex;
    CancellationTokenSource stop;
    public string BoundTo = "";   // the address set it listens on, to notice when it changes

    public WebServer(Wizard wizard) { this.wizard = wizard; }

    public static string KeyFor(CableInfo c) => $"{c.LaptopV6},{c.LaptopV4}";

    public bool Running { get { lock (gate) return listeners.Count > 0; } }

    // The last try to listen found port 80 taken by another program (http.sys, IIS, another web
    // server) on an address it wanted: server.error = "port".
    public bool PortBusy { get { lock (gate) return portBusy; } }
    bool portBusy;

    // Listens on the cable's addresses, keeping what already listens and adding what's missing.
    // Returns false if nothing could be bound (port 80 taken, address not ready yet).
    public bool Start(CableInfo cable)
    {
        lock (gate)
        {
            if (stop == null || cable.Index != cableIndex) { StopLocked(); stop = new CancellationTokenSource(); cableIndex = cable.Index; }
            var want = new List<IPAddress>();
            if (cable.LaptopV6 != null) want.Add(cable.LaptopV6);
            if (cable.LaptopV4 != null) want.Add(cable.LaptopV4);
            foreach (var a in new List<IPAddress>(listeners.Keys))
                if (!want.Contains(a)) { try { listeners[a].Stop(); } catch { } listeners.Remove(a); }
            bool busy = false;
            foreach (var a in want)
            {
                if (listeners.ContainsKey(a)) continue;
                try
                {
                    var l = new TcpListener(new IPEndPoint(a, 80));
                    l.Server.ExclusiveAddressUse = true;
                    l.Start(16);
                    listeners[a] = l;
                    _ = AcceptLoop(l, stop.Token);
                    Log.Write($"web: listening on {a}:80");
                }
                catch (SocketException e) when (e.SocketErrorCode is SocketError.AddressAlreadyInUse or SocketError.AccessDenied)
                {
                    busy = true;
                    Log.Write($"web: can't listen on {a}:80, another program uses the port: {e.Message}");
                }
                catch (Exception e) { Log.Write($"web: can't listen on {a}:80: {e.Message}"); }
            }
            portBusy = busy;
            // What actually listens: a mismatch with KeyFor means try again.
            BoundTo = $"{(cable.LaptopV6 != null && listeners.ContainsKey(cable.LaptopV6) ? cable.LaptopV6 : null)}," +
                      $"{(cable.LaptopV4 != null && listeners.ContainsKey(cable.LaptopV4) ? cable.LaptopV4 : null)}";
            return listeners.Count > 0;
        }
    }

    public void Stop() { lock (gate) StopLocked(); }

    void StopLocked()
    {
        stop?.Cancel();
        stop = null;
        foreach (var l in listeners.Values) try { l.Stop(); } catch { }
        listeners.Clear();
        BoundTo = "";
        portBusy = false;
    }

    async Task AcceptLoop(TcpListener l, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            TcpClient c;
            try { c = await l.AcceptTcpClientAsync(ct); }
            catch { return; }
            if (!clients.Wait(0)) { c.Dispose(); continue; }  // too many at once
            _ = Task.Run(() => { try { Serve(c, ct); } finally { clients.Release(); } });
        }
    }

    bool FromCable(EndPoint ep)
    {
        if (ep is not IPEndPoint ip) return false;
        var a = ip.Address;
        if (a.IsIPv4MappedToIPv6) a = a.MapToIPv4();
        if (a.AddressFamily == AddressFamily.InterNetworkV6) return a.IsIPv6LinkLocal && a.ScopeId == cableIndex;
        return Cable.IsLinkLocalV4(a);
    }

    void Serve(TcpClient c, CancellationToken ct)
    {
        using (c)
        {
            try
            {
                if (!FromCable(c.Client.RemoteEndPoint)) { Log.Write($"web: refused {c.Client.RemoteEndPoint}"); return; }
                c.NoDelay = true;
                c.ReceiveTimeout = 15000;
                c.SendTimeout = 30000;
                var s = c.GetStream();
                var reader = new HeadReader(s);
                // Keep-alive, so Safari's page, icon and download can share a connection.
                for (int n = 0; n < 32 && !ct.IsCancellationRequested; n++)
                {
                    string head = reader.Next();
                    if (head == null) return;
                    if (!Respond(s, head)) return;
                }
            }
            catch (IOException) { }
            catch (SocketException) { }
            catch (ObjectDisposedException) { }
            catch (Exception e) { Log.Write("web: " + e.Message); }
        }
    }

    // Request heads, one after another on a connection: the request line and headers up to the
    // blank line, at most 8 KB, read in chunks and within 10 s of the first read (a peer that
    // trickles bytes is dropped). Bytes past the blank line are kept for the next request.
    sealed class HeadReader
    {
        readonly Stream s;
        readonly byte[] buf = new byte[8192];
        int len;

        public HeadReader(Stream s) { this.s = s; }

        public string Next()
        {
            var started = System.Diagnostics.Stopwatch.StartNew();
            int scanned = 0;
            while (true)
            {
                for (int i = Math.Max(3, scanned); i < len; i++)
                {
                    if (buf[i - 3] == '\r' && buf[i - 2] == '\n' && buf[i - 1] == '\r' && buf[i] == '\n')
                    {
                        string head = Encoding.ASCII.GetString(buf, 0, i + 1);
                        Buffer.BlockCopy(buf, i + 1, buf, 0, len - i - 1);
                        len -= i + 1;
                        return head;
                    }
                }
                scanned = len;
                if (len == buf.Length) return null;                                        // too long
                if (len > 0 && started.ElapsedMilliseconds > 10000) return null;          // too slow
                int n = s.Read(buf, len, buf.Length - len);
                if (n <= 0) return null;
                len += n;
            }
        }
    }

    // Returns whether the connection can stay open for another request.
    bool Respond(Stream s, string head)
    {
        string first = head.Split("\r\n", 2)[0];
        var parts = first.Split(' ');
        if (parts.Length != 3 || !parts[2].StartsWith("HTTP/1."))
        {
            Send(s, 400, "Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Bad request\n"), false, null);
            return false;
        }
        string method = parts[0], path = parts[1], query = "";
        int q = path.IndexOfAny(new[] { '?', '#' });
        if (q >= 0) { query = path[q..]; path = path[..q]; }
        bool head_ = method == "HEAD";
        // A request with a body isn't expected here: answer it, then close, so the body is never
        // read as the next request.
        bool keepAlive = parts[2] == "HTTP/1.1" && head.IndexOf("connection: close", StringComparison.OrdinalIgnoreCase) < 0 && !HasBody(head);
        if (method != "GET" && !head_)
        {
            Send(s, 405, "Method Not Allowed", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not allowed\n"), false, "Allow: GET, HEAD\r\n");
            return false;
        }
        if (path != "/event") wizard.OnWebRequest(path);  // events are logged by name below

        switch (path)
        {
            case "/":
                if (!head_) wizard.OnPageVisited();
                Send(s, 200, "OK", "text/html; charset=utf-8", LandingPage(), head_, null, keepAlive);
                return keepAlive;
            case "/icon.png":
                var icon = Resources.Get("web/icon.png");
                if (icon == null) break;
                Send(s, 200, "OK", "image/png", icon, head_, null, keepAlive);
                return keepAlive;
            case "/USB-C-Display.zip":
                return SendZip(s, head_, keepAlive);
            case "/event":
                // The page in Safari says where the person is (Safari in front or not, the
                // Download and Privacy & Security buttons clicked, the Mac's look), and the Mac
                // app may say it was opened, so this PC can show the matching step.
                // e=<word> plus &k=v pairs; anything unknown is ignored.
                var args = ParseQuery(query);
                // "web: event blur", "web: event look dark=1 accent=purple": what Safari reported, in order.
                Log.Write("web: event " + string.Join(" ", args.Select(kv => kv.Key == "e" ? kv.Value : kv.Key + "=" + kv.Value)));
                if (!head_ && args.TryGetValue("e", out string e) && e is "focus" or "blur" or "settings" or "download" or "look" or "opened")
                    wizard.OnPageEvent(e, args);
                Send(s, 204, "No Content", "text/plain; charset=utf-8", Array.Empty<byte>(), head_, null, keepAlive);
                return keepAlive;
        }
        Send(s, 404, "Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not found\n"), head_, null, keepAlive);
        return keepAlive;
    }

    // "?e=look&dark=1&accent=purple" -> {e: look, dark: 1, accent: purple}. Short plain values
    // only: anything long or odd is dropped.
    static Dictionary<string, string> ParseQuery(string query)
    {
        var d = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!query.StartsWith('?')) return d;
        foreach (var pair in query[1..].Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            int eq = pair.IndexOf('=');
            string k = eq < 0 ? pair : pair[..eq], v = eq < 0 ? "" : pair[(eq + 1)..];
            try { k = Uri.UnescapeDataString(k); v = Uri.UnescapeDataString(v.Replace('+', ' ')); } catch { continue; }
            if (k.Length is 0 or > 16 || v.Length > 32 || d.Count >= 8) continue;
            d[k] = v;
        }
        return d;
    }

    static bool HasBody(string head)
    {
        foreach (var line in head.Split("\r\n"))
        {
            int colon = line.IndexOf(':');
            if (colon <= 0) continue;
            string name = line[..colon].Trim(), value = line[(colon + 1)..].Trim();
            if (name.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase)) return true;
            if (name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) && value != "0") return true;
        }
        return false;
    }

    static void Send(Stream s, int code, string reason, string type, byte[] body, bool headOnly, string extra, bool keepAlive = false)
    {
        var h = new StringBuilder();
        h.Append($"HTTP/1.1 {code} {reason}\r\n");
        h.Append($"Content-Type: {type}\r\n");
        h.Append($"Content-Length: {body.Length}\r\n");
        h.Append("Cache-Control: no-store\r\n");
        h.Append("X-Content-Type-Options: nosniff\r\n");
        h.Append(keepAlive ? "Connection: keep-alive\r\n" : "Connection: close\r\n");
        if (extra != null) h.Append(extra);
        h.Append("\r\n");
        var hb = Encoding.ASCII.GetBytes(h.ToString());
        s.Write(hb, 0, hb.Length);
        if (!headOnly) s.Write(body, 0, body.Length);
        s.Flush();
    }

    bool SendZip(Stream s, bool headOnly, bool keepAlive)
    {
        using var zip = Payload.OpenMacZip(out long size);
        if (zip == null)
        {
            Send(s, 404, "Not Found", "text/plain; charset=utf-8",
                 Encoding.UTF8.GetBytes("This copy of USB-C Display Setup doesn’t include USB-C Display for Mac.\n"), headOnly, null, keepAlive);
            return keepAlive;
        }
        var h = "HTTP/1.1 200 OK\r\n" +
                "Content-Type: application/zip\r\n" +
                $"Content-Length: {size}\r\n" +
                "Content-Disposition: attachment; filename=\"USB-C-Display.zip\"\r\n" +
                "Cache-Control: no-store\r\n" +
                "X-Content-Type-Options: nosniff\r\n" +
                (keepAlive ? "Connection: keep-alive\r\n" : "Connection: close\r\n") + "\r\n";
        var hb = Encoding.ASCII.GetBytes(h);
        s.Write(hb, 0, hb.Length);
        if (headOnly) { s.Flush(); return keepAlive; }

        wizard.OnDownload(0, size, false);
        var buf = new byte[256 * 1024];
        long sent = 0;
        int n;
        while ((n = zip.Read(buf, 0, buf.Length)) > 0)
        {
            s.Write(buf, 0, n);
            sent += n;
            wizard.OnDownload(sent, size, false);
        }
        s.Flush();
        wizard.OnDownload(sent, size, sent == size);
        return keepAlive;
    }

    // web/index.html with the Mac app's size, version and notarization filled in:
    // {{HAS_APP}} true|false, {{SIZE}} "0.7 MB", {{VERSION}} the app's CFBundleVersion ("5"),
    // {{NOTARIZED}} true|false.
    byte[] LandingPage()
    {
        var raw = Resources.Get("web/index.html");
        string html = raw != null ? Encoding.UTF8.GetString(raw)
            : "<!doctype html><meta charset=utf-8><title>USB-C Display</title><p><a href=\"/USB-C-Display.zip\">Download USB-C Display</a>";
        var (size, version) = Payload.MacAppInfo();
        html = html.Replace("{{HAS_APP}}", size > 0 ? "true" : "false")
                   .Replace("{{SIZE}}", size > 0 ? FormatSize(size) : "")
                   .Replace("{{VERSION}}", System.Net.WebUtility.HtmlEncode(version))
                   .Replace("{{NOTARIZED}}", Machine.AppNotarized ? "true" : "false");
        return Encoding.UTF8.GetBytes(html);
    }

    // As the setup window shows it (steps.js mb()) and as the Mac counts sizes (decimal MB, as in
    // Safari's Downloads): one decimal below 10 MB ("0.7 MB"), whole MB above.
    public static string FormatSize(long bytes)
    {
        double mb = bytes / 1e6;
        var inv = System.Globalization.CultureInfo.InvariantCulture;
        // Halves round up, as the page's toFixed() does.
        return mb < 10 ? Math.Max(0.1, Math.Round(mb, 1, MidpointRounding.AwayFromZero)).ToString("0.0", inv) + " MB"
                       : Math.Round(mb, MidpointRounding.AwayFromZero).ToString("0", inv) + " MB";
    }
}
