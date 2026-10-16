using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security;
using System.Security.Principal;
using System.Text;
using System.Xml.Linq;

namespace UsbcSetup;

// The one admin step. "--elevated <user SID>" does only this, then exits:
//   1. Inbound firewall rules so the Mac can reach this app over the cable: TCP 80 (the download
//      page) and UDP 5353 (the name usbc.local), only from link-local addresses (the cable),
//      only for this program.
//   2. The two tasks tools/register-recovery-task.ps1 registers: each runs one fixed pnputil
//      command as SYSTEM to restart a stuck USB4 link. The user may start them, not change them.
// "--elevated-remove" undoes both (uninstall).
static class Elevation
{
    public const string RuleName = "USB-C Display (cable only)";
    const string RuleDescription = "Lets your Mac download USB-C Display from this laptop and find it by name. Only over the USB-C cable.";
    const string RemoteAddresses = "fe80::/10,169.254.0.0/16";
    const string TaskFolder = "USB-C Display";
    const string RouterTask = "Restart USB4 link", AdapterTask = "Restart USB4 network adapter";
    const string Pnputil = @"C:\Windows\System32\pnputil.exe";  // the receiver (Link.cs) checks this exact command
    const string AdapterHardwareId = @"USB4\USB4NET";

    static string System32 => Environment.SystemDirectory;

    // The setup exe the firewall rule names: the installed copy once there is one.
    public static string ProgramPath => File.Exists(Install.SetupPath) ? Install.SetupPath : Environment.ProcessPath;

    // ---- From the normal (not elevated) app ----

    // Runs this exe elevated with a fixed argument. Returns its exit code; refused = UAC declined.
    public static int RunElevated(string verb, out bool refused)
    {
        refused = false;
        string sid;
        using (var id = WindowsIdentity.GetCurrent()) sid = id.User?.Value ?? "";
        var psi = new ProcessStartInfo(ProgramPath, verb == "--elevated" ? $"{verb} {sid}" : verb)
        {
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = System32,
        };
        try
        {
            using var p = Process.Start(psi);
            if (p == null) return -1;
            p.WaitForExit();
            Log.Write($"elevate: {verb} exited {p.ExitCode}");
            return p.ExitCode;
        }
        catch (Win32Exception e) when (e.NativeErrorCode == 1223)  // ERROR_CANCELLED: "No" in the UAC prompt
        {
            refused = true;
            Log.Write("elevate: refused");
            return 1223;
        }
        catch (Exception e)
        {
            Log.Write("elevate: " + e.Message);
            return -1;
        }
    }

    // Both rules are there, enabled, for the installed program. Read through the Windows Firewall
    // API, which needs no admin rights and doesn't depend on the Windows language or code page.
    public static bool FirewallOk()
    {
        bool tcp = false, udp = false;
        foreach (dynamic r in OurRules())
        {
            try
            {
                if (!(bool)r.Enabled || (int)r.Direction != 1 /*in*/ || (int)r.Action != 1 /*allow*/) continue;
                if (!SamePath((string)r.ApplicationName, ProgramPath)) continue;
                int proto = (int)r.Protocol;
                string ports = (string)r.LocalPorts;
                if (proto == 6 && ports == "80") tcp = true;
                if (proto == 17 && ports == "5353") udp = true;
            }
            catch { }
        }
        return tcp && udp;
    }

    public static bool FirewallRuleExists() => OurRules().Count > 0;

    static List<object> OurRules()
    {
        var list = new List<object>();
        try
        {
            dynamic policy = Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FwPolicy2", true));
            foreach (dynamic r in policy.Rules)
                try { if ((string)r.Name == RuleName) list.Add(r); } catch { }
        }
        catch (Exception e) { Log.Write("firewall: can't read the rules: " + e.Message); }
        return list;
    }

    static bool SamePath(string a, string b)
    {
        if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
        try { a = Path.GetFullPath(Environment.ExpandEnvironmentVariables(a)); b = Path.GetFullPath(b); } catch { return false; }
        return string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    }

    // The recovery tasks that apply here: the adapter task always, the router task only when a
    // USB4 router was found (without one there is nothing to restart).
    public static bool TasksOk(string routerHardwareId) =>
        TaskRuns(AdapterTask, RestartArgs(AdapterHardwareId)) &&
        (routerHardwareId == null || TaskRuns(RouterTask, RestartArgs(routerHardwareId)));

    // The admin step counts as done when the firewall rules are in place and, on a laptop with a
    // USB4 router, the recovery tasks too. The rules alone are what the Mac's download needs.
    public static bool Done(bool firewallOk, bool tasksOk, string routerHardwareId) =>
        firewallOk && (routerHardwareId == null || tasksOk);

    public static bool AnyTaskExists() =>
        Run(Path.Combine(System32, "schtasks.exe"), $"/query /tn \"\\{TaskFolder}\\{RouterTask}\"", out _) == 0 ||
        Run(Path.Combine(System32, "schtasks.exe"), $"/query /tn \"\\{TaskFolder}\\{AdapterTask}\"", out _) == 0;

    static string RestartArgs(string hardwareId) => $"/restart-device /deviceid \"{hardwareId}\"";

    // The task exists and runs exactly pnputil with these arguments (as Link.cs HasSilentRestart checks).
    static bool TaskRuns(string name, string args)
    {
        try
        {
            if (Run(Path.Combine(System32, "schtasks.exe"), $"/query /tn \"\\{TaskFolder}\\{name}\" /xml", out string xml) != 0) return false;
            var doc = XDocument.Parse(xml);
            var ns = doc.Root.Name.Namespace;
            var execs = doc.Root.Element(ns + "Actions")?.Elements(ns + "Exec").ToList() ?? new List<XElement>();
            return execs.Count == 1 &&
                   string.Equals((string)execs[0].Element(ns + "Command"), Pnputil, StringComparison.OrdinalIgnoreCase) &&
                   (string)execs[0].Element(ns + "Arguments") == args;
        }
        catch { return false; }
    }

    // ---- In the elevated copy ----

    // Exit code: 0 everything done, 1 firewall failed, 2 tasks failed, 3 both.
    public static int ElevatedSetup(string userSid)
    {
        try { userSid = new SecurityIdentifier(userSid ?? "").Value; }
        catch { using var id = WindowsIdentity.GetCurrent(); userSid = id.User?.Value; }
        int code = 0;
        if (!AddFirewallRules()) code |= 1;
        if (!RegisterTasks(userSid)) code |= 2;
        Log.Write($"elevated: setup done, code {code}");
        return code;
    }

    static bool AddFirewallRules()
    {
        string netsh = Path.Combine(System32, "netsh.exe");
        Run(netsh, $"advfirewall firewall delete rule name=\"{RuleName}\"", out _);  // replace, never duplicate
        bool ok = true;
        foreach (var (proto, port) in new[] { ("TCP", "80"), ("UDP", "5353") })
        {
            int code = Run(netsh,
                $"advfirewall firewall add rule name=\"{RuleName}\" dir=in action=allow enable=yes profile=any " +
                $"protocol={proto} localport={port} remoteip={RemoteAddresses} edge=no " +
                $"program=\"{Environment.ProcessPath}\" description=\"{RuleDescription}\"", out string text);
            if (code != 0) { ok = false; Log.Write($"elevated: firewall {proto} {port}: {code} {text.Trim()}"); }
        }
        return ok;
    }

    // Fails only when a task that applies here couldn't be registered: with no USB4 router there
    // is nothing to restart, so the adapter task is then best effort.
    static bool RegisterTasks(string userSid)
    {
        Machine.Usb4Status(out string router);
        bool adapter = RegisterTask(AdapterTask, RestartArgs(AdapterHardwareId), userSid,
            "USB-C Display: restarts only the USB4 network adapter (a cheaper reset, tried first).");
        if (router == null)
        {
            Log.Write("elevated: no USB4 router found, link restart task not registered");
            return true;
        }
        bool routerOk = RegisterTask(RouterTask, RestartArgs(router), userSid,
            "USB-C Display: restarts the USB4 root router, the software equivalent of replugging the cable. Used when the USB4 network link stops passing data.");
        return adapter && routerOk;
    }

    // Ported from tools/register-recovery-task.ps1.
    static bool RegisterTask(string name, string args, string userSid, string description)
    {
        string E(string s) => SecurityElement.Escape(s);
        string xml = $"""
            <?xml version="1.0" encoding="UTF-16"?>
            <Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
              <RegistrationInfo>
                <Author>USB-C Display</Author>
                <Description>{E(description)}</Description>
                <SecurityDescriptor>D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;{E(userSid)})</SecurityDescriptor>
              </RegistrationInfo>
              <Principals>
                <Principal id="System">
                  <UserId>S-1-5-18</UserId>
                  <RunLevel>HighestAvailable</RunLevel>
                </Principal>
              </Principals>
              <Settings>
                <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
                <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
                <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
                <AllowStartOnDemand>true</AllowStartOnDemand>
                <AllowHardTerminate>true</AllowHardTerminate>
                <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
                <Priority>4</Priority>
                <Enabled>true</Enabled>
              </Settings>
              <Actions Context="System">
                <Exec>
                  <Command>{Pnputil}</Command>
                  <Arguments>{E(args)}</Arguments>
                </Exec>
              </Actions>
            </Task>
            """;
        string file = Path.Combine(Path.GetTempPath(), $"usbc-display-task-{Guid.NewGuid():N}.xml");
        try
        {
            File.WriteAllText(file, xml, Encoding.Unicode);
            int code = Run(Path.Combine(System32, "schtasks.exe"), $"/create /tn \"\\{TaskFolder}\\{name}\" /xml \"{file}\" /f", out string text);
            if (code != 0) Log.Write($"elevated: task {name}: {code} {text.Trim()}");
            return code == 0;
        }
        catch (Exception e) { Log.Write($"elevated: task {name}: {e.Message}"); return false; }
        finally { try { File.Delete(file); } catch { } }
    }

    // Exit code 0 when the rules and tasks are gone.
    public static int ElevatedRemove()
    {
        string netsh = Path.Combine(System32, "netsh.exe"), schtasks = Path.Combine(System32, "schtasks.exe");
        Run(netsh, $"advfirewall firewall delete rule name=\"{RuleName}\"", out _);
        foreach (var name in new[] { RouterTask, AdapterTask })
            Run(schtasks, $"/delete /tn \"\\{TaskFolder}\\{name}\" /f", out _);
        try
        {
            dynamic scheduler = Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service"));
            scheduler.Connect();
            scheduler.GetFolder("\\").DeleteFolder(TaskFolder, 0);
        }
        catch { }
        return FirewallRuleExists() || AnyTaskExists() ? 1 : 0;
    }

    static int Run(string exe, string args, out string output)
    {
        output = "";
        try
        {
            var psi = new ProcessStartInfo(exe, args)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var p = Process.Start(psi);
            var outText = p.StandardOutput.ReadToEndAsync();
            var errText = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(30000))
            {
                try { p.Kill(true); } catch { }
                Log.Write($"{Path.GetFileName(exe)}: no answer in 30 s, stopped");
                return -1;
            }
            p.WaitForExit();  // lets the output reads finish
            output = (outText.Wait(2000) ? outText.Result : "") + (errText.Wait(2000) ? errText.Result : "");
            return p.ExitCode;
        }
        catch (Exception e)
        {
            output = e.Message;
            return -1;
        }
    }
}
