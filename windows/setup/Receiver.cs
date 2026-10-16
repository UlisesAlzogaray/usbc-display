using System;
using System.Diagnostics;
using System.IO;

namespace UsbcSetup;

// Starts the screen (UsbcDisplay.exe) the way the watcher does (UsbcWatcher.cs StartReceiver),
// minus DOTNET_ROOT: the installed receiver is self-contained.
sealed class Receiver
{
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

    public string Start(int scale, bool matchColors, bool useInput)
    {
        if (Running) return null;  // already up (started here or by the watcher)
        string exe = File.Exists(Install.ReceiverPath) ? Install.ReceiverPath : Path.Combine(AppContext.BaseDirectory, "UsbcDisplay.exe");
        if (!File.Exists(exe)) return "The screen part of USB-C Display isn't installed yet.";

        string args = $"--exit-when-unplugged --scale {scale}" + (matchColors ? "" : " --no-color-profile") + (useInput ? "" : " --no-input");
        var psi = new ProcessStartInfo(exe, args)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Path.GetDirectoryName(exe),
        };
        psi.EnvironmentVariables.Remove("DOTNET_ROOT");
        try
        {
            Directory.CreateDirectory(Log.Dir);
            log = new StreamWriter(Path.Combine(Log.Dir, "receiver.log"), false) { AutoFlush = true };
        }
        catch { log = null; }

        var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
        DataReceivedEventHandler onLine = (_, e) =>
        {
            if (e.Data == null) return;
            if (e.Data.StartsWith("Showing")) wizard.OnScreen(running: true, showing: true);
            var l = log;
            if (l != null) lock (l) { try { l.WriteLine(e.Data); } catch { } }
        };
        p.OutputDataReceived += onLine;
        p.ErrorDataReceived += onLine;
        p.Exited += (_, _) =>
        {
            Log.Write("screen: receiver exited");
            wizard.OnScreen(running: false, showing: false);
        };
        try
        {
            AllowSetForegroundWindow(-1);  // the screen should take the keyboard as soon as it shows
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
        }
        catch (Exception e)
        {
            Log.Write("screen: " + e.Message);
            return "Couldn't start the screen: " + e.Message;
        }
        process = p;
        Log.Write($"screen: started {exe} {args}");
        wizard.OnScreen(running: true, showing: false);
        return null;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);
}
