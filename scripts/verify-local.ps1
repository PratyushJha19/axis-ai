param([switch]$Browser)
$ErrorActionPreference = 'Stop'
$axisRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $axisRoot
$axisPgBin = 'C:/Program Files/PostgreSQL/18/bin'
$axisStarted = $false
& "$axisPgBin/pg_ctl.exe" -D .local/pgdata status | Out-Null
if ($LASTEXITCODE -ne 0) {
  & "$axisPgBin/pg_ctl.exe" -D .local/pgdata -l .local/postgres.log -o '-h 127.0.0.1 -p 55432' -w start
  if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL startup failed' }
  $axisStarted = $true
}
$axisOldTestUrl = $env:TEST_DATABASE_URL
try {
  $axisSuffix = [Guid]::NewGuid().ToString('N').Substring(0,12)
  $axisDatabase = if ($Browser) { "axis_test_e2e_$axisSuffix" } else { "axis_test_$axisSuffix" }
  $axisPassword = Get-Content -LiteralPath .local/pg-password -Raw
  $env:PGPASSWORD = $axisPassword
  & "$axisPgBin/createdb.exe" -h 127.0.0.1 -p 55432 -U axis_local -T template0 -E UTF8 $axisDatabase
  if ($LASTEXITCODE -ne 0) { throw 'Test database creation failed' }
  Remove-Item Env:PGPASSWORD
  $env:TEST_DATABASE_URL = "postgresql://axis_local:${axisPassword}@127.0.0.1:55432/$axisDatabase"
  if ($Browser) {
    # Each workflow retains the production request limit, with an independent
    # server/window instead of accumulating every synthetic user on one test IP.
    foreach ($axisSpec in (Get-ChildItem -LiteralPath tests/e2e -Filter '*.spec.ts' | Sort-Object Name)) {
      npx playwright test $axisSpec.Name
      if ($LASTEXITCODE -ne 0) { throw "Browser verification failed: $($axisSpec.Name)" }
    }
  } else { npm run test:integration }
  if ($LASTEXITCODE -ne 0) { throw 'Verification failed' }
  if (-not $Browser -and $axisStarted) {
    & "$axisPgBin/pg_ctl.exe" -D .local/pgdata -m fast -w stop
    if ($LASTEXITCODE -ne 0) { throw 'Restart stop failed' }
    & "$axisPgBin/pg_ctl.exe" -D .local/pgdata -l .local/postgres.log -o '-h 127.0.0.1 -p 55432' -w start
    if ($LASTEXITCODE -ne 0) { throw 'Restart start failed' }
    node --import tsx scripts/check-persistence.ts
    if ($LASTEXITCODE -ne 0) { throw 'Persistence check failed' }
  }
  Write-Output "Verified with isolated database $axisDatabase (retained for inspection)."
} finally {
  $env:TEST_DATABASE_URL = $axisOldTestUrl
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($axisStarted) { & "$axisPgBin/pg_ctl.exe" -D .local/pgdata -m fast -w stop }
}
