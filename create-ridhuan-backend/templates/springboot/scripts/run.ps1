param([string]$Mode="http",[Parameter(ValueFromRemainingArguments=$true)][string[]]$Extra)
$ErrorActionPreference="Stop"
Push-Location (Split-Path $PSScriptRoot -Parent)
try { & java -jar target/app.jar "--app.mode=$Mode" @Extra; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE} } finally {Pop-Location}
