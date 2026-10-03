param([string]$Only="",[switch]$SkipDocker)
$ErrorActionPreference="Continue"
$projectPath=Split-Path $PSScriptRoot -Parent
$diagnosticRoot=if($env:RUNNER_TEMP){$env:RUNNER_TEMP}else{[System.IO.Path]::GetTempPath()}
$reportPath=Join-Path $diagnosticRoot ("springboot-verification-"+[guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $reportPath | Out-Null
$tasks=@(
 @{id="core-unit";args=@("-B","-Dtest=CoreTest","test");timeout=600},
 @{id="storage-scopes";args=@("-B","-Dtest=StorageScopeTest","test");timeout=600},
 @{id="stream-transport";args=@("-B","-Dtest=StreamConnectionTest","test");timeout=600},
 @{id="schema-upgrade-both-providers";args=@("-B","-Dtest=SchemaTest","test");timeout=900},
 @{id="systems-both-providers";args=@("-B","-Dtest=SystemsTest","test");timeout=900},
 @{id="formatter";args=@("-B","spotless:check");timeout=600},
 @{id="dependency-tree";args=@("-B","-DskipTests","dependency:tree");timeout=600}
)
$tasks | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $reportPath "plan.json")
if($Only -and $Only -notin $tasks.id){
 @{id=$Only;status="FAIL";exitCode=1;error="Unknown native gate"} | ConvertTo-Json | Set-Content (Join-Path $reportPath "results.json")
 Write-Error "Unknown native gate: $Only";exit 1
}
$selected=@($tasks | Where-Object {(!$Only -or $_.id -eq $Only) -and (!$SkipDocker -or $_.id -notin @("schema-upgrade-both-providers","systems-both-providers"))})
if(!$selected.Count){
 @{id=$Only;status="FAIL";exitCode=1;error="No executable gate selected"} | ConvertTo-Json | Set-Content (Join-Path $reportPath "results.json")
 Write-Error "No executable gate selected";exit 1
}
$results=@()
$nativeOwner="spring-native-"+[guid]::NewGuid().ToString("N")
$env:SPRING_TEST_OWNER=$nativeOwner
foreach($task in $selected){
 $log=Join-Path $reportPath ($task.id+".log")
 $errLog=Join-Path $reportPath ($task.id+".stderr.log")
 $code=1
 try {
  $info=[System.Diagnostics.ProcessStartInfo]::new()
  $info.WorkingDirectory=$projectPath
  $info.UseShellExecute=$false
  $info.CreateNoWindow=$true
  $info.RedirectStandardOutput=$true
  $info.RedirectStandardError=$true
  if($IsWindows){
   $info.FileName="powershell.exe"
   $quote={param($v) "'"+$v.Replace("'","''")+"'"}
   $script="& "+(& $quote (Join-Path $projectPath "mvnw.cmd"))+" "+(($task.args|ForEach-Object {& $quote $_}) -join " ")+'; exit $LASTEXITCODE'
   foreach($arg in @("-NoProfile","-NonInteractive","-EncodedCommand",[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script)))){$info.ArgumentList.Add($arg)}
  }else{$info.FileName="/bin/sh";$info.ArgumentList.Add("./mvnw");foreach($arg in $task.args){$info.ArgumentList.Add($arg)}}
  $process=[System.Diagnostics.Process]::new()
  $process.StartInfo=$info
  $process.Start() | Out-Null
  $stdout=$process.StandardOutput.ReadToEndAsync()
  $stderr=$process.StandardError.ReadToEndAsync()
  if(!$process.WaitForExit($task.timeout*1000)){$process.Kill($true);$process.WaitForExit();$code=124}else{$code=$process.ExitCode}
  [System.IO.File]::WriteAllText($log,$stdout.GetAwaiter().GetResult())
  [System.IO.File]::WriteAllText($errLog,$stderr.GetAwaiter().GetResult())
  $process.Dispose()
 }catch{$_ | Out-File $errLog -Append}
 finally {
  if($task.id -in @("schema-upgrade-both-providers","systems-both-providers")){
   $ids=@(docker ps -a --filter ("label=ridhuan.test.owner="+$nativeOwner) --format "{{.ID}}")
   if($LASTEXITCODE -ne 0){$code=1}
   foreach($id in $ids){ if($id -match "^[a-f0-9]+$"){docker rm -f -v $id | Out-File $errLog -Append; if($LASTEXITCODE -ne 0){$code=1}} }
   $left=@(docker ps -a --filter ("label=ridhuan.test.owner="+$nativeOwner) --format "{{.ID}}")
   if($LASTEXITCODE -ne 0 -or $left.Count){$code=1}
  }
 }
 $results+=@{id=$task.id;exitCode=$code;status=$(if($code -eq 0){"PASS"}else{"FAIL"});log=$log;stderr=$errLog}
 Write-Output ($task.id+": "+$results[-1].status)
}
$results | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $reportPath "results.json")
Write-Output ("Diagnostics: "+$reportPath)
if($results.Where({$_.exitCode -ne 0}).Count -gt 0){exit 1}
