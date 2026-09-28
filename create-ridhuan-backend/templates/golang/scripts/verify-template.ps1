$ErrorActionPreference = 'Stop'
$files = Get-ChildItem -LiteralPath cmd,internal -Filter '*.go' -Recurse -File | ForEach-Object { $_.FullName }
$unformatted = gofmt -l $files
if ($LASTEXITCODE -ne 0 -or $unformatted) { throw "gofmt failed: $unformatted" }
go vet ./...
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
go test ./...
exit $LASTEXITCODE
