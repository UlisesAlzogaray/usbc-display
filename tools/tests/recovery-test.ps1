# Stage 4 test: the receiver is running when the link wedges; it must recover with no prompt.
. "$PSScriptRoot\linklib.ps1"
$log = Join-Path $LinkDir 'recovery-receiver.log'
$exe = "$RepoRoot\windows\app\UsbcDisplay.exe"
$p = Start-Process $exe -ArgumentList '--window','960x600','--seconds','240','--test-card' -PassThru -WindowStyle Hidden -RedirectStandardOutput $log
Start-Sleep 8
"$(Get-Date -Format HH:mm:ss) receiver running: $(-not $p.HasExited)"
# Provoke a wedge: bundled (TSO) IPv6 traffic at full speed, as in the R0 control runs.
$t0 = Get-Date
$w = Invoke-Sink 30 @('--mac', "$MacV6%$(Get-LinkIfIndex)", '--total', '10')
"$(Get-Date -Format HH:mm:ss) provocation: $($w.result) after $($w.gb) GB ($($w.detail))"
# Now the receiver should notice, restart the link (no prompt) and reconnect.
$deadline = (Get-Date).AddSeconds(200)
while ((Get-Date) -lt $deadline -and -not $p.HasExited) {
    $text = Get-Content $log -Raw -ErrorAction SilentlyContinue
    if ($text -match 'Link is back after (\d+) s' -and ($text -split 'Link is back')[-1] -match 'Connected to') { break }
    Start-Sleep 2
}
"$(Get-Date -Format HH:mm:ss) total since provocation: $([int]((Get-Date) - $t0).TotalSeconds) s"
Start-Sleep 10
Get-Content $log | Where-Object { $_ -notmatch '^\d\d:\d\d:\d\d +0 fps' } | Select-Object -Last 25
if (-not $p.HasExited) { $p.Kill() }
