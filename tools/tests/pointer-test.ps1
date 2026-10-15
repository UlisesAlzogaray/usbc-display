# Pointer test: clicks (position, count), taps, double clicks, drag, crossing to the Mac's own
# screen and back, and the Mac moving its pointer away. Synthetic input here, checked there.
. "$PSScriptRoot\linklib.ps1"
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Threading;
public static class Ptr {
  [StructLayout(LayoutKind.Explicit, Size = 40)] struct INPUT {
    [FieldOffset(0)] public int type;
    [FieldOffset(8)] public int dx; [FieldOffset(12)] public int dy; [FieldOffset(16)] public int mouseData; [FieldOffset(20)] public uint mflags;
  }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  static void Send(INPUT i, int sleep) { SendInput(1, new[] { i }, 40); if (sleep > 0) Thread.Sleep(sleep); }
  public static void MoveTo(int x, int y) { Send(new INPUT { type = 0, dx = x * 65535 / 1919, dy = y * 65535 / 1199, mflags = 0x8001 }, 30); }
  public static void MoveBy(int dx, int dy) { Send(new INPUT { type = 0, dx = dx, dy = dy, mflags = 1 }, 15); }
  public static void Down() { Send(new INPUT { type = 0, mflags = 2 }, 0); }
  public static void Up() { Send(new INPUT { type = 0, mflags = 4 }, 0); }
  public static string Cursor() { POINT p; GetCursorPos(out p); return p.X + "," + p.Y; }
}
'@
[Ptr]::SetProcessDPIAware() | Out-Null
function MacPos { (& C:\Windows\System32\OpenSSH\ssh.exe -F $SshCfg macwifi /tmp/curpos) -replace '; USB-C Display.*?;', ';' }
$log = Join-Path $LinkDir 'pointer-receiver.log'
$p = Start-Process "$RepoRoot\windows\bin\Release\net8.0-windows\UsbcDisplay.exe" -ArgumentList '--test-card','--scale','100','--seconds','60' -PassThru -WindowStyle Hidden -RedirectStandardOutput $log
Start-Sleep 7
"--- 10 single clicks, 0.7 s apart (expect clicks 1 at each spot)"
$spots = @((300,200),(900,250),(1500,300),(400,600),(1000,650),(1600,700),(250,900),(800,950),(1300,1000),(1800,1100))
foreach ($s in $spots) { [Ptr]::MoveTo($s[0], $s[1]); Start-Sleep -Milliseconds 120; [Ptr]::Down(); Start-Sleep -Milliseconds 60; [Ptr]::Up(); Start-Sleep -Milliseconds 700 }
"--- 5 quick taps (2 ms down), 0.7 s apart"
foreach ($i in 1..5) { [Ptr]::MoveTo(500 + 100 * $i, 500); Start-Sleep -Milliseconds 120; [Ptr]::Down(); Start-Sleep -Milliseconds 2; [Ptr]::Up(); Start-Sleep -Milliseconds 700 }
"--- 2 double clicks"
foreach ($i in 1..2) { [Ptr]::MoveTo(700, 800 + 50 * $i); Start-Sleep -Milliseconds 120; foreach ($k in 1..2) { [Ptr]::Down(); Start-Sleep -Milliseconds 40; [Ptr]::Up(); Start-Sleep -Milliseconds 90 }; Start-Sleep -Milliseconds 700 }
"--- drag 200 px right"
[Ptr]::MoveTo(600, 400); Start-Sleep -Milliseconds 120; [Ptr]::Down(); foreach ($i in 1..10) { [Ptr]::MoveBy(20, 0) }; [Ptr]::Up(); Start-Sleep -Milliseconds 500
"--- crossing: to the right edge, push on, move 300 px on the Mac's screen"
[Ptr]::MoveTo(1900, 500); Start-Sleep -Milliseconds 200
foreach ($i in 1..30) { [Ptr]::MoveBy(10, 0) }
Start-Sleep -Milliseconds 300
"Mac: $(MacPos)   Windows cursor: $([Ptr]::Cursor())"
"--- back: 450 px left"
foreach ($i in 1..45) { [Ptr]::MoveBy(-10, 0) }
Start-Sleep -Milliseconds 400
"Mac: $(MacPos)   Windows cursor: $([Ptr]::Cursor())"
"--- the Mac moves its pointer onto its own screen; then this trackpad moves 100 px down"
& C:\Windows\System32\OpenSSH\ssh.exe -F $SshCfg macwifi 'osascript -l JavaScript /tmp/warp.js'
Start-Sleep -Milliseconds 500
"Mac after its own move: $(MacPos)"
foreach ($i in 1..10) { [Ptr]::MoveBy(0, 10) }
Start-Sleep -Milliseconds 300
"Mac after this trackpad: $(MacPos)   Windows cursor: $([Ptr]::Cursor())"
"--- and back onto the laptop: 900 px left"
foreach ($i in 1..60) { [Ptr]::MoveBy(-15, 0) }
Start-Sleep -Milliseconds 400
"Mac: $(MacPos)   Windows cursor: $([Ptr]::Cursor())"
if (-not $p.HasExited) { $p.Kill() }
