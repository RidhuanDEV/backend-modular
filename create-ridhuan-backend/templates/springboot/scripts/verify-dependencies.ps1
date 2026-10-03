param([string]$OutputDirectory="")
$ErrorActionPreference="Stop"
$rootPath=Split-Path $PSScriptRoot -Parent
$diagnosticRoot=if($env:RUNNER_TEMP){$env:RUNNER_TEMP}else{[IO.Path]::GetTempPath()}
if(!$OutputDirectory){$OutputDirectory=Join-Path $diagnosticRoot ("spring-dependency-audit-"+[guid]::NewGuid().ToString("N"))}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$dependencyFile=Join-Path $OutputDirectory "dependencies.txt"
$wrapperPath=Join-Path $rootPath $(if($IsWindows){"mvnw.cmd"}else{"mvnw"})
$results=@()
try{
 & $wrapperPath -B -DskipTests dependency:list "-DoutputFile=$dependencyFile" *> (Join-Path $OutputDirectory "resolution.log")
 if($LASTEXITCODE -ne 0){throw "Dependency resolution failed"}
 $packages=@()
 foreach($line in Get-Content $dependencyFile){
  if($line -match '^\s+([^: ]+):([^: ]+):jar:(?:[^: ]+:)?([^: ]+):(compile|runtime|test|provided)\b'){
   $packages+=@{name=$Matches[1]+":"+$Matches[2];version=$Matches[3]}
  }
 }
 if($packages.Count -lt 50){throw "Incomplete resolved dependency inventory"}
 $queries=@($packages | ForEach-Object { @{package=@{name=$_.name;ecosystem="Maven"};version=$_.version} })
 $response=Invoke-RestMethod -Method Post -Uri "https://api.osv.dev/v1/querybatch" -ContentType "application/json" -Body (@{queries=$queries}|ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 90
 if($response.results.Count -ne $packages.Count){throw "Invalid OSV response inventory"}
 $findings=@()
 for($index=0;$index -lt $packages.Count;$index++){
  foreach($vulnerability in @($response.results[$index].vulns)){
   if($null -ne $vulnerability){$findings+=@{package=$packages[$index];id=$vulnerability.id}}
  }
 }
 @{packages=$packages;findings=$findings;checkedAt=[DateTime]::UtcNow.ToString("O");source="https://api.osv.dev/v1/querybatch"} | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $OutputDirectory "osv.json")
 $results+=@{id="vulnerabilities";status=$(if($findings.Count){"FAIL"}else{"PASS"});findings=$findings.Count}
}catch{$results+=@{id="vulnerabilities";status="FAIL";error=$_.Exception.Message}}
try{
 & $wrapperPath -B -DskipTests org.codehaus.mojo:license-maven-plugin:2.7.1:add-third-party "-Dlicense.outputDirectory=$OutputDirectory" "-Dlicense.failOnMissing=true" *> (Join-Path $OutputDirectory "licenses.log")
 $results+=@{id="licenses";status=$(if($LASTEXITCODE -eq 0){"PASS"}else{"FAIL"});exitCode=$LASTEXITCODE}
}catch{$results+=@{id="licenses";status="FAIL";error=$_.Exception.Message}}
$results | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $OutputDirectory "results.json")
$results | ForEach-Object {Write-Output ($_.id+": "+$_.status)}
Write-Output ("Diagnostics: "+$OutputDirectory)
if($results.Where({$_.status -eq "FAIL"}).Count){exit 1}
