$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath .env)) { throw 'Create local database configuration in .env first.' }
$axisClientId = Read-Host 'Google Web OAuth client ID'
$axisClientSecret = Read-Host 'Google client secret (hidden)' -AsSecureString
if ($axisClientId -notmatch '^[a-zA-Z0-9._-]+$') { throw 'Invalid client ID.' }
$axisSecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($axisClientSecret)
try {
  $axisSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($axisSecretPointer)
  if ($axisSecret -notmatch '^[a-zA-Z0-9._-]+$') { throw 'Invalid client secret format.' }
  $axisRandomBytes = New-Object byte[] 48
  $axisRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $axisRandom.GetBytes($axisRandomBytes) } finally { $axisRandom.Dispose() }
  $axisValues = [ordered]@{
    APP_ORIGIN = 'http://localhost:3000'
    GOOGLE_CLIENT_ID = $axisClientId
    GOOGLE_CLIENT_SECRET = $axisSecret
    SESSION_SECRET = [BitConverter]::ToString($axisRandomBytes).Replace('-', '')
  }
  $axisLines = @(Get-Content -LiteralPath .env -Encoding UTF8 | Where-Object { $_ -notmatch '^(APP_ORIGIN|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|OWNER_EMAIL|SESSION_SECRET)=' })
  foreach ($axisPair in $axisValues.GetEnumerator()) { $axisLines += "$($axisPair.Key)=$($axisPair.Value)" }
  [IO.File]::WriteAllLines((Join-Path (Get-Location) '.env'), [string[]]$axisLines, (New-Object Text.UTF8Encoding $false))
  Write-Output 'Google configuration saved privately. Existing sessions are invalidated. Restart AXIS.'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($axisSecretPointer)
  $axisSecret = $null
}
