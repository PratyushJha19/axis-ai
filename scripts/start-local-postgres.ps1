$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$axisPgBin = if ($env:PG_BIN) { $env:PG_BIN } else { 'C:/Program Files/PostgreSQL/18/bin' }
& "$axisPgBin/pg_ctl.exe" -D .local/pgdata status | Out-Null
$axisStatus = $LASTEXITCODE
if ($axisStatus -eq 3) {
  # Start once, then observe readiness separately: crash recovery can exceed 60s.
  & "$axisPgBin/pg_ctl.exe" -D .local/pgdata -l .local/postgres.log -o '-h 127.0.0.1 -p 55432' -W start
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL could not be started. Inspect .local/postgres.log; do not delete or reinitialize the data directory.' }
} elseif ($axisStatus -ne 0) {
  throw 'Cannot inspect the existing PostgreSQL cluster. Check PG_BIN, permissions and .local/pgdata. Startup stopped.'
}

$axisDeadline = [DateTime]::UtcNow.AddMinutes(5)
$axisNextNotice = [DateTime]::MinValue
do {
  & "$axisPgBin/pg_isready.exe" -h 127.0.0.1 -p 55432 -t 2 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Output 'Local PostgreSQL is ready.'
    return
  }
  if ([DateTime]::UtcNow -ge $axisNextNotice) {
    Write-Output 'Waiting for PostgreSQL startup/recovery. Leave it running; this can take several minutes.'
    $axisNextNotice = [DateTime]::UtcNow.AddSeconds(15)
  }
  Start-Sleep -Seconds 2
} while ([DateTime]::UtcNow -lt $axisDeadline)
throw 'PostgreSQL is not ready after five minutes. It may still be recovering. Inspect .local/postgres.log; do not start another server, remove postmaster.pid, or reset the cluster. Retry npm run dev once recovery finishes.'
