[CmdletBinding(PositionalBinding = $false)]
param([string]$EnvFile = '.env', [Parameter(ValueFromRemainingArguments = $true)][string[]]$DotnetArguments)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $EnvFile) {
    foreach ($line in [IO.File]::ReadAllLines((Resolve-Path -LiteralPath $EnvFile))) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
        if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { throw 'Invalid environment assignment' }
        $envName = $Matches[1]; $envValue = $Matches[2]
        if ($envName -in @('HOME','CODEX_HOME','PATH','PSModulePath','COMSPEC')) { throw 'Reserved environment name' }
        if ($envValue.Length -ge 2 -and (($envValue.StartsWith('"') -and $envValue.EndsWith('"')) -or ($envValue.StartsWith("'") -and $envValue.EndsWith("'")))) {
            $envQuote = $envValue.Substring(0, 1)
            $envValue = $envValue.Substring(1, $envValue.Length - 2)
            if ($envQuote -eq "'") { $envValue = $envValue.Replace("\'", "'") }
            else { $envValue = ConvertFrom-Json -InputObject ('"' + $envValue.Replace('\$', '$') + '"') }
        }
        if ($null -eq [Environment]::GetEnvironmentVariable($envName, 'Process')) {
            [Environment]::SetEnvironmentVariable($envName, $envValue, 'Process')
        }
    }
}
# Use the same PATH SDK that preflight and normal dotnet commands validate.
$dotnetOnPath = Get-Command dotnet -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $dotnetOnPath) { throw 'dotnet is not on PATH; install the SDK required by global.json' }
$dotnetCommand = $dotnetOnPath.Source
if (!$DotnetArguments) { $DotnetArguments = @('run','--project','src/ModularBackend.Api','--no-launch-profile') }
& $dotnetCommand @DotnetArguments
exit $LASTEXITCODE
