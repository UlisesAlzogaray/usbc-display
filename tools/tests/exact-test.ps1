# End-to-end exactness: the laptop's screen must equal, pixel for pixel, what the Mac sent.
. "$PSScriptRoot\linklib.ps1"
$out = Join-Path $LinkDir 'exact'
New-Item -ItemType Directory -Force $out | Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class DpiX { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[DpiX]::SetProcessDPIAware() | Out-Null
$exe = "$RepoRoot\windows\app\UsbcDisplay.exe"
$p = Start-Process $exe -ArgumentList '--test-card','--scale','125','--seconds','17' -PassThru -WindowStyle Hidden -RedirectStandardOutput "$out\recv.log"
Start-Sleep 14
$bmp = New-Object Drawing.Bitmap 1920, 1200, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size); $g.Dispose()
$p.WaitForExit(20000) | Out-Null
& C:\Windows\System32\OpenSSH\scp.exe -F $SshCfg -q macwifi:/tmp/usbc-display-sent.bgra "$out\sent.bgra"
$raw = [IO.File]::ReadAllBytes("$out\sent.bgra")
$w = [BitConverter]::ToInt32($raw, 0); $h = [BitConverter]::ToInt32($raw, 4)
"sent picture: ${w}x$h"
$rect = New-Object Drawing.Rectangle 0, 0, 1920, 1200
$data = $bmp.LockBits($rect, 'ReadOnly', [Drawing.Imaging.PixelFormat]::Format32bppArgb)
$shot = New-Object byte[] ($data.Stride * 1200)
[Runtime.InteropServices.Marshal]::Copy($data.Scan0, $shot, 0, $shot.Length)
$bmp.UnlockBits($data); $bmp.Dispose()
$diff = 0; $maxd = 0; $firstDiff = $null
for ($y = 0; $y -lt $h; $y++) {
    $so = $y * $data.Stride; $ro = 8 + $y * $w * 4
    for ($x = 0; $x -lt $w * 4; $x += 4) {
        for ($c = 0; $c -lt 3; $c++) {
            $d = [Math]::Abs([int]$shot[$so + $x + $c] - [int]$raw[$ro + $x + $c])
            if ($d -gt 0) { $diff++; if ($d -gt $maxd) { $maxd = $d }; if (-not $firstDiff) { $firstDiff = "x=$($x/4) y=$y" } }
        }
    }
}
"channel values that differ: $diff of $($w*$h*3) (largest difference $maxd; first at $firstDiff)"
