using System;
using System.Collections.Generic;
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

    // Raised (on a worker thread) when this copy, outside the install folder, has installed and
    // asked Windows: the window hands over to the installed copy, which the firewall rule names.
    // The argument is the frame to hold, "screen|sub|status|theme|accent|active" (--hold).
    public event Action<string> InstalledElsewhere;
    public event Action ScreenClosed;
    // The Mac desktop is on screen: the receiver's window (and process) should get the keyboard.
    public event Action<IntPtr, int> PictureShown;

    // Set by SetupWindow.
    public Func<(System.Drawing.Rectangle Panel, int DpiPercent)?> WindowPlace;
    public Action PrepareForHandover;     // restore, activate, move onto the primary panel (UI thread)
    public Func<IntPtr> OwnerWindow;      // the window UAC's prompt belongs to

    // ---- The handover when the Mac desktop starts ----
    // The Mac opens this same window, in the same spot, on its new display (Mac app 4 and later):
    // the receiver shows the Mac desktop only once that window is drawn, so on this PC only what's
    // behind the window changes. Meanwhile this PC's copy stays in charge: its state and place
    // go to the Mac's copy (mirror), and clicks there come back here (RemoteClick).
    public event Action<string> RemoteClick;  // JSON {act, data}, raised on the probe's thread
    volatile bool mirroring;
    string mirrorState = "", mirrorLocal = "", mirrorSent = "";

    public bool Mirroring => mirroring;

    // The page's place and look (app.js sendMirror), as JSON {local, look}.
    public void SetMirrorLocal(string json) { lock (gate) mirrorLocal = json; MirrorIfChanged(); }

    // Called with every state snapshot posted to the page.
    public void StatePosted(string json) { lock (gate) mirrorState = json; MirrorIfChanged(); }

    void MirrorIfChanged()
    {
        if (!mirroring) return;
        string m;
        lock (gate)
        {
            if (mirrorState == "" || mirrorLocal.Length < 2) return;
            m = "{\"type\":\"mirror\",\"state\":" + mirrorState + "," + mirrorLocal[1..];
            if (m == mirrorSent) return;
            mirrorSent = m;
        }
        probe.SendMirror(System.Text.Encoding.UTF8.GetBytes(m));
    }

    public void OnRemoteClick(string json) => RemoteClick?.Invoke(json);

    // Closes the Mac's copy (Done, Return to Windows, or the display ended).
    void EndHandover()
    {
        if (!mirroring) return;
        mirroring = false;
        probe.SendWindow(System.Drawing.Rectangle.Empty, 0);
    }

    readonly DateTime startedAt = DateTime.UtcNow;
    readonly ManualResetEventSlim laptopChecked = new(false);

    public Wizard(HoldState hold)
    {
        web = new WebServer(this);
        mdns = new Mdns(OnMacV4);
        probe = new MacProbe(this);
        receiver = new Receiver(this);

        S.Laptop.WindowsBuild = Machine.WindowsBuild;
        S.Laptop.Arch = Machine.Arch;
        S.Laptop.IsAdminUser = Machine.IsAdminUser();
        S.Laptop.RunningInstalled = Install.RunningInstalled;
        // A downloaded copy run again after an earlier install reports "not installed", so the
        // install runs (updating the installed files) and hands over to the installed copy, the
        // one the firewall rule names. The installed copy is installed (its setUp repairs a
        // missing Settings > Apps entry).
        S.Laptop.Installed = Install.RunningInstalled;
        S.Laptop.MissingPayload = Payload.Missing();
        S.Server.AppNotarized = Machine.AppNotarized;
        (S.Server.AppSize, S.Server.AppVersion) = Payload.MacAppInfo();
        S.SetupDone = Settings.SetupDone;
        S.Settings.ScaleOptions = Machine.ScaleOptions(out int recommended);
        int? saved = Settings.Scale;
        S.Settings.Scale = saved is int v && v >= 100 && v <= 300 ? v : recommended;
        S.Settings.MatchColors = Settings.ColorManaged;
        S.Settings.UseLaptopInput = Settings.Input;

        // Where the person is in setup (never in the page's storage).
        S.Setup.Started = Settings.SetupStarted;
        S.Setup.AxChoice = Settings.AxChoice;
        S.Setup.LoginSkip = Settings.LoginSkip;
        S.Setup.ElevationAsked = Settings.ElevationAsked;
        S.Setup.Hold = hold;
        if (hold != null) Log.Write("setup: holding " + hold);

        new Thread(Monitor) { IsBackground = true, Name = "Monitor" }.Start();
    }

    // The Mac display's scale (panel pixels per Mac point, in percent): the saved one, or the
    // recommended one. The window is 800 x 600 points at this scale.
    public int Scale { get { lock (gate) return S.Settings.Scale; } }

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

    // The window may be closed now: not while installing, while the admin step runs, handing
    // over, or holding the hand-over frame (the close light is greyed out then).
    public bool CanClose
    {
        get { lock (gate) return !S.Laptop.Installing && S.Laptop.Elevation != "working" && !S.Setup.HandingOff && S.Setup.Hold == null; }
    }

    public bool AdapterUp { get { lock (gate) return S.Link.AdapterUp; } }

    // ---- Watching this PC and the cable ----

    DateTime plugAt, lastServerTry = DateTime.MinValue, lastNeighbors = DateTime.MinValue, lastPoke = DateTime.MinValue;
    IPAddress macV6;
    int macMisses;  // neighbour-table reads in a row without the Mac; it counts as gone after 3
    readonly object serverGate = new();  // StartServers vs Shutdown (UI thread)
    string lastServerKey = "";
    TimeSpan serverRetry = TimeSpan.FromSeconds(3);
    DateTime firstTickAt;  // the first full look at the cable and the Mac (hold release)
    volatile bool macAnswered;

    void Monitor()
    {
        try { CheckLaptop(); } catch (Exception e) { Log.Write("check: " + e); lock (gate) Set(ref S.Laptop.Checked, true); laptopChecked.Set(); }
        while (true)
        {
            try { Tick(); } catch (Exception e) { Log.Write("monitor: " + e); }
            lock (gate) if (firstTickAt == default) firstTickAt = DateTime.UtcNow;
            MaybeReleaseHold();
            Thread.Sleep(500);
        }
    }

    // The slower checks: USB4 hardware, the firewall rule and the tasks (they run schtasks), this
    // exe's signature. The window stays hidden until they're done (laptop.checked).
    void CheckLaptop()
    {
        string usb4 = Machine.Usb4Status(out string router);
        lock (gate)
        {
            routerHardwareId = router;
            Set(ref S.Laptop.Usb4, usb4);
        }
        bool fw = Elevation.FirewallOk();
        bool tasks = Elevation.TasksOk(router);
        bool signed = Machine.IsSigned(Environment.ProcessPath);
        bool done = Elevation.Done(fw, tasks, router);
        string elevation = InitialElevation(done, fw, Settings.ElevationAsked, Settings.ElevationResult);
        if (!done && Settings.ElevationAsked && Settings.ElevationResult == 1)
            Log.Write(fw ? $"laptop: a recovery task is missing (router {router ?? "none"}); the admin step was done before, so setup goes on without it"
                         : "laptop: the firewall rules are gone although the admin step was done before; it asks again");
        lock (gate)
        {
            Set(ref S.Laptop.FirewallOk, fw);
            Set(ref S.Laptop.RecoveryTasksOk, tasks);
            Set(ref S.Laptop.Signed, signed);
            if (S.Laptop.Elevation == "none") Set(ref S.Laptop.Elevation, elevation);
            Set(ref S.Laptop.Checked, true);
        }
        laptopChecked.Set();
        Log.Write($"laptop: build {S.Laptop.WindowsBuild} {S.Laptop.Arch}, admin {S.Laptop.IsAdminUser}, usb4 {usb4} ({router}), " +
                  $"installed {S.Laptop.Installed}, running installed {S.Laptop.RunningInstalled}, signed {signed}, " +
                  $"firewall {fw}, tasks {tasks}, elevation {elevation}, started {S.Setup.Started}, done {S.SetupDone}");
    }

    // The admin step at start: done if its changes are there; else what the last request ended
    // with, if the host asked before (never asked again by itself after a No). A request that was
    // done, with the firewall rules still in place, now misses only a recovery task (a USB4 router
    // listed only since then, with the cable in): a tasks-only failure, silent, and setup goes on.
    // With the rules gone, the honest screen is the first question again.
    internal static string InitialElevation(bool done, bool firewallOk, bool asked, int savedResult) =>
        done ? "done"
        : !asked ? "none"
        : savedResult switch { 1 => firewallOk ? "failed" : "none", 2 => "refused", 3 => "failed", _ => "none" };

    // The cable's network is up, so this PC's USB4 works, whatever the check at start found
    // (some PCs only list their USB4 routers while something is plugged in). The check runs
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
            Set(ref S.Server.Error, !running && web.PortBusy ? "port" : "");
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
            if (shutDown || !Install.RunningInstalled) return;
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

    // ---- The hand-over frame (the installed copy's first frames, CONTRACT.md section 5) ----
    // The installed copy paints the downloaded copy's last frame until it has looked at
    // everything itself: this PC checked, a first look at the cable, the Mac's answer if the
    // cable is in (at most 2 s), and at least 300 ms in front.
    DateTime cameForwardAt;

    public void CameForward() { lock (gate) if (cameForwardAt == default) cameForwardAt = DateTime.UtcNow; MaybeReleaseHold(); }

    public void MaybeReleaseHold()
    {
        lock (gate)
        {
            if (S.Setup.Hold == null) return;
            var now = DateTime.UtcNow;
            bool late = now - startedAt > TimeSpan.FromSeconds(10);  // whatever happened, never stuck on it
            if (!late)
            {
                if (!S.Laptop.Checked || firstTickAt == default || cameForwardAt == default) return;
                if (now - cameForwardAt < TimeSpan.FromMilliseconds(300)) return;
                if (S.Link.AdapterUp && !macAnswered && now - firstTickAt < TimeSpan.FromSeconds(2)) return;
            }
            S.Setup.Hold = null;
            dirty = true;
        }
        Log.Write("setup: hold released");
    }

    // ---- Events from the servers, the Mac and the display ----

    public void OnWebRequest(string path) => Log.Write("web: GET " + path);
    public void OnPageVisited() { lock (gate) Set(ref S.Server.PageVisited, true); }

    DateTime settingsAt;

    // The page in Safari (and the Mac app's optional "opened"): e plus its k=v pairs.
    public void OnPageEvent(string e, IReadOnlyDictionary<string, string> q)
    {
        lock (gate)
        {
            var sv = S.Server;
            var now = DateTime.UtcNow;
            switch (e)
            {
                case "blur":
                    // A blur after a focus is a new one. The first blur after the download counts
                    // even if the page never reported a focus (a page opened with Safari already in
                    // front gets no focus event): it is the Mac's alert taking the focus.
                    if (sv.PageFocused || (sv.Download.Done && sv.PageBlurs == 0)) Set(ref sv.PageBlurs, sv.PageBlurs + 1);
                    Set(ref sv.PageFocused, false);
                    // Safari lost the focus a moment after Open Privacy & Security: System Settings
                    // is in front now (Safari's own question about it keeps the focus).
                    if (sv.SettingsOpened && now - settingsAt >= TimeSpan.FromSeconds(0.8)) Set(ref sv.LeftForSettings, true);
                    break;
                case "focus":
                    Set(ref sv.PageFocused, true);
                    // Back in Safari after System Settings: the page's button again, never Safari's question.
                    if (sv.LeftForSettings) { Set(ref sv.SettingsOpened, false); Set(ref sv.LeftForSettings, false); }
                    break;
                case "settings":
                    Set(ref sv.SettingsOpened, true);
                    Set(ref sv.LeftForSettings, false);
                    settingsAt = now;
                    break;
                case "download":
                    Set(ref sv.DownloadClicked, true);
                    break;
                case "look":
                    string dark = q.TryGetValue("dark", out var d) ? d : "";
                    Set(ref sv.PageAppearance, dark == "1" ? "dark" : dark == "0" ? "light" : sv.PageAppearance);
                    if (q.TryGetValue("accent", out var a) && a is "graphite" or "red" or "orange" or "yellow" or "green" or "blue" or "purple" or "pink" or "multicolor")
                        Set(ref sv.PageAccent, a);
                    break;
                case "opened":
                    if (Set(ref sv.AppOpened, true)) Log.Write("web: the Mac app says it was opened (version " + (q.TryGetValue("v", out var v) ? v : "?") + ")");
                    break;
            }
        }
    }

    public void OnDownload(long sent, long size, bool done)
    {
        lock (gate)
        {
            Set(ref S.Server.Download.Sent, sent);
            Set(ref S.Server.Download.Size, size);
            if (done)
            {
                Set(ref S.Server.Download.Done, true);
                // Counts from here: leaving Safari now means opening the app. A new download (Download
                // Again after Move to Trash) starts the opening over.
                Set(ref S.Server.PageBlurs, 0);
                Set(ref S.Server.DownloadClicked, false);
                Set(ref S.Server.SettingsOpened, false);
                Set(ref S.Server.LeftForSettings, false);
            }
        }
        if (done) Log.Write($"web: download complete, {size} bytes");
    }

    void OnMacV4(IPAddress a) { lock (gate) if (S.Link.MacV4 == "") Set(ref S.Link.MacV4, a.ToString()); }

    public void OnMacInfo(MacProbe.Info i)
    {
        macAnswered = true;
        lock (gate)
        {
            var m = S.Mac;
            Set(ref m.Reachable, true);
            Set(ref m.Outdated, false);
            // The UI asks for an update below version 4; the host only reports the version.
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
            Set(ref st.SettingsFront, Bit(Proto.StatusSettingsFront));
            Set(ref st.PromptUp, Bit(Proto.StatusPromptUp));
            // Mac app 5: a password or Touch ID request, and where this PC's display is.
            Set(ref st.AuthUp, Bit(Proto.StatusAuthUp));
            Set(ref st.DisplaySide, Bit(Proto.StatusDisplayRight) ? "right" : Bit(Proto.StatusDisplayLeft) ? "left"
                                  : Bit(Proto.StatusDisplayAbove) ? "above" : Bit(Proto.StatusDisplayBelow) ? "below" : "");
            if (i.AppVersion >= 4)
            {
                Set(ref m.Appearance, Bit(Proto.StatusMacDark) ? "dark" : "light");
                Set(ref m.Accent, i.Accent switch
                {
                    1 => "graphite", 2 => "red", 3 => "orange", 4 => "yellow", 5 => "green", 6 => "blue", 7 => "purple", 8 => "pink",
                    _ => "multicolor",
                });
            }
        }
    }

    // Mac status keeps its last values while the app is away (e.g. relaunching): check reachable.
    public void OnMacUnreachable() { lock (gate) { Set(ref S.Mac.Reachable, false); Set(ref S.Mac.Outdated, false); } }
    public void OnMacOutdated()
    {
        macAnswered = true;
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
        bool firstShow = false;
        lock (gate)
        {
            Set(ref S.Screen.Running, running);
            Set(ref S.Screen.Showing, showing);
            // The Mac desktop showed on this PC: setup is done, whatever happens next (Done
            // closes the window; the cable starts the display from now on).
            if (showing && !S.SetupDone) { Set(ref S.SetupDone, true); firstShow = true; }
        }
        if (firstShow)
        {
            Settings.Save("SetupDone", 1);
            Log.Write("screen: the Mac desktop shows on this PC; setup done");
        }
        if (!running)
        {
            EndHandover();
            ScreenClosed?.Invoke();
        }
    }

    public void OnReceiverStarting()
    {
        lock (gate)
        {
            Set(ref S.Screen.PointerOnLaptop, false);
            Set(ref S.Screen.InputOk, false);
        }
    }

    public void OnReceiverExited(string error)
    {
        lock (gate) if (error != "") Set(ref S.Screen.Error, error);
        if (error != "") Log.Write("screen: ended before the Mac desktop showed: " + error);
        OnScreen(running: false, showing: false);  // the next Tick sees a display the watcher started
    }

    public void OnPictureShown(IntPtr window, int pid) => PictureShown?.Invoke(window, pid);
    public void OnPointerOnLaptop() { lock (gate) Set(ref S.Screen.PointerOnLaptop, true); }
    public void OnInputState(bool allowed) { lock (gate) Set(ref S.Screen.InputOk, allowed); }

    // ---- Commands from the UI ----

    // The page's current frame, for the hand-over hold: "screen|sub|status|theme|accent|active"
    // (active: 1 or 0, whether the page drew the window in front: the lights).
    string lastFrame;
    public void SetFrame(string screen, string sub, string status, string theme, string accent, bool active)
    {
        static string Clean(string s) => (s ?? "").Replace("|", "").Replace("\"", "").Trim();
        lock (gate) lastFrame = $"{Clean(screen)}|{Clean(sub)}|{Clean(status)}|{Clean(theme)}|{Clean(accent)}|{(active ? "1" : "0")}";
    }

    // place{axChoice?, loginSkip?}: the person's answers, kept for later runs.
    public void Place(string axChoice, bool? loginSkip)
    {
        if (axChoice is "" or "yes" or "no")
        {
            lock (gate) Set(ref S.Setup.AxChoice, axChoice);
            Settings.Save("AxChoice", axChoice == "yes" ? 1 : axChoice == "no" ? 2 : 0);
        }
        if (loginSkip == true)
        {
            lock (gate) Set(ref S.Setup.LoginSkip, true);
            Settings.Save("LoginSkip", 1);
        }
    }

    // setUp (Continue, Try Again on an install error, or the page by itself in a copy that should
    // install): install if needed, ask Windows once (no earlier than 3 s after Continue, so
    // "click Yes" can be read first), then, from a copy outside the install folder, hand over to
    // the installed copy. One at a time.
    int setUpBusy;
    DateTime setUpAt, installEnd = DateTime.MinValue;

    public void SetUp()
    {
        lock (gate)
        {
            if (S.Setup.HandingOff || Interlocked.CompareExchange(ref setUpBusy, 1, 0) != 0) return;
            setUpAt = DateTime.UtcNow;
            Set(ref S.Setup.Started, true);
            Set(ref S.Laptop.InstallError, "");
            // Shown at once, so the frame after Continue is already "Installing…".
            if (!S.Laptop.RunningInstalled || !Install.IsInstalled) Set(ref S.Laptop.Installing, true);
        }
        Settings.Save("SetupStarted", 1);
        Task.Run(SetUpWork);
    }

    void SetUpWork()
    {
        bool handingOff = false;
        try
        {
            bool installed = Install.RunningInstalled;
            if (!installed || !Install.IsInstalled)
            {
                lock (gate) Set(ref S.Laptop.Installing, true);
                try { Install.Run(); }
                catch (Exception e)
                {
                    string code = Install.InUse(e) ? "inUse" : "other";
                    Log.Write($"install: failed ({code}): {e}");
                    lock (gate) { Set(ref S.Laptop.Installing, false); Set(ref S.Laptop.InstallError, code); }
                    return;
                }
                lock (gate)
                {
                    Set(ref S.Laptop.Installing, false);
                    Set(ref S.Laptop.Installed, Install.IsInstalled);
                    installEnd = DateTime.UtcNow;
                }
            }

            laptopChecked.Wait(TimeSpan.FromSeconds(20));
            while (Volatile.Read(ref elevating) != 0) Thread.Sleep(100);  // a Try Again already asking
            bool ask;
            lock (gate) ask = !ElevationOk && !S.Setup.ElevationAsked;
            if (ask)
            {
                // "Click Yes" has been on screen for 3 s, and "Installed" for a moment.
                var at = setUpAt + TimeSpan.FromSeconds(3.0);
                if (installEnd + TimeSpan.FromSeconds(0.7) > at) at = installEnd + TimeSpan.FromSeconds(0.7);
                var wait = at - DateTime.UtcNow;
                if (wait > TimeSpan.Zero) Thread.Sleep(wait);
                handingOff = ElevateSync(handOff: !installed);
            }
            else if (!installed)
            {
                lock (gate) Set(ref S.Setup.HandingOff, true);
                handingOff = true;
            }
            if (handingOff)
            {
                // Long enough for the page to draw the hand-over frame ("This PC is ready"), which
                // the installed copy then holds.
                Thread.Sleep(600);
                string frame;
                // The status is the page's strings.js key (the page sends it in "frame").
                lock (gate) frame = lastFrame ?? $"allow-pc|done|status.pcReady|{(Machine.DarkMode() ? "dark" : "light")}|blue|1";
                Log.Write("setup: handing over to the installed copy, frame " + frame);
                InstalledElsewhere?.Invoke(frame);
            }
        }
        catch (Exception e) { Log.Write("setup: " + e); }
        finally { if (!handingOff) Volatile.Write(ref setUpBusy, 0); }
    }

    // The hand-over couldn't start the installed copy: carry on here, as an install error the
    // person can try again.
    public void HandOffFailed()
    {
        lock (gate)
        {
            Set(ref S.Setup.HandingOff, false);
            Set(ref S.Laptop.InstallError, "other");
        }
        Resume();
        Volatile.Write(ref setUpBusy, 0);
    }

    // The admin step's result lets setup go on: done, or only the recovery tasks missing.
    bool ElevationOk => S.Laptop.Elevation == "done" || (S.Laptop.Elevation == "failed" && S.Laptop.FirewallOk);

    // elevate (Continue on "ask", Try Again): asks Windows now, even if it was asked before.
    public void Elevate() => Task.Run(() => { try { ElevateSync(handOff: false); } catch (Exception e) { Log.Write("elevate: " + e); } });

    int elevating;

    // The one UAC prompt. Returns whether it started the hand-over (handOff, in the same snapshot
    // as the result).
    bool ElevateSync(bool handOff)
    {
        if (Interlocked.CompareExchange(ref elevating, 1, 0) != 0) return false;
        try
        {
            lock (gate)
            {
                Set(ref S.Laptop.Elevation, "pending");
                Set(ref S.Setup.ElevationAsked, true);
            }
            Settings.Save("ElevationAsked", 1);
            Thread.Sleep(400);  // "Waiting for you to click Yes…" is drawn before Windows dims the screen
            int code = Elevation.RunElevated("--elevated", out bool refused, OwnerWindow?.Invoke() ?? IntPtr.Zero,
                onStarted: () => { lock (gate) Set(ref S.Laptop.Elevation, "working"); });
            Machine.Usb4Status(out string router);
            bool fw = Elevation.FirewallOk(), tasks = Elevation.TasksOk(router);
            string result = refused ? "refused" : Elevation.Done(fw, tasks, router) ? "done" : "failed";
            lock (gate)
            {
                routerHardwareId = router;
                Set(ref S.Laptop.FirewallOk, fw);
                Set(ref S.Laptop.RecoveryTasksOk, tasks);
                // The firewall rules may be there even when something else failed: firewallOk says.
                Set(ref S.Laptop.Elevation, result);
                if (handOff) Set(ref S.Setup.HandingOff, true);
            }
            Settings.Save("ElevationResult", result == "done" ? 1 : result == "refused" ? 2 : 3);
            Log.Write($"elevate: code {code}, {result}, firewall {fw}, tasks {tasks}");
            return handOff;
        }
        finally { Volatile.Write(ref elevating, 0); }
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
        }
        Settings.Save("Scale", Scale);
        lock (gate)
        {
            Settings.Save("ColorManaged", S.Settings.MatchColors ? 1 : 0);
            Settings.Save("Input", S.Settings.UseLaptopInput ? 1 : 0);
        }
    }

    // startScreen: the display, with the Mac's copy of this window first (the handover). Called
    // on the UI thread.
    public void StartScreen()
    {
        // Try Again on "Unable to Show Your Mac Desktop" (no picture 30 s after the start): the
        // display that never showed may still be running, waiting. It goes first (WM_CLOSE, so
        // it exits within moments), so the new start isn't refused as "already running".
        bool stuck;
        lock (gate) stuck = S.Screen.Running && !S.Screen.Showing;
        if (stuck)
        {
            Log.Write("screen: a display that never showed is still running; stopping it before starting again");
            try { receiver.Stop(); } catch (Exception e) { Log.Write("screen: stop: " + e.Message); }
            EndHandover();
            lock (gate) Set(ref S.Screen.Running, receiver.Running);
        }

        bool ok;
        lock (gate)
        {
            var m = S.Mac;
            var st = m.Status;
            ok = m.Reachable && !m.Outdated && ulong.TryParse(m.AppVersion, out ulong v) && v >= 4 && st.ScreenOk && !st.ScreenNeedsRelaunch
                 && S.Link.AdapterUp && !S.Screen.Running && S.Laptop.RunningInstalled;
            Set(ref S.Screen.Error, "");
        }
        if (!ok)
        {
            Log.Write("screen: can't start now (the Mac app, Screen Recording, the cable, or the display already running)");
            lock (gate) Set(ref S.Screen.Error, "other");
            return;
        }

        try { PrepareForHandover?.Invoke(); } catch (Exception e) { Log.Write("screen: " + e.Message); }

        // The settings the display starts with, also for the watcher later: the recommended
        // size and matched colours unless chosen before; this PC's keyboard and trackpad only
        // when the Mac allows it and the person didn't say Not Now.
        int scale; bool colors, input;
        lock (gate)
        {
            input = S.Mac.Status.AxOk && S.Setup.AxChoice != "no";
            Set(ref S.Settings.UseLaptopInput, input);
            if (Settings.GetInt("ColorManaged") == null) Set(ref S.Settings.MatchColors, true);
            scale = S.Settings.Scale;
            colors = S.Settings.MatchColors;
        }
        if (Settings.Scale == null) Settings.Save("Scale", scale);
        if (Settings.GetInt("ColorManaged") == null) Settings.Save("ColorManaged", 1);
        Settings.Save("Input", input ? 1 : 0);

        // The handover: the Mac gets this window's spot first, then the display starts and waits
        // for that window (--after-mac-window).
        bool handover = !receiver.Running && WindowPlace?.Invoke() is { } place && probe.SendWindow(place.Panel, place.DpiPercent);
        mirroring = handover;
        if (handover) { lock (gate) mirrorSent = ""; MirrorIfChanged(); }
        Log.Write("screen: " + (handover ? "the Mac opens this window on its new display" : "no handover"));
        string error = receiver.Start(scale, colors, input, handover);
        if (error != null)
        {
            EndHandover();
            lock (gate) Set(ref S.Screen.Error, error);
        }
    }

    // Return to Windows: the display stops first, so this PC's copy is already there when the
    // Mac's copy closes. The page shows "hidden" then.
    public void StopScreen()
    {
        Task.Run(() =>
        {
            try { receiver.Stop(); } catch (Exception e) { Log.Write("screen: stop: " + e.Message); }
            EndHandover();
            lock (gate) Set(ref S.Screen.Running, receiver.Running);
        });
    }

    // Done: the Mac desktop stays; the setup window goes, on both computers.
    public void Finish()
    {
        bool save;
        lock (gate) { save = !S.SetupDone; Set(ref S.SetupDone, true); }
        if (save) Settings.Save("SetupDone", 1);  // the display was started elsewhere (the watcher)
        EndHandover();
        Install.StartWatcher();
        Log.Write("finish: setup done");
    }

    volatile bool shutDown;

    // Frees port 80 and 5353 for the installed copy taking over; Resume if that didn't start.
    public void Shutdown()
    {
        lock (serverGate)
        {
            shutDown = true;
            web.Stop();
            mdns.Stop();
            lastServerKey = "";
        }
        probe.SetTarget(null);
    }

    public void Resume() => shutDown = false;
}
