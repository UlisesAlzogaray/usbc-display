using System;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using UsbcDisplay;

namespace UsbcSetup;

// Everything the wizard UI shows, kept up to date, and the commands it sends (CONTRACT.md).
// The window posts State whenever it changed, at most ten times a second.
sealed class Wizard
{
    readonly object gate = new();
    readonly State S = new();
    volatile bool dirty = true;

    readonly WebServer web;
    readonly Mdns mdns;
    readonly MacProbe probe;
    readonly Receiver receiver;
    string routerHardwareId;

    // Raised (on a worker thread) when the install finished from a copy outside the install folder:
    // the window hands over to the installed copy, which the firewall rule names.
    public event Action InstalledElsewhere;
    public event Action ScreenClosed;

    public Wizard()
    {
        web = new WebServer(this);
        mdns = new Mdns(OnMacV4);
        probe = new MacProbe(this);
        receiver = new Receiver(this);

        S.Laptop.WindowsBuild = Machine.WindowsBuild;
        S.Laptop.Arch = Machine.Arch;
        S.Laptop.IsAdminUser = Machine.IsAdminUser();
        // A downloaded copy run again after an earlier install reports "not installed", so the
        // install step runs (updating the installed files) and hands over to the installed copy,
        // the one the firewall rule names.
        S.Laptop.Installed = Install.IsInstalled && Install.RunningInstalled;
        S.Laptop.MissingPayload = Payload.Missing();
        S.Server.AppNotarized = Machine.AppNotarized;
        S.SetupDone = Settings.SetupDone;
        S.Settings.ScaleOptions = Machine.ScaleOptions(out int recommended);
        int? saved = Settings.Scale;
        S.Settings.Scale = saved is int v && S.Settings.ScaleOptions.Exists(o => o.Id == v) ? v : recommended;
        S.Settings.MatchColors = Settings.ColorManaged;
        S.Settings.UseLaptopInput = Settings.Input;

        new Thread(Monitor) { IsBackground = true, Name = "Monitor" }.Start();
    }

    public string TakeIfDirty()
    {
        if (!dirty) return null;
        lock (gate) { dirty = false; return S.ToJson(); }
    }

    public void Changed() => dirty = true;

    bool Set<T>(ref T field, T value)
    {
        if (Equals(field, value)) return false;
        field = value;
        dirty = true;
        return true;
    }

    // ---- Watching the laptop and the cable ----

    DateTime plugAt, lastServerTry = DateTime.MinValue, lastNeighbors = DateTime.MinValue, lastPoke = DateTime.MinValue;
    IPAddress macV6;
    int macMisses;  // neighbour-table reads in a row without the Mac; it counts as gone after 3
    readonly object serverGate = new();  // StartServers vs Shutdown (UI thread)
    string lastServerKey = "";
    TimeSpan serverRetry = TimeSpan.FromSeconds(3);

    void Monitor()
    {
        CheckLaptop();
        while (true)
        {
            try { Tick(); } catch (Exception e) { Log.Write("monitor: " + e); }
            Thread.Sleep(500);
        }
    }

    // The slower checks: USB4 hardware, the firewall rule and the tasks (they run netsh/schtasks).
    void CheckLaptop()
    {
        string usb4 = Machine.Usb4Status(out string router);
        bool fw = Elevation.FirewallOk();
        bool tasks = Elevation.TasksOk(router);
        lock (gate)
        {
            routerHardwareId = router;
            Set(ref S.Laptop.Usb4, usb4);
            Set(ref S.Laptop.FirewallOk, fw);
            Set(ref S.Laptop.RecoveryTasksOk, tasks);
            if (Elevation.Done(fw, tasks, router) && S.Laptop.Elevation == "none") Set(ref S.Laptop.Elevation, "done");
        }
        Log.Write($"laptop: build {S.Laptop.WindowsBuild} {S.Laptop.Arch}, admin {S.Laptop.IsAdminUser}, usb4 {usb4} ({router}), " +
                  $"installed {S.Laptop.Installed}, firewall {fw}, tasks {tasks}");
    }

    // The cable's network is up, so this laptop's USB4 works, whatever the check at start found
    // (some laptops only list their USB4 routers while something is plugged in). The check runs
    // again for the router's hardware ID, which is listed now.
    void CableProvesUsb4()
    {
        string usb4 = Machine.Usb4Status(out string router);
        lock (gate)
        {
            if (router != null) routerHardwareId = router;
            Set(ref S.Laptop.Usb4, "ok");
        }
        Log.Write($"laptop: usb4 ok, the cable's network is up (check now: {usb4}, {router})");
    }

    void Tick()
    {
        var now = DateTime.UtcNow;
        var c = Cable.Find();
        bool usb4Proven;
        lock (gate) usb4Proven = c != null && S.Laptop.Usb4 != "ok";
        if (usb4Proven) CableProvesUsb4();
        lock (gate)
        {
            var L = S.Link;
            if (c == null)
            {
                if (L.AdapterUp) Log.Write("link: down");
                Set(ref L.AdapterUp, false);
                Set(ref L.AdapterName, "");
                Set(ref L.SecondsSincePlug, 0);
                Set(ref L.MacFound, false);
                Set(ref L.MacV6, "");
                Set(ref L.MacV4, "");
                Set(ref L.LaptopV4, "");
                Set(ref S.Server.FallbackUrl, "");
                Set(ref S.Server.UrlReady, false);
                macV6 = null;
                macMisses = 0;
            }
            else
            {
                if (!L.AdapterUp) { plugAt = now; lastPoke = DateTime.MinValue; Log.Write($"link: up, {c.Name} (interface {c.Index})"); }
                Set(ref L.AdapterUp, true);
                Set(ref L.AdapterName, c.Name);
                Set(ref L.SecondsSincePlug, (int)(now - plugAt).TotalSeconds);
                Set(ref L.LaptopV4, Cable.Plain(c.LaptopV4));
                Set(ref S.Server.FallbackUrl, c.LaptopV4 != null ? "http://" + c.LaptopV4 : "");
            }
        }

        if (c == null)
        {
            lock (serverGate) if (web.Running || mdns.Running) { web.Stop(); mdns.Stop(); mdns.ResetMacV4(); lastServerKey = ""; }
            probe.SetTarget(null);
        }
        else
        {
            // The Mac: ping all nodes until it shows up, then now and then to keep the entry fresh.
            bool found = macV6 != null;
            if (now - lastPoke > TimeSpan.FromSeconds(found ? 10 : 2)) { lastPoke = now; Cable.PokeAllNodes(c.Index); }
            if (now - lastNeighbors > TimeSpan.FromSeconds(1))
            {
                lastNeighbors = now;
                var (v6, v4) = Cable.Neighbors(c, macV6);
                lock (gate)
                {
                    if (v6 != null && macV6 == null) Log.Write("link: Mac found at " + v6);
                    // One missed read (a stale entry being refreshed) doesn't make the Mac gone.
                    if (v6 != null) macMisses = 0;
                    else if (macV6 != null && ++macMisses < 3) v6 = macV6;
                    else macMisses = 0;
                    macV6 = v6;
                    Set(ref S.Link.MacFound, v6 != null);
                    Set(ref S.Link.MacV6, Cable.Plain(v6));
                    if (v4 != null) Set(ref S.Link.MacV4, v4.ToString());
                }
            }
            StartServers(c, now);
            probe.SetTarget(macV6);
        }

        lock (gate)
        {
            bool running = web.Running;
            Set(ref S.Server.Running, running);
            // usbc.local stays the address to type. The cable's IPv4 address is only offered as a
            // second try: a Mac on Wi-Fi sends 169.254.x.x out over Wi-Fi, so it often can't work.
            Set(ref S.Server.UrlReady, running && S.Link.MacFound);
            Set(ref S.Screen.Running, receiver.Running);
            if (!S.Screen.Running) Set(ref S.Screen.Showing, false);
        }
    }

    // The download page and the name, once the firewall step is done (or was declined: then
    // Windows may still ask itself), and only from the installed copy, the program the firewall
    // rule names. Missing pieces (an address not ready, port 80 taken) are retried, less often
    // each time while nothing changes; what already listens is left alone.
    void StartServers(CableInfo c, DateTime now)
    {
        lock (serverGate)
        {
            if (handingOff || !Install.RunningInstalled) return;
            bool allowed;
            lock (gate) allowed = S.Laptop.FirewallOk || S.Laptop.Elevation is "refused" or "failed";
            if (!allowed) return;
            string webKey = WebServer.KeyFor(c), mdnsKey = Mdns.KeyFor(c), key = webKey + "|" + mdnsKey;
            if (web.Running && web.BoundTo == webKey && mdns.Running && mdns.BoundTo == mdnsKey) { serverRetry = TimeSpan.FromSeconds(3); return; }
            bool same = key == lastServerKey;
            if (same && now - lastServerTry < serverRetry) return;
            serverRetry = same ? TimeSpan.FromSeconds(Math.Min(serverRetry.TotalSeconds * 2, 60)) : TimeSpan.FromSeconds(3);
            lastServerKey = key;
            lastServerTry = now;
            if (!web.Running || web.BoundTo != webKey) web.Start(c);
            if (!mdns.Running || mdns.BoundTo != mdnsKey) mdns.Start(c);
        }
    }

    // ---- Events from the servers, the Mac and the screen ----

    public void OnWebRequest(string path) => Log.Write("web: GET " + path);
    public void OnPageVisited() { lock (gate) Set(ref S.Server.PageVisited, true); }

    public void OnDownload(long sent, long size, bool done)
    {
        lock (gate)
        {
            Set(ref S.Server.Download.Sent, sent);
            Set(ref S.Server.Download.Size, size);
            if (done) Set(ref S.Server.Download.Done, true);
        }
        if (done) Log.Write($"web: download complete, {size} bytes");
    }

    void OnMacV4(IPAddress a) { lock (gate) if (S.Link.MacV4 == "") Set(ref S.Link.MacV4, a.ToString()); }

    public void OnMacInfo(MacProbe.Info i)
    {
        lock (gate)
        {
            var m = S.Mac;
            Set(ref m.Reachable, true);
            Set(ref m.Outdated, false);
            Set(ref m.AppVersion, i.AppVersion.ToString());
            Set(ref m.MacOS, i.MacOS);
            var st = m.Status;
            bool Bit(uint b) => (i.Status & b) != 0;
            Set(ref st.ScreenOk, Bit(Proto.StatusScreenOk));
            Set(ref st.AxOk, Bit(Proto.StatusAxOk));
            Set(ref st.ScreenPrompted, Bit(Proto.StatusScreenPrompted));
            Set(ref st.AxPrompted, Bit(Proto.StatusAxPrompted));
            Set(ref st.LoginItemEnabled, Bit(Proto.StatusLoginItemEnabled));
            Set(ref st.LoginItemNeedsApproval, Bit(Proto.StatusLoginItemNeedsApproval));
            Set(ref st.SessionActive, Bit(Proto.StatusSessionActive));
            Set(ref st.RunningAsAgent, Bit(Proto.StatusRunningAsAgent));
            Set(ref st.InApplications, Bit(Proto.StatusInApplications));
            Set(ref st.ScreenNeedsRelaunch, Bit(Proto.StatusScreenNeedsRelaunch));
        }
    }

    // Mac status keeps its last values while the app is away (e.g. relaunching): check reachable.
    public void OnMacUnreachable() { lock (gate) { Set(ref S.Mac.Reachable, false); Set(ref S.Mac.Outdated, false); } }
    public void OnMacOutdated()
    {
        lock (gate)
        {
            if (!S.Mac.Outdated) Log.Write("probe: the Mac app closed the connection on the probe: it needs updating");
            Set(ref S.Mac.Reachable, true);
            Set(ref S.Mac.Outdated, true);
        }
    }
    public void OnMacGone() => OnMacUnreachable();

    public void OnScreen(bool running, bool showing)
    {
        lock (gate)
        {
            Set(ref S.Screen.Running, running);
            Set(ref S.Screen.Showing, showing);
        }
        if (!running) ScreenClosed?.Invoke();
    }

    // ---- Commands from the UI ----

    public void InstallNow()
    {
        lock (gate)
        {
            if (S.Laptop.Installing) return;
            Set(ref S.Laptop.Installing, true);
            Set(ref S.Laptop.InstallError, "");
        }
        Task.Run(() =>
        {
            string error = "";
            try { Install.Run(); }
            catch (Exception e) { error = e.Message; Log.Write("install: failed: " + e); }
            lock (gate)
            {
                Set(ref S.Laptop.Installing, false);
                Set(ref S.Laptop.InstallError, error);
                Set(ref S.Laptop.Installed, error == "" && Install.IsInstalled);
            }
            if (error == "" && !Install.RunningInstalled)
            {
                // Long enough to see "Installed" and for the page to move on: the installed copy
                // then opens on that same next step.
                Thread.Sleep(1600);
                InstalledElsewhere?.Invoke();
            }
        });
    }

    public void Elevate()
    {
        lock (gate)
        {
            if (S.Laptop.Elevation == "pending") return;
            Set(ref S.Laptop.Elevation, "pending");
        }
        Task.Run(() =>
        {
            int code = Elevation.RunElevated("--elevated", out bool refused);
            Machine.Usb4Status(out string router);
            bool fw = Elevation.FirewallOk(), tasks = Elevation.TasksOk(router);
            lock (gate)
            {
                routerHardwareId = router;
                Set(ref S.Laptop.FirewallOk, fw);
                Set(ref S.Laptop.RecoveryTasksOk, tasks);
                // The firewall rules may be there even when something else failed: firewallOk says.
                Set(ref S.Laptop.Elevation, refused ? "refused" : Elevation.Done(fw, tasks, router) ? "done" : "failed");
            }
            Log.Write($"elevate: code {code}, firewall {fw}, tasks {tasks}");
        });
    }

    public void MacAction(string action)
    {
        uint bits = action switch
        {
            "screen" => Proto.QueryScreen,
            "accessibility" => Proto.QueryAccessibility,
            "loginItems" => Proto.QueryLoginItems,
            "relaunch" => Proto.QueryRelaunch,
            "moveToApplications" => Proto.QueryMoveToApplications,
            _ => 0,
        };
        if (bits != 0) probe.Action(bits);
    }

    public void SaveSettings(int? scale, bool? matchColors, bool? useLaptopInput)
    {
        lock (gate)
        {
            if (scale is int s && s >= 100 && s <= 300) Set(ref S.Settings.Scale, s);
            if (matchColors is bool m) Set(ref S.Settings.MatchColors, m);
            if (useLaptopInput is bool u) Set(ref S.Settings.UseLaptopInput, u);
            try
            {
                Settings.SetInt("Scale", S.Settings.Scale);
                Settings.SetInt("ColorManaged", S.Settings.MatchColors ? 1 : 0);
                Settings.SetInt("Input", S.Settings.UseLaptopInput ? 1 : 0);
            }
            catch (Exception e) { Log.Write("settings: " + e.Message); }
        }
    }

    public void StartScreen()
    {
        int scale; bool colors, input;
        lock (gate) { scale = S.Settings.Scale; colors = S.Settings.MatchColors; input = S.Settings.UseLaptopInput; }
        string error = receiver.Start(scale, colors, input);
        lock (gate) Set(ref S.Screen.Error, error ?? "");
    }

    public void Finish()
    {
        try { Settings.SetInt("SetupDone", 1); } catch (Exception e) { Log.Write("finish: " + e.Message); }
        lock (gate) Set(ref S.SetupDone, true);
        Install.StartWatcher();
        Log.Write("finish: setup done");
    }

    volatile bool handingOff;

    // Frees port 80 and 5353 for the installed copy taking over; Resume if that didn't start.
    public void Shutdown()
    {
        lock (serverGate)
        {
            handingOff = true;
            web.Stop();
            mdns.Stop();
            lastServerKey = "";
        }
        probe.SetTarget(null);
    }

    public void Resume() => handingOff = false;
}
