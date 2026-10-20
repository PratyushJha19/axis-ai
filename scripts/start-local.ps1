$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& "$PSScriptRoot/start-local-postgres.ps1"
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
