$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$axisPgBin = if ($env:PG_BIN) { $env:PG_BIN } else { 'C:/Program Files/PostgreSQL/18/bin' }
& "$axisPgBin/pg_ctl.exe" -D .local/pgdata status | Out-Null
if ($LASTEXITCODE -ne 0) {
  & "$axisPgBin/pg_ctl.exe" -D .local/pgdata -l .local/postgres.log -o '-h 127.0.0.1 -p 55432' -w start
  if ($LASTEXITCODE -ne 0) { throw 'Could not start the isolated PostgreSQL cluster. See docs/runbook.md.' }
}
try {
  npm run db:migrate
  if ($LASTEXITCODE -ne 0) { throw 'Migration failed. Startup stopped.' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed. Startup stopped.' }
  Write-Output 'Open http://localhost:3000. Press Ctrl+C to stop AXIS.'
  npm run dev:api
  if ($LASTEXITCODE -ne 0) { throw 'API stopped with an error. Check local configuration.' }
} finally {
  Write-Output 'Local PostgreSQL remains running for the independent reminder worker. See docs/runbook.md for explicit shutdown.'
}
