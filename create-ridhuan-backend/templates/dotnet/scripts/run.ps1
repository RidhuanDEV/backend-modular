[CmdletBinding(PositionalBinding = $false)]
param([string]$EnvFile = '.env', [Parameter(ValueFromRemainingArguments = $true)][string[]]$DotnetArguments)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $EnvFile) {
    foreach ($line in [IO.File]::ReadAllLines((Resolve-Path -LiteralPath $EnvFile))) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
        if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { throw 'Invalid environment assignment' }
        $envName = $Matches[1]; $envValue = $Matches[2]
        if ($envName -in @('HOME','CODEX_HOME','PATH','PSModulePath','COMSPEC')) { throw 'Reserved environment name' }
        if ($envValue.Length -ge 2 -and (($envValue.StartsWith('"') -and $envValue.EndsWith('"')) -or ($envValue.StartsWith("'") -and $envValue.EndsWith("'")))) { $envValue = $envValue.Substring(1, $envValue.Length - 2) }
        [Environment]::SetEnvironmentVariable($envName, $envValue, 'Process')
    }
}
$installedSdk = Join-Path $env:LOCALAPPDATA 'Microsoft\dotnet\dotnet.exe'
$dotnetCommand = if (Test-Path -LiteralPath $installedSdk) { $installedSdk } else { 'dotnet' }
if (Test-Path -LiteralPath $installedSdk) { $env:DOTNET_ROOT = Split-Path $installedSdk; $env:PATH = "$env:DOTNET_ROOT;$env:PATH" }
if (!$DotnetArguments) { $DotnetArguments = @('run','--project','src/ModularBackend.Api','--no-launch-profile') }
& $dotnetCommand @DotnetArguments
exit $LASTEXITCODE
