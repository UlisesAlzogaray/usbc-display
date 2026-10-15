param([int]$Run = 20, [double]$GB = 100, [string[]]$Extra = @())
. "$PSScriptRoot\linklib.ps1"
$start = Get-LinkStats
$t = Invoke-Sink $Run (@('--v4', '--ipopt', '--total', "$GB", '--seconds', '3600') + $Extra)
$end = Get-LinkStats
$t | Select-Object run, result, detail, gb, seconds, mbps, max_gap_ms, stalls_50ms, if_rx_pkts, if_rx_avg_pkt | Format-List | Out-String
"link session rx: $([Math]::Round($end.RxBytes / 1e9, 1)) GB since link-up"
