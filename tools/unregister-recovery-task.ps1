# Removes the USB4 link recovery tasks (run as administrator).
foreach ($name in 'Restart USB4 link', 'Restart USB4 network adapter') {
    Unregister-ScheduledTask -TaskPath '\USB-C Display\' -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
}
$scheduler = New-Object -ComObject Schedule.Service
$scheduler.Connect()
try { $scheduler.GetFolder('\').DeleteFolder('USB-C Display', 0) } catch { }
