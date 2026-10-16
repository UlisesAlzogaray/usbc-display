using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;

namespace UsbcSetup;

// Files built into this exe: ui/** (the wizard screens), web/** (the Mac's download page) and
// payload/* (what gets installed). Names use '/' whichever OS built the exe.
static class Resources
{
    static readonly Assembly Me = typeof(Resources).Assembly;
    static readonly Dictionary<string, string> Names = Index();

    static Dictionary<string, string> Index()
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var n in Me.GetManifestResourceNames()) d[n.Replace('\\', '/')] = n;
        return d;
    }

    public static bool Has(string name) => Names.ContainsKey(name);

    public static Stream Open(string name) => Names.TryGetValue(name, out var real) ? Me.GetManifestResourceStream(real) : null;

    public static byte[] Get(string name)
    {
        using var s = Open(name);
        if (s == null) return null;
        var ms = new MemoryStream();
        s.CopyTo(ms);
        return ms.ToArray();
    }

    public static string ContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" or ".htm" => "text/html; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".js" or ".mjs" => "text/javascript; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        ".ico" => "image/x-icon",
        ".woff2" => "font/woff2",
        ".woff" => "font/woff",
        ".ttf" => "font/ttf",
        ".mp4" => "video/mp4",
        ".webm" => "video/webm",
        ".txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };
}

// A plain log next to the receiver's, for when something goes wrong on a real machine.
static class Log
{
    static readonly object Gate = new();
    public static readonly string Dir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UsbcDisplay");
    static readonly string FilePath = Path.Combine(Dir, "setup.log");
    static bool started;

    public static void Write(string line)
    {
        lock (Gate)
        {
            try
            {
                Directory.CreateDirectory(Dir);
                if (!started)
                {
                    started = true;
                    if (File.Exists(FilePath) && new FileInfo(FilePath).Length > (1 << 20)) File.Delete(FilePath);
                }
                File.AppendAllText(FilePath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{Environment.ProcessId}] {line}\r\n");
            }
            catch { }
        }
    }
}
