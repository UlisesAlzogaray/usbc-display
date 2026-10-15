# Registers the tasks that restart the USB4 link without a permission prompt each time.
# Run once as administrator (the receiver and the test tools start them with schtasks /run).
# Undo: tools\unregister-recovery-task.ps1 (also as administrator).
#
# Each task runs a fixed pnputil command as SYSTEM. Your account may start the tasks but not
# change them, so they can't be turned into a way to run anything else with admin rights.
param([string]$UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
      [string]$ResultFile = "$env:LOCALAPPDATA\UsbcDisplay\register-task.log")

$ErrorActionPreference = 'Stop'
$tasks = @(
    @{ Name = 'Restart USB4 link'
       Args = '/restart-device /deviceid "USB4\ROOT_DEVICE_ROUTER&VID_QCOM&PID_0CD1"'
       Description = 'USB-C Display: restarts the USB4 root router, the software equivalent of replugging the cable. Used when the USB4 network link stops passing data.' },
    @{ Name = 'Restart USB4 network adapter'
       Args = '/restart-device /deviceid "USB4\USB4NET"'
       Description = 'USB-C Display: restarts only the USB4 network adapter (a cheaper reset, tried first).' }
)

function Esc([string]$s) { [Security.SecurityElement]::Escape($s) }

$log = @()
try {
    foreach ($t in $tasks) {
        $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>USB-C Display</Author>
    <Description>$(Esc $t.Description)</Description>
    <SecurityDescriptor>D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;$UserSid)</SecurityDescriptor>
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
      <Command>C:\Windows\System32\pnputil.exe</Command>
      <Arguments>$(Esc $t.Args)</Arguments>
    </Exec>
  </Actions>
</Task>
"@
        Register-ScheduledTask -TaskPath '\USB-C Display\' -TaskName $t.Name -Xml $xml -Force | Out-Null
        $log += "registered \USB-C Display\$($t.Name): pnputil.exe $($t.Args)"
    }
    $log += 'OK'
} catch {
    $log += "FAILED: $($_.Exception.Message)"
}
New-Item -ItemType Directory -Force (Split-Path $ResultFile) | Out-Null
$log | Set-Content -Encoding UTF8 $ResultFile
