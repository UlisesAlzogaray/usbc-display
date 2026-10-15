# End-to-end test of the laptop's trackpad and keyboard on the Mac: synthetic input here,
# checked there (pointer position; text typed into the test card, which the agent logs).
param([int]$Seconds = 40)
. "$PSScriptRoot\linklib.ps1"
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Threading;
public static class Inj {
  [StructLayout(LayoutKind.Explicit, Size = 40)] struct INPUT {
    [FieldOffset(0)] public int type;
    [FieldOffset(8)] public int dx; [FieldOffset(12)] public int dy; [FieldOffset(16)] public int mouseData; [FieldOffset(20)] public uint mflags;
    [FieldOffset(8)] public ushort vk; [FieldOffset(10)] public ushort scan; [FieldOffset(12)] public uint kflags;
  }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  static void Send(INPUT i) { SendInput(1, new[] { i }, 40); Thread.Sleep(25); }
  public static void MoveTo(int x, int y) { // absolute, 0..65535 over the primary screen
    Send(new INPUT { type = 0, dx = x * 65535 / 1919, dy = y * 65535 / 1199, mflags = 0x8001 }); }
  public static void Click() { Send(new INPUT { type = 0, mflags = 2 }); Send(new INPUT { type = 0, mflags = 4 }); }
  public static void Wheel(int d) { Send(new INPUT { type = 0, mouseData = d, mflags = 0x800 }); }
  public static void Scan(ushort sc, bool up, bool ext = false) { Send(new INPUT { type = 1, scan = sc, kflags = 8u | (up ? 2u : 0) | (ext ? 1u : 0) }); }
  public static void Tap(ushort sc, bool ext = false) { Scan(sc, false, ext); Scan(sc, true, ext); }
  public static void Char(char c) { Send(new INPUT { type = 1, scan = c, kflags = 4 }); Send(new INPUT { type = 1, scan = c, kflags = 6 }); }
}
'@
[Inj]::SetProcessDPIAware() | Out-Null
$log = Join-Path $LinkDir 'input-receiver.log'
$p = Start-Process "$RepoRoot\windows\bin\Release\net8.0-windows\UsbcDisplay.exe" -ArgumentList '--test-card','--scale','125','--seconds',"$Seconds" -PassThru -WindowStyle Hidden -RedirectStandardOutput $log
Start-Sleep 6
Get-Content $log | Select-String 'Mac:|Showing' | ForEach-Object { $_.Line }
"--- pointer: move to the middle of the laptop screen, then a quarter in"
[Inj]::MoveTo(960, 600); Start-Sleep -Milliseconds 400
& C:\Windows\System32\OpenSSH\ssh.exe -F $SshCfg macwifi /tmp/curpos
[Inj]::MoveTo(480, 300); Start-Sleep -Milliseconds 400
& C:\Windows\System32\OpenSSH\ssh.exe -F $SshCfg macwifi /tmp/curpos
"--- click into the card (focus), then type"
[Inj]::MoveTo(1500, 1000); [Inj]::Click(); Start-Sleep -Milliseconds 300
[Inj]::Tap(0x1C)                                   # Enter (key code)
[Inj]::Scan(0x2A, $false); [Inj]::Tap(0x23); [Inj]::Scan(0x2A, $true)   # Shift+H
foreach ($sc in 0x18, 0x26, 0x1E) { [Inj]::Tap($sc) }                   # o l a
[Inj]::Tap(0x39)                                   # space (key code)
[Inj]::Tap(0x27)                                   # ñ (Latin American layout)
[Inj]::Tap(0x1A); [Inj]::Tap(0x12)                 # dead acute + e = é
[Inj]::Scan(0x38, $false, $true); [Inj]::Tap(0x10); [Inj]::Scan(0x38, $true, $true)  # AltGr+Q = @
[Inj]::Char([char]0x2713)                          # a character with no key: ✓
[Inj]::Tap(0x0E)                                   # Backspace removes it
Start-Sleep -Milliseconds 800
"--- shortcuts: Alt+A (Command+A), Alt+Left (Command+Left: start of line) then X, Windows+Right (Option+Right: a word on) then Y"
[Inj]::Scan(0x38, $false); [Inj]::Tap(0x1E); [Inj]::Scan(0x38, $true)
[Inj]::Scan(0x38, $false); [Inj]::Tap(0x4B, $true); [Inj]::Scan(0x38, $true); [Inj]::Scan(0x2A, $false); [Inj]::Tap(0x2D); [Inj]::Scan(0x2A, $true)
[Inj]::Scan(0x5B, $false, $true); [Inj]::Tap(0x4D, $true); [Inj]::Scan(0x5B, $true, $true); [Inj]::Scan(0x2A, $false); [Inj]::Tap(0x15); [Inj]::Scan(0x2A, $true)
Start-Sleep -Milliseconds 800
"--- scroll"
[Inj]::Wheel(-360); Start-Sleep -Milliseconds 300
if (-not $p.HasExited) { $p.Kill() }
