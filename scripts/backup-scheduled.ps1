param([ValidateSet('create','restore-check','health')][string]$Operation='create')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
node --env-file-if-exists=.env --import tsx scripts/backup.ts $Operation
if ($LASTEXITCODE -ne 0) {
  # Local operator alert only; no email, Telegram or network call.
  & eventcreate.exe /T ERROR /ID 100 /L APPLICATION /SO AXIS-Backup /D "AXIS backup operation failed. Inspect private backup status and scheduler result."
  exit 1
}
