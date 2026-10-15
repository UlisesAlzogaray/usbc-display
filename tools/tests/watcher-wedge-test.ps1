# The watcher (screen not running) must restart a wedged link by itself.
. "$PSScriptRoot\linklib.ps1"
Start-Process "$RepoRoot\windows\app\UsbcWatcher.exe"
Start-Sleep 12   # lets it find the Mac on the cable
"$(Get-Date -Format HH:mm:ss) watcher running: $([bool](Get-Process UsbcWatcher -ErrorAction SilentlyContinue))"
$w = Invoke-Sink 31 @('--mac', "$MacV6%$(Get-LinkIfIndex)", '--total', '10')
"$(Get-Date -Format HH:mm:ss) provocation: $($w.result) after $($w.gb) GB"
$t0 = Get-Date; $sawDown = $false; $back = $null
$ping = New-Object Net.NetworkInformation.Ping
while (((Get-Date) - $t0).TotalSeconds -lt 180) {
    $ni = [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object Name -eq 'Ethernet 4'
    if (-not $ni -or $ni.OperationalStatus -ne 'Up') { if (-not $sawDown) { $sawDown = $true; "$(Get-Date -Format HH:mm:ss) adapter went down: the watcher restarted the link" } }
    elseif ($sawDown) {
        try { if ($ping.Send([Net.IPAddress]::Parse("$MacV6%$($ni.GetIPProperties().GetIPv6Properties().Index)"), 300).Status -eq 'Success') { $back = Get-Date; break } } catch { }
    }
    Start-Sleep -Milliseconds 300
}
if ($back) { "$(Get-Date -Format HH:mm:ss) Mac reachable again, $([int]($back - $t0).TotalSeconds) s after the wedge" } else { "not recovered within 180 s (adapter went down: $sawDown)" }
