using System;
using System.Diagnostics;
using System.IO;

namespace UsbcSetup;

// Starts the display (UsbcDisplay.exe) the way the watcher does (UsbcWatcher.cs StartReceiver),
// minus DOTNET_ROOT: the installed receiver is self-contained. Its output lines say what happens
// (CONTRACT.md, "Receiver output lines"); everything it prints also goes to receiver.log.
sealed class Receiver
{
    public const int ExitRefused = 3;  // "Refused: screen recording"

    readonly Wizard wizard;
    Process process;
    StreamWriter log;

    public Receiver(Wizard wizard) { this.wizard = wizard; }

    public bool Running
    {
        get
        {
            try { if (process != null && !process.HasExited) return true; } catch { }
            foreach (var p in Process.GetProcessesByName("UsbcDisplay")) { p.Dispose(); return true; }  // e.g. started by the watcher
            return false;
        }
    }

    // Returns null when it started (or already runs), else the screen.error code:
    // "receiver-missing" (no UsbcDisplay.exe) or "other".
    public string Start(int scale, bool matchColors, bool useInput, bool afterMacWindow = false)
    {
        if (Running) return null;  // already up (started here or by the watcher)
        string exe = File.Exists(Install.ReceiverPath) ? Install.ReceiverPath : Path.Combine(AppContext.BaseDirectory, "UsbcDisplay.exe");
        if (!File.Exists(exe))
        {
            Log.Write("screen: no receiver at " + exe);
            return "receiver-missing";
        }

        string args = $"--exit-when-unplugged --scale {scale}" + (matchColors ? "" : " --no-color-profile") + (useInput ? "" : " --no-input") +
                      (afterMacWindow ? " --after-mac-window" : "");
        var psi = new ProcessStartInfo(exe, args)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Path.GetDirectoryName(exe),
        };
        psi.EnvironmentVariables.Remove("DOTNET_ROOT");
        CloseLog();  // the last run's, or this one couldn't open the file
        try
        {
            Directory.CreateDirectory(Log.Dir);
            log = new StreamWriter(Path.Combine(Log.Dir, "receiver.log"), false) { AutoFlush = true };
        }
        catch { log = null; }

        var run = new Run();
        var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
        DataReceivedEventHandler onLine = (_, e) =>
        {
            if (e.Data == null) return;
            OnLine(run, p, e.Data.Trim());
            var l = log;
            if (l != null) lock (l) { try { l.WriteLine(e.Data); } catch { } }
        };
        p.OutputDataReceived += onLine;
        p.ErrorDataReceived += onLine;
        p.Exited += (_, _) =>
        {
            try { p.WaitForExit(); } catch { }  // its last lines
            int code = -1;
            try { code = p.ExitCode; } catch { }
            Log.Write($"screen: receiver exited ({code})");
            if (process == p) CloseLog();
            // Why it ended before the Mac desktop showed, for the setup's Ready screen.
            string error = "";
            if (run.Refused || code == ExitRefused) error = "screen-recording-off";
            else if (!run.Shown && !run.StopRequested && wizard.AdapterUp) error = "exited";
            // A newer run started meanwhile (Try Again after a display that never showed): this
            // one's end must not end that one's handover.
            if (current == run || current == null) wizard.OnReceiverExited(error);
            else Log.Write("screen: an earlier display ended; a newer one runs");
            run.Reported.Set();
        };
        wizard.OnReceiverStarting();  // a new run: no pointer, no input answer yet
        try
        {
            AllowSetForegroundWindow(-1);  // the display should take the keyboard as soon as it shows
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
        }
        catch (Exception e)
        {
            Log.Write("screen: " + e.Message);
            return "other";
        }
        current = run;
        process = p;
        Log.Write($"screen: started {exe} {args}");
        wizard.OnScreen(running: true, showing: false);
        return null;
    }

    // One run of the receiver: what its output said so far.
    sealed class Run
    {
        public volatile bool Shown, Refused, StopRequested;
        public long Window;
        public readonly System.Threading.ManualResetEventSlim Reported = new(false);  // its end went to the wizard
    }
    volatile Run current;

    void OnLine(Run run, Process p, string line)
    {
        if (line.StartsWith("Window: ", StringComparison.Ordinal))
        {
            if (long.TryParse(line.AsSpan(8), out long h)) run.Window = h;
        }
        else if (line.StartsWith("Picture on screen", StringComparison.Ordinal))
        {
            // The Mac desktop is on screen (after the Mac's copy of the setup window is drawn,
            // with --after-mac-window). The first time, the display gets the keyboard.
            bool first = !run.Shown;
            run.Shown = true;
            wizard.OnScreen(running: true, showing: true);
            if (first)
            {
                int pid = 0;
                try { pid = p.Id; } catch { }
                wizard.OnPictureShown(new IntPtr(run.Window), pid);
            }
        }
        else if (line.StartsWith("Pointer on screen", StringComparison.Ordinal)) wizard.OnPointerOnLaptop();
        else if (line.StartsWith("Input: allowed", StringComparison.Ordinal)) wizard.OnInputState(true);
        else if (line.StartsWith("Input: not allowed", StringComparison.Ordinal)) wizard.OnInputState(false);
        else if (line.StartsWith("Refused: screen recording", StringComparison.Ordinal)) run.Refused = true;
    }

    void CloseLog()
    {
        var l = log;
        log = null;
        if (l != null) lock (l) { try { l.Dispose(); } catch { } }
    }

    // Closes the display the way Ctrl-Alt-Esc does (its window closes and it quits, restoring
    // what it changed, e.g. the Windows pointer shadow): WM_CLOSE to its window, the one its
    // "Window:" line named, or any display window (the watcher's). Killed only if it is still
    // running 3 s later.
    public void Stop()
    {
        var run = current;
        if (run != null) run.StopRequested = true;
        if (run != null && run.Window != 0 && IsWindow(new IntPtr(run.Window))) PostMessage(new IntPtr(run.Window), WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        for (IntPtr w = FindWindow("UsbcDisplayWindow", null); w != IntPtr.Zero; w = FindWindowEx(IntPtr.Zero, w, "UsbcDisplayWindow", null))
            PostMessage(w, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        foreach (var p in Process.GetProcessesByName("UsbcDisplay"))
        {
            try
            {
                if (!p.WaitForExit(3000) && !(p.CloseMainWindow() && p.WaitForExit(500))) p.Kill();
            }
            catch { }
            finally { p.Dispose(); }
        }
        // Its end has reached the wizard before this returns, so a start right after is never
        // undone by a late "it ended".
        if (run != null) run.Reported.Wait(1000);
    }

    const int WM_CLOSE = 0x0010;
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, int msg, IntPtr w, IntPtr l);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    static extern IntPtr FindWindow(string cls, string title);
    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
}
