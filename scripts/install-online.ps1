# One-time set-up on the office PC: keeps https://hr.blkstone.site online by itself.
#  - Registers the Windows scheduled task "GDS HR Online". It runs scripts\start-online.ps1 (the HR app and the
#    Cloudflare tunnel, each restarted if it stops) when Windows starts, before anyone signs in, as SYSTEM.
#  - Stops a copy that was started by hand, then starts the task right away.
#  - Turns off sleep and hibernation while the PC is plugged in (the site is offline while the PC sleeps).
#
# Run once, in PowerShell opened with "Run as administrator", from the gds-hr folder:
#   powershell -ExecutionPolicy Bypass -File scripts\install-online.ps1
# To remove the automatic start again:
#   powershell -ExecutionPolicy Bypass -File scripts\install-online.ps1 -Remove
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$TaskName = 'GDS HR Online'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Open PowerShell with "Run as administrator" (right-click PowerShell) and run this again.' }

# Stops only this HR site: the start-online.ps1 window(s), the HR app and tunnel they started, and whatever still
# holds the HR port (3400). Other projects on this PC are left alone.
function Stop-Running {
  $all = Get-CimInstance Win32_Process
  $supervisors = @($all | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'start-online\.ps1' -and $_.ProcessId -ne $PID })
  $ids = @($supervisors.ProcessId)
  $ids += @($all | Where-Object { $ids -contains $_.ParentProcessId -and $_.Name -in @('node.exe', 'cloudflared.exe') } | ForEach-Object { $_.ProcessId })
  $ids += @(Get-NetTCPConnection -LocalPort 3400 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess })
  foreach ($id in ($ids | Where-Object { $_ } | Select-Object -Unique)) {
    $p = $all | Where-Object { $_.ProcessId -eq $id }
    Write-Host "Stopping $($p.Name) ($id)"
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
}

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Stop-Running
  Write-Host "Removed. Start the site by hand with: powershell -ExecutionPolicy Bypass -File scripts\start-online.ps1"
  return
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$start = Join-Path $root 'scripts\start-online.ps1'
if (-not (Test-Path $start)) { throw "Missing $start" }

# SYSTEM does not see programs installed for one user only, so the folders of node and cloudflared found now are
# added to the task's PATH.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js was not found. Install Node.js 24.14 or newer, then run this again.' }
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) { throw 'cloudflared was not found. Install it (winget install Cloudflare.cloudflared), then run this again.' }
$paths = (@((Split-Path $node), (Split-Path $cloudflared)) | Select-Object -Unique) -join ';'

$command = "`$env:Path = '$paths;' + `$env:Path; & '$start'"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"$command`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'   # give the network a moment after Windows starts
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Runs the GDS HR app and its Cloudflare tunnel (scripts\start-online.ps1) at start-up.' -Force | Out-Null

# Sleep and hibernation off while plugged in; the screen may still turn off.
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

Stop-Running
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 15
$info = Get-ScheduledTaskInfo -TaskName $TaskName
$running = Get-NetTCPConnection -LocalPort 3400 -State Listen -ErrorAction SilentlyContinue
Write-Host ''
Write-Host "Task '$TaskName' is registered and runs at every start-up (last run result: $($info.LastTaskResult))."
if ($running) { Write-Host 'The HR app is running. Open https://hr.blkstone.site in about 30 seconds.' }
else { Write-Host "The HR app is not running yet. Check the logs in $root\data\logs (supervisor.log, hr.err.log, tunnel.err.log)." }
Write-Host 'You can close this window; the site keeps running in the background.'
