param([ValidateSet('postgresql','mysql')][string]$Database = 'postgresql')
$ErrorActionPreference = 'Stop'
$templateRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$artifactRoot = Join-Path $templateRoot 'artifacts'
$newProjectName = 'GeneratedBackend' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$newProjectPath = Join-Path $artifactRoot $newProjectName
$installedSdk = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Microsoft/dotnet/dotnet.exe' } else { '' }
$dotnetCommand = if ($installedSdk -and (Test-Path -LiteralPath $installedSdk)) { $installedSdk } else { 'dotnet' }
if ($dotnetCommand -ne 'dotnet') { $env:DOTNET_ROOT = Split-Path $dotnetCommand; $env:PATH = "$env:DOTNET_ROOT;$env:PATH" }
Push-Location $templateRoot
try {
    & $dotnetCommand run --project tools/ModularBackend.Initializer -- "--database=$Database" --yes $newProjectPath
    if ($LASTEXITCODE) { throw 'Initializer failed' }
    $marker = Get-Content -LiteralPath (Join-Path $newProjectPath 'backend-template.json') -Raw | ConvertFrom-Json
    if ($marker.databaseProvider -ne $Database) { throw 'Generated provider marker is incorrect' }
    if ($Database -eq 'mysql' -and (Get-Content -LiteralPath (Join-Path $newProjectPath 'compose.yaml') -Raw) -notmatch 'MYSQL_DATABASE') { throw 'Generated Compose provider is incorrect' }
    foreach ($forbidden in @('.git','uploads','TestResults')) { if (Test-Path -LiteralPath (Join-Path $newProjectPath $forbidden)) { throw 'Forbidden template content' } }
    & $dotnetCommand build (Join-Path $newProjectPath "$newProjectName.slnx") -c Release --no-restore -warnaserror
    if ($LASTEXITCODE) { throw 'Generated build failed' }
    & $dotnetCommand test (Join-Path $newProjectPath "tests/$newProjectName.UnitTests") -c Release --no-build
    if ($LASTEXITCODE) { throw 'Generated unit tests failed' }
    & $dotnetCommand test (Join-Path $newProjectPath "tests/$newProjectName.ContractTests") -c Release --no-build
    if ($LASTEXITCODE) { throw 'Generated contract tests failed' }
    & $dotnetCommand pack templates/ModularBackend.Template.csproj -c Release -o (Join-Path $artifactRoot 'packages')
    if ($LASTEXITCODE) { throw 'Template package failed' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $package = Get-ChildItem -LiteralPath (Join-Path $artifactRoot 'packages') -Filter '*.nupkg' | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    $zip = [IO.Compression.ZipFile]::OpenRead($package.FullName)
    try {
        foreach ($entry in $zip.Entries) { if ($entry.FullName -match '(^|/)(\.env|\.git|bin|obj|uploads|TestResults)(/|$)') { throw 'Unsafe package content' } }
        if ($zip.Entries.FullName -notcontains 'content/src/ModularBackend.Api/Program.cs') { throw 'Source missing from package' }
        if ($zip.Entries.FullName -notcontains 'content/.template.config/template.json') { throw 'Template metadata missing' }
    } finally { $zip.Dispose() }
    Write-Output "Initializer, generated project and package verified at $newProjectPath"
} finally { Pop-Location }
