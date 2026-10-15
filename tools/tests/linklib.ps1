$Global:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# Helpers for the USB4 link experiments. Dot-source this file.
$Global:LinkDir = Join-Path $PSScriptRoot 'results'
$Global:Sink = "$RepoRoot\tools\UsbcSink\app\UsbcSink.exe"
$Global:SshCfg = Join-Path $PSScriptRoot 'ssh_config'   # see ssh_config.example
# The two machines' addresses on the cable: the Mac prints its own when it starts, and
# Get-NetIPAddress shows Windows'. Change them for other machines.
$Global:MacV6 = 'fe80::18e3:e082:52fa:63d5'
$Global:MacV4 = '169.254.230.136'
$Global:WinV4 = '169.254.29.64'
$env:DOTNET_ROOT = "$env:USERPROFILE\.dotnet-sdk"
New-Item -ItemType Directory -Force $LinkDir | Out-Null

function Mac([string]$cmd) { & C:\Windows\System32\OpenSSH\ssh.exe -F $SshCfg -o ConnectTimeout=8 macwifi $cmd }

function Get-LinkIfIndex { (Get-NetAdapter -Name 'Ethernet 4' -ErrorAction SilentlyContinue).ifIndex }

function Get-LinkStats {
    $s = Get-NetAdapterStatistics -Name 'Ethernet 4' -ErrorAction SilentlyContinue
    if (-not $s) { return $null }
    [pscustomobject]@{ Time = Get-Date; RxBytes = $s.ReceivedBytes; RxPkts = $s.ReceivedUnicastPackets; TxBytes = $s.SentBytes; TxPkts = $s.SentUnicastPackets }
}

# One UDP probe to usbc-bench; $true if it echoes within $ms.
function Test-UdpEcho([string]$family, [int]$ms = 150) {
    try {
        if ($family -eq 'v4') {
            $u = New-Object Net.Sockets.Socket([Net.Sockets.AddressFamily]::InterNetwork, [Net.Sockets.SocketType]::Dgram, [Net.Sockets.ProtocolType]::Udp)
            $u.Bind((New-Object Net.IPEndPoint([Net.IPAddress]::Parse($WinV4), 0)))
            $ep = New-Object Net.IPEndPoint([Net.IPAddress]::Parse($MacV4), 48201)
        } else {
            $u = New-Object Net.Sockets.Socket([Net.Sockets.AddressFamily]::InterNetworkV6, [Net.Sockets.SocketType]::Dgram, [Net.Sockets.ProtocolType]::Udp)
            $ep = New-Object Net.IPEndPoint([Net.IPAddress]::Parse("$MacV6%$(Get-LinkIfIndex)"), 48201)
        }
        $u.ReceiveTimeout = $ms
        $b = [byte[]](0x55,0x43,0x42,0x50,1,0,0,0)
        [void]$u.SendTo($b, $ep)
        $r = New-Object byte[] 16
        $n = $u.Receive($r)
        return ($n -eq 8 -and $r[3] -eq 0x45)
    } catch { return $false } finally { if ($u) { $u.Dispose() } }
}

# Restarts the link with a registered task and records how long each step takes to come back.
function Reset-Link([string]$Task = 'Restart USB4 link', [switch]$WaitV4, [int]$TimeoutSec = 150) {
    $t0 = Get-Date
    $tl = [ordered]@{ task = $Task; start = $t0.ToString('HH:mm:ss.fff') }
    schtasks /run /tn "\USB-C Display\$Task" | Out-Null
    $sawDown = $false
    $ping = New-Object Net.NetworkInformation.Ping
    while (((Get-Date) - $t0).TotalSeconds -lt $TimeoutSec) {
        $el = [Math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
        $ni = [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object Name -eq 'Ethernet 4'
        $up = $ni -and $ni.OperationalStatus -eq 'Up'
        if (-not $up -and -not $sawDown) { $sawDown = $true; $tl.adapter_down = $el }
        if ($up -and $sawDown -and -not $tl.adapter_up) { $tl.adapter_up = $el }
        if ($up -and -not $tl.ping6) {
            try { if ($ping.Send([Net.IPAddress]::Parse("$MacV6%$($ni.GetIPProperties().GetIPv6Properties().Index)"), 150).Status -eq 'Success') { $tl.ping6 = $el } } catch { }
        }
        if ($up -and -not $tl.udp6 -and (Test-UdpEcho v6)) { $tl.udp6 = $el }
        if ($WaitV4 -and $up -and -not $tl.udp4 -and (Test-UdpEcho v4)) { $tl.udp4 = $el }
        if ($tl.udp6 -and $tl.ping6 -and (-not $WaitV4 -or $tl.udp4) -and ($sawDown -or $el -gt 20)) { break }
        Start-Sleep -Milliseconds 100
    }
    $tl.done = [Math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    $tl.ok = [bool]($tl.udp6 -and (-not $WaitV4 -or $tl.udp4))
    $st = Get-LinkStats
    $tl.rx_bytes_at_up = $st.RxBytes
    [pscustomobject]$tl
}

# Runs the sink; returns its JSON summary as an object (plus the exit code).
function Invoke-Sink([int]$Run, [string[]]$SinkArgs) {
    $log = Join-Path $LinkDir "run$Run.csv"
    $before = Get-LinkStats
    $out = & $Sink --run $Run --log $log @SinkArgs 2>&1
    $code = $LASTEXITCODE
    $line = $out | Where-Object { $_ -like '{*' } | Select-Object -Last 1
    $o = if ($line) { $line | ConvertFrom-Json } else { [pscustomobject]@{ run = $Run; result = 'noresult'; detail = ($out -join ' ') } }
    $o | Add-Member -NotePropertyName exit -NotePropertyValue $code
    $o | Add-Member -NotePropertyName link_rx_before -NotePropertyValue $before.RxBytes
    $o | ConvertTo-Json -Compress | Add-Content (Join-Path $LinkDir 'results.jsonl')
    $o
}
