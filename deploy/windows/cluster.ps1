<#
.SYNOPSIS
Keeps a SNARK cluster running on Windows, every world at a path of one address behind server/front.ts.

.DESCRIPTION
The cluster is described in var\cluster.psd1, or in deploy\windows\cluster.example.psd1 while there is none; -Config names
another file. Commands:

  run        Starts the worlds, the front and the tunnel, and starts again whatever of them exits, until it is stopped.
             It stays in the foreground: Ctrl+C here, or "stop" from anywhere, stops it, every world saving first.
  start      Runs it in the background: through the scheduled task when it is installed, else hidden until logoff.
  stop       Stops it: every world saves and exits, then the front.
  status     What runs, where, how many play on each world, and the tunnel's address when it is a quick tunnel.
  install    Registers a scheduled task that runs it when Windows starts, as SYSTEM or as -User. Needs an administrator.
  uninstall  Stops it and removes the task.

Logs are in var\logs\<ClusterId>: cluster.log says what was started, what exited and what was started again; each world,
the front and the tunnel write <name>.out.log and <name>.err.log, and the logs of their last ten runs are kept in old\.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\windows\cluster.ps1 run
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][ValidateSet('run', 'start', 'stop', 'status', 'install', 'uninstall')][string]$Command = 'status',
  # The cluster's file. Default: var\cluster.psd1, else deploy\windows\cluster.example.psd1.
  [string]$Config,
  # install: the account the task runs as (its password is asked for). Default: SYSTEM.
  [string]$User
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$configGiven = [bool]$Config
if (-not $Config) {
  $Config = Join-Path $Root 'var\cluster.psd1'
  if (-not (Test-Path $Config)) { $Config = Join-Path $PSScriptRoot 'cluster.example.psd1' }
}
$Config = (Resolve-Path $Config).Path
$c = Import-PowerShellDataFile $Config

function Get-Value($value, $default) { if ($null -ne $value -and "$value" -ne '') { $value } else { $default } }
function Resolve-RootPath([string]$path) { if ([IO.Path]::IsPathRooted($path)) { $path } else { Join-Path $Root $path } }

$ClusterId = $c.ClusterId
if ("$ClusterId" -notmatch '^[A-Za-z0-9_-]+$') { throw "${Config}: ClusterId must be letters, digits, - and _" }
$settings  = @($c.Settings | Where-Object { $_ })
$saveDir   = Resolve-RootPath (Get-Value $c.SaveDir 'var/cluster')
$mapDir    = Resolve-RootPath (Get-Value $c.MapDir 'var/maps')
$frontHost = Get-Value $c.FrontHost '127.0.0.1'
$frontPort = [int](Get-Value $c.FrontPort 8787)
# The folder the worlds share: ClusterDirOverride's, or "clusters" beside the saves, with a folder of the cluster's id.
$override  = $settings | Where-Object { $_ -match '^-ClusterDirOverride=' } | Select-Object -Last 1
$folder    = if ($override) { Join-Path (Resolve-RootPath ($override -replace '^-ClusterDirOverride=', '').Trim('"')) $ClusterId } else { Join-Path $saveDir "clusters\$ClusterId" }
$logDir    = Join-Path $Root "var\logs\$ClusterId"
$runDir    = Join-Path $Root "var\run\$ClusterId"
$pidFile   = Join-Path $runDir 'supervisor.pid'
$stopFile  = Join-Path $runDir 'stop'
$stateFile = Join-Path $runDir 'state.json'
$previousFile = Join-Path $runDir 'state.previous.json'
$taskName  = "SNARK cluster $ClusterId"
$powershell = Join-Path $PSHOME 'powershell.exe'

function Write-Log([string]$text) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
  New-Item -ItemType Directory -Force $logDir | Out-Null
  Add-Content -Path (Join-Path $logDir 'cluster.log') -Value $line
  Write-Host $line
}

# What runs: a server for each world, the front, and the tunnel when there is one. Each world listens on this machine
# only, at its path (/<Map> unless it names one), with its save and its map named by its map.
function Get-Items([string]$bun) {
  $items = New-Object System.Collections.ArrayList
  foreach ($w in @($c.Worlds)) {
    $path = Get-Value $w.Path "/$($w.Map)"
    $map  = Join-Path $mapDir "$($w.Map).snmap"
    $line = @('server/main.ts', "--map `"$map`"", "--db `"$(Join-Path $saveDir "$($w.Map).db")`"", '--host 127.0.0.1', "--port $($w.Port)", "--public-url $path", "-clusterid=$ClusterId", "`"?SessionName=$(Get-Value $w.Name $w.Map)`"")
    if ($c.ServerConfig) { $line += "--config `"$($c.ServerConfig)`"" }
    [void]$items.Add([pscustomobject]@{ Name = $w.Map; Title = (Get-Value $w.Name $w.Map); Kind = 'world'; Path = $path; Port = [int]$w.Port; Map = $map; Exe = $bun; Line = (($line + $settings) -join ' '); Process = $null; Started = $null; Due = [datetime]::MinValue; Delay = 0; Restarts = 0 })
  }
  [void]$items.Add([pscustomobject]@{ Name = 'front'; Title = 'front'; Kind = 'front'; Path = ''; Port = $frontPort; Map = $null; Exe = $bun; Line = "server/front.ts --cluster `"$folder`" --host $frontHost --port $frontPort"; Process = $null; Started = $null; Due = [datetime]::MinValue; Delay = 0; Restarts = 0 })
  if ($c.Tunnel) {
    [void]$items.Add([pscustomobject]@{ Name = 'tunnel'; Title = 'tunnel'; Kind = 'tunnel'; Path = ''; Port = 0; Map = $null; Exe = $c.Tunnel.Command; Line = $c.Tunnel.Arguments; Process = $null; Started = $null; Due = [datetime]::MinValue; Delay = 0; Restarts = 0 })
  }
  $items
}

function Find-Program([string]$name) {
  if ([IO.Path]::IsPathRooted($name)) { if (Test-Path $name) { return $name }; throw "$name does not exist" }
  $found = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $found) { throw "$name is not on PATH: give its whole path in $Config" }
  $found.Source
}

function Read-Secret($file) { if ($file -and (Test-Path (Resolve-RootPath $file))) { (Get-Content (Resolve-RootPath $file) -Raw).Trim() } else { $null } }

function Get-Listener([int]$port) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { [int]$conn.OwningProcess } else { $null }
}

function Get-Supervisor {
  if (-not (Test-Path $pidFile)) { return $null }
  $id = (Get-Content $pidFile -Raw).Trim()
  if ($id -notmatch '^\d+$') { return $null }
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
  if ($p -and $p.CommandLine -like '*cluster.ps1*') { $p } else { $null }
}

function Format-Span([TimeSpan]$t) {
  if ($t.TotalHours -ge 1) { '{0:N1} h' -f $t.TotalHours } elseif ($t.TotalMinutes -ge 1) { '{0:N0} min' -f $t.TotalMinutes } else { '{0:N0} s' -f $t.TotalSeconds }
}

function Save-State($items) {
  $state = foreach ($item in $items) {
    [pscustomobject]@{ name = $item.Name; port = $item.Port; pid = $(if ($item.Process) { $item.Process.Id } else { $null }); exe = [IO.Path]::GetFileNameWithoutExtension($item.Exe); restarts = $item.Restarts }
  }
  ConvertTo-Json @($state) | Set-Content $stateFile -Encoding UTF8
}

# Each program as the supervisor last wrote it down. (Windows PowerShell's ConvertFrom-Json passes an array on whole.)
function Read-State([string]$file = $stateFile) { if (Test-Path $file) { $state = Get-Content $file -Raw | ConvertFrom-Json; $state } }

# With no supervisor running, the state file is the last one's. Set aside, it still names what that one may have left
# running, and state.json is only ever the running supervisor's.
function Move-OldState { if (Test-Path $stateFile) { Move-Item $stateFile $previousFile -Force } }

# Moves a program's last logs into old\ and keeps the newest ten there.
function Save-OldLogs([string]$name) {
  $old = Join-Path $logDir 'old'
  New-Item -ItemType Directory -Force $old | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  foreach ($kind in 'out', 'err') {
    $log = Join-Path $logDir "$name.$kind.log"
    if (Test-Path $log) { Move-Item $log (Join-Path $old "$name.$stamp.$kind.log") -Force }
  }
  Get-ChildItem $old -Filter "$name.*.log" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 | Remove-Item
}

function Start-Item($item, $secrets) {
  Save-OldLogs $item.Name
  # A secret reaches only the program it is for: it is in the environment while that one starts, and gone after.
  $mine = $secrets[$item.Kind]
  if ($mine) { foreach ($k in $mine.Keys) { Set-Item "env:$k" $mine[$k] } }
  try {
    $p = Start-Process -FilePath $item.Exe -ArgumentList $item.Line -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $logDir "$($item.Name).out.log") -RedirectStandardError (Join-Path $logDir "$($item.Name).err.log")
  } finally {
    if ($mine) { foreach ($k in $mine.Keys) { Remove-Item "env:$k" -ErrorAction SilentlyContinue } }
  }
  $null = $p.Handle   # Without a handle taken now, Windows PowerShell cannot read the exit code later.
  $item.Process = $p
  $item.Started = Get-Date
  $where = if ($item.Port) { ", port $($item.Port)" } else { '' }
  if ($item.Path) { $where += ", at $($item.Path)/" }
  Write-Log "$($item.Name) started, pid $($p.Id)$where"
}

function Send-Ctrl([int]$id, [string]$mode) {
  Start-Process -FilePath $powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\send-ctrl.ps1`" -TargetPid $id -Mode $mode" -WindowStyle Hidden -Wait
}

# Ctrl+C to each, as at a terminal: a world saves and exits. Then a console close. One still running after 90 s is ended,
# and loses what it did since its last save.
function Stop-Gently($targets) {
  $targets = @($targets)
  foreach ($step in @(@{ Mode = 'ctrlc'; Wait = 60 }, @{ Mode = 'close'; Wait = 30 })) {
    $alive = @($targets | Where-Object { -not $_.Process.HasExited })
    if ($alive.Count -eq 0) { break }
    foreach ($t in $alive) { Send-Ctrl $t.Process.Id $step.Mode }
    $until = (Get-Date).AddSeconds($step.Wait)
    while ((Get-Date) -lt $until -and @($alive | Where-Object { -not $_.Process.HasExited }).Count -gt 0) { Start-Sleep -Milliseconds 500 }
  }
  foreach ($t in $targets) {
    if ($t.Process.HasExited) {
      $code = try { $t.Process.ExitCode } catch { '?' }
      # 0xC000013A: the program had no handler of its own and Windows ended it at the Ctrl+C, as the front, which
      # keeps nothing, is ended.
      Write-Log "$($t.Name) stopped, $(if ($code -eq -1073741510) { 'ended by the Ctrl+C' } else { "exit code $code" })"
    } else {
      Stop-Process -Id $t.Process.Id -Force
      Write-Log "$($t.Name) did not stop in 90 s and was ended: it loses what it did since its last save"
    }
  }
}

# Whatever of this cluster runs without a supervisor: one left behind when its supervisor was ended.
function Get-Strays {
  $strays = @()
  foreach ($item in Get-Items 'bun') {
    if ($item.Port) {
      $id = Get-Listener $item.Port
      if (-not $id) { continue }
      $line = (Get-CimInstance Win32_Process -Filter "ProcessId=$id").CommandLine
      # Of this cluster by its id: a world's -clusterid, the front's folder. Another cluster's program is left alone.
      $ours = if ($item.Kind -eq 'world') { $line -match "\s-clusterid=$ClusterId(\s|$)" } else { $line -match 'server/front\.ts' -and $line -match "clusters[\\/]$ClusterId(`"|\s|$)" }
      if ($ours) { $strays += [pscustomobject]@{ Name = $item.Name; Process = (Get-Process -Id $id) } }
    }
  }
  # The tunnel listens on no port of its own; the state file names it.
  $tunnel = Read-State $previousFile | Where-Object { $_.name -eq 'tunnel' -and $_.pid }
  if ($tunnel) {
    $p = Get-Process -Id $tunnel.pid -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq $tunnel.exe) { $strays += [pscustomobject]@{ Name = 'tunnel'; Process = $p } }
  }
  foreach ($s in $strays) { $null = $s.Process.Handle }
  $strays
}

function Invoke-Run {
  New-Item -ItemType Directory -Force $logDir, $runDir | Out-Null
  $other = Get-Supervisor
  if ($other) { throw "the cluster $ClusterId already runs, supervisor pid $($other.ProcessId): cluster.ps1 stop stops it" }
  # Claimed at once, so that start and status see this supervisor while it clears away what was left from before.
  Set-Content $pidFile $PID
  Remove-Item $stopFile -ErrorAction SilentlyContinue
  Move-OldState
  $items = @()
  $started = $false
  try {
    if (-not (Test-Path (Join-Path $Root 'client\dist\index.html'))) { throw 'the client is not built: bun run build' }
    $bun = Find-Program (Get-Value $c.Bun 'bun')
    $secrets = @{ world = @{}; tunnel = @{} }
    $password = Read-Secret $c.AdminPasswordFile
    if ($password) { $secrets.world.SNARK_ADMIN_PASSWORD = $password } else { Write-Log 'no admin password file: enablecheats is refused on every world' }
    if ($c.Tunnel) {
      $c.Tunnel.Command = Find-Program $c.Tunnel.Command
      if ($c.Tunnel.TokenFile) {
        $token = Read-Secret $c.Tunnel.TokenFile
        if (-not $token) { throw "the tunnel's token file $($c.Tunnel.TokenFile) is missing or empty" }
        $secrets.tunnel.TUNNEL_TOKEN = $token
      }
    }
    $strays = @(Get-Strays)
    if ($strays.Count -gt 0) {
      Write-Log "$(($strays | ForEach-Object Name) -join ', ') of the cluster still run from before: stopping them first"
      Stop-Gently $strays
    }
    Remove-Item $previousFile -ErrorAction SilentlyContinue
    $all = @(Get-Items $bun)
    foreach ($item in $all) {
      if (-not $item.Port) { continue }
      $id = Get-Listener $item.Port
      if ($id) { throw "port $($item.Port), for $($item.Name), is taken by pid $id ($((Get-Process -Id $id -ErrorAction SilentlyContinue).ProcessName))" }
    }
    $items = @($all | Where-Object {
      if ($_.Kind -ne 'world' -or (Test-Path $_.Map)) { return $true }
      Write-Log "$($_.Name) left out: $($_.Map) does not exist (bun tools/mapworld/build.ts $($_.Name))"
      $false
    })
    if (-not (Test-Path (Join-Path $Root 'client\dist\wiki\index.html'))) { Write-Log '/wiki/ is not found until bun run wiki builds it' }
    Write-Log "cluster $ClusterId starting from ${Config}: $(@($items | Where-Object Kind -eq 'world').Count) worlds, the start screen at http://${frontHost}:$frontPort/"
    $started = $true
    while (-not (Test-Path $stopFile)) {
      $changed = $false
      foreach ($item in $items) {
        if ($item.Process -and $item.Process.HasExited) {
          $ran = (Get-Date) - $item.Started
          # Started again at once after a long run; after a short one, twice as long as last time, up to 5 minutes.
          $item.Delay = if ($ran.TotalMinutes -ge 10) { 5 } else { [Math]::Min([Math]::Max($item.Delay * 2, 5), 300) }
          Write-Log ('{0} exited with code {1} after {2}; starting it again in {3} s' -f $item.Name, $item.Process.ExitCode, (Format-Span $ran), $item.Delay)
          $item.Process = $null
          $item.Due = (Get-Date).AddSeconds($item.Delay)
          $item.Restarts++
          $changed = $true
        } elseif (-not $item.Process -and (Get-Date) -ge $item.Due) {
          try { Start-Item $item $secrets }
          catch {
            $item.Delay = [Math]::Min([Math]::Max($item.Delay * 2, 5), 300)
            $item.Due = (Get-Date).AddSeconds($item.Delay)
            Write-Log "$($item.Name) could not start: $($_.Exception.Message); trying again in $($item.Delay) s"
          }
          $changed = $true
        }
      }
      if ($changed) { Save-State $items }
      Start-Sleep -Seconds 1
    }
    Write-Log 'stop asked'
  } finally {
    # The worlds and the tunnel together, so the worlds save at once; then the front.
    $running = @($items | Where-Object { $_.Process -and -not $_.Process.HasExited })
    $first = @($running | Where-Object Kind -ne 'front')
    if ($first.Count -gt 0) { Stop-Gently $first }
    $last = @($running | Where-Object Kind -eq 'front')
    if ($last.Count -gt 0) { Stop-Gently $last }
    Remove-Item $pidFile, $stopFile, $stateFile -ErrorAction SilentlyContinue
    if ($started) { Write-Log "cluster $ClusterId stopped" }
  }
}

function Invoke-Stop {
  $supervisor = Get-Supervisor
  if ($supervisor) {
    Set-Content $stopFile 'stop'
    Write-Host "asked the supervisor, pid $($supervisor.ProcessId), to stop; every world saves first..."
    $until = (Get-Date).AddMinutes(4)
    while ((Get-Process -Id $supervisor.ProcessId -ErrorAction SilentlyContinue) -and (Get-Date) -lt $until) { Start-Sleep -Seconds 1 }
    if (Get-Process -Id $supervisor.ProcessId -ErrorAction SilentlyContinue) { throw "it still runs after 4 minutes: see $logDir\cluster.log" }
    Get-Content (Join-Path $logDir 'cluster.log') -Tail 20 | Select-String -Pattern 'stop|ended' | ForEach-Object { $_.Line }
    return
  }
  Move-OldState
  $strays = @(Get-Strays)
  if ($strays.Count -eq 0) { Write-Host "nothing of the cluster $ClusterId runs"; return }
  Write-Log "no supervisor; stopping what of the cluster still runs: $(($strays | ForEach-Object Name) -join ', ')"
  Stop-Gently $strays
  Remove-Item $previousFile -ErrorAction SilentlyContinue
}

function Invoke-Status {
  $supervisor = Get-Supervisor
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Write-Host "cluster $ClusterId, from $Config"
  Write-Host ('supervisor: ' + $(if ($supervisor) { "running, pid $($supervisor.ProcessId)" } else { 'not running' }))
  Write-Host ('at startup: ' + $(if ($task) { "scheduled task '$taskName' ($($task.State))" } else { 'not installed (cluster.ps1 install)' }))
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $live = @(Get-ChildItem (Join-Path $folder 'servers') -Filter '*.json' -ErrorAction SilentlyContinue | ForEach-Object {
    try { Get-Content $_.FullName -Raw | ConvertFrom-Json } catch { $null }
  } | Where-Object { $_ -and $now - $_.at -lt 15000 })
  $state = Read-State
  if (-not $state) { $state = Read-State $previousFile }
  $rows = foreach ($item in Get-Items 'bun') {
    $restarts = ($state | Where-Object name -eq $item.Name).restarts
    if ($item.Kind -eq 'tunnel') {
      $t = $state | Where-Object name -eq 'tunnel'
      $alive = $t -and $t.pid -and (Get-Process -Id $t.pid -ErrorAction SilentlyContinue)
      $log = Join-Path $logDir 'tunnel.err.log'
      $quick = if (Test-Path $log) { Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -Last 1 }
      [pscustomobject]@{ Name = 'tunnel'; At = $(if ($quick) { $quick.Matches[0].Value } else { '' }); Port = ''; Pid = $(if ($alive) { $t.pid } else { '' }); Running = [bool]$alive; Players = ''; Restarts = $restarts }
      continue
    }
    $id = Get-Listener $item.Port
    $seen = $live | Where-Object { $_.port -eq $item.Port } | Select-Object -First 1
    [pscustomobject]@{
      Name = $(if ($item.Kind -eq 'world') { $item.Title } else { 'front' })
      At = $(if ($item.Kind -eq 'world') { "$($item.Path)/" } else { "http://${frontHost}:$($item.Port)/" })
      Port = $item.Port; Pid = $id; Running = [bool]$id
      Players = $(if ($seen) { "$($seen.players) of $($seen.max)" } else { '' })
      Restarts = $restarts
    }
  }
  $rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
}

function Assert-Administrator {
  $me = New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'this needs PowerShell run as an administrator' }
}

function Invoke-Install {
  Assert-Administrator
  # The task names the cluster's file only when one was given; otherwise it looks for var\cluster.psd1 each time it starts.
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" run" + $(if ($configGiven) { " -Config `"$Config`"" } else { '' })
  $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtStartup
  # No time limit; started again a minute after it fails, ten times.
  $taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $description = "Keeps the SNARK cluster $ClusterId running. Stop it with deploy\windows\cluster.ps1 stop, not by ending the task here, so that every world saves first."
  if ($User) {
    $credential = Get-Credential -UserName $User -Message "The password of $User, whom the task runs as"
    Register-ScheduledTask -TaskName $taskName -Description $description -Action $action -Trigger $trigger -Settings $taskSettings -User $credential.UserName -Password $credential.GetNetworkCredential().Password -Force | Out-Null
  } else {
    $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $taskName -Description $description -Action $action -Trigger $trigger -Settings $taskSettings -Principal $principal -Force | Out-Null
  }
  Write-Host "installed: the task '$taskName' runs the cluster whenever Windows starts. cluster.ps1 start runs it now."
}

function Invoke-Uninstall {
  Assert-Administrator
  if (Get-Supervisor) { Invoke-Stop }
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "removed the task '$taskName'"
  } else { Write-Host "there is no task '$taskName'" }
}

function Invoke-Start {
  if (Get-Supervisor) { Write-Host "the cluster $ClusterId already runs"; Invoke-Status; return }
  New-Item -ItemType Directory -Force $runDir | Out-Null
  Move-OldState
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Start-ScheduledTask -TaskName $taskName
    Write-Host "started the task '$taskName'"
  } else {
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" run" + $(if ($configGiven) { " -Config `"$Config`"" } else { '' })
    Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Hidden
    Write-Host 'started in the background, until this user logs off (cluster.ps1 install keeps it running across restarts)'
  }
  # Until each world and the front listens as the program this supervisor started (not one left from before that it is
  # still stopping), or the supervisor gives up.
  $until = (Get-Date).AddSeconds(120)
  do {
    Start-Sleep -Seconds 2
    $state = @(Read-State)
    $ready = $state.Count -gt 0 -and @($state | Where-Object { $_.port -and (-not $_.pid -or (Get-Listener $_.port) -ne $_.pid) }).Count -eq 0
    $supervisor = Get-Supervisor
  } while ((Get-Date) -lt $until -and -not $ready -and ($supervisor -or (Get-Date) -lt $until.AddSeconds(-110)))
  if (-not $supervisor) { Write-Host 'the supervisor is not running; the end of its log:'; Get-Content (Join-Path $logDir 'cluster.log') -Tail 8 -ErrorAction SilentlyContinue }
  Invoke-Status
}

switch ($Command) {
  'run' {
    try { Invoke-Run }
    catch { Write-Log "the cluster stopped on an error: $($_.Exception.Message)"; exit 1 }
  }
  'start'     { Invoke-Start }
  'stop'      { Invoke-Stop }
  'status'    { Invoke-Status }
  'install'   { Invoke-Install }
  'uninstall' { Invoke-Uninstall }
}
