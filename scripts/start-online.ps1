# Starts the live GDS HR service and its Cloudflare Tunnel, restarting either if it stops.
# Registered by install-online.ps1 as the "GDS HR Online" startup task; safe to run by hand.
# Only one copy runs at a time.
param(
  [string]$Origin = 'https://hr.blkstone.site',
  [string]$TunnelConfig = 'C:\Users\L.Erika\.cloudflared\config.yml'
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logs = Join-Path $root 'data\logs'          # data/ is git-ignored and private
New-Item -ItemType Directory -Force $logs | Out-Null
$node = (Get-Command node -ErrorAction Stop).Source
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) {
  # The startup task runs as SYSTEM, whose PATH does not include the per-user WinGet install.
  $cloudflared = Get-ChildItem 'C:\Users\L.Erika\AppData\Local\Microsoft\WinGet\Packages\Cloudflare.cloudflared*\cloudflared.exe' -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $cloudflared) { throw 'cloudflared.exe not found.' }
# Only one supervisor at a time, so a second start never fights over port 3400 or opens a second tunnel.
$single = New-Object System.Threading.Mutex($false, 'Global\GdsHrOnline')
if (-not $single.WaitOne(0)) { exit 0 }
$log = { param($message) Add-Content (Join-Path $logs 'supervisor.log') "$(Get-Date -Format s) $message" }

function Start-Hr {
  $env:HR_ORIGIN = $Origin
  Start-Process -FilePath $node -ArgumentList 'src/server.mjs' -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs 'hr.out.log') -RedirectStandardError (Join-Path $logs 'hr.err.log')
}
function Start-Tunnel {
  Start-Process -FilePath $cloudflared -ArgumentList '--config', "`"$TunnelConfig`"", 'tunnel', 'run' -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs 'tunnel.out.log') -RedirectStandardError (Join-Path $logs 'tunnel.err.log')
}

& $log "starting HR ($Origin) and tunnel"
$hr = Start-Hr; Start-Sleep 3; $tunnel = Start-Tunnel
while ($true) {
  Start-Sleep 15
  if ($hr.HasExited) { & $log "HR exited ($($hr.ExitCode)); restarting"; $hr = Start-Hr }
  if ($tunnel.HasExited) { & $log "tunnel exited ($($tunnel.ExitCode)); restarting"; $tunnel = Start-Tunnel }
}
