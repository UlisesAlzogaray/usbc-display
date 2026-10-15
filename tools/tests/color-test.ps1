# Colour patches of the test card on the laptop, with and without the panel colour profile.
param([string[]]$Extra = @(), [string]$Tag = 'on')
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$env:DOTNET_ROOT = "$env:USERPROFILE\.dotnet-sdk"
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class DpiC { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[DpiC]::SetProcessDPIAware() | Out-Null
$out = Join-Path $PSScriptRoot 'results\color'
New-Item -ItemType Directory -Force $out | Out-Null
$exe = "$RepoRoot\windows\app\UsbcDisplay.exe"
$p = Start-Process $exe -ArgumentList (@('--test-card', '--scale', '125', '--seconds', '15') + $Extra) -PassThru -WindowStyle Hidden -RedirectStandardOutput "$out\recv-$Tag.log"
Start-Sleep 12
$bmp = New-Object Drawing.Bitmap 1920, 1200
$g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size); $g.Dispose()
$bmp.Save("$out\shot-$Tag.png")
$p.WaitForExit(20000) | Out-Null
Get-Content "$out\recv-$Tag.log" | Select-String 'Colours|Showing' | ForEach-Object { $_.Line }
# The patches are ten equal squares in a row: find the red one (7th), then step back.
$found = $null
for ($y = 200; $y -lt 800 -and -not $found; $y += 2) {
  for ($x = 40; $x -lt 700; $x += 2) {
    $c = $bmp.GetPixel($x, $y)
    if ($c.R -gt 150 -and $c.G -lt 110 -and $c.B -lt 110) {
      $x1 = $x; while ($x1 -lt 900 -and ($bmp.GetPixel($x1, $y).R -gt 150 -and $bmp.GetPixel($x1, $y).G -lt 110)) { $x1++ }
      if ($x1 - $x -gt 15) { $found = @($x, $x1, $y); break }
    }
  }
}
if (-not $found) { "patches not found"; $bmp.Dispose(); return }
$w = $found[1] - $found[0]; $row = $found[2] + 4; $x0 = $found[0] - 6 * $w
$names = 'grey128','grey200','grey50','skin','sky','sunset','red','green','blue','purple'
$expect = @('128,128,128','200,200,200','50,50,50','230,190,160','150,170,200','220,160,120','220,40,40','40,180,60','40,90,220','150,60,200')
for ($i = 0; $i -lt 10; $i++) {
  $c = $bmp.GetPixel([int]($x0 + $i * $w + $w / 2), $row)
  "{0,-8} sRGB {1,-12} -> screen {2},{3},{4}" -f $names[$i], $expect[$i], $c.R, $c.G, $c.B
}
$bmp.Dispose()
