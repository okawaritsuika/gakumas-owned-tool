param(
    [switch]$Collect,
    [switch]$NoBrowser,
    [ValidateRange(1, 65535)][int]$Port = 43127
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$address = 'http://127.0.0.1:' + $Port
. (Join-Path $appRoot 'Collector-Control.ps1')
$snapshotPath = Resolve-CollectorSnapshotPath -AppRoot $appRoot
$collectorDataDirectory = [IO.Path]::GetDirectoryName($snapshotPath)
if (-not $Collect) { Set-CollectorControlOff -DataDirectory $collectorDataDirectory }
function Test-Tool {
    try { return (Invoke-RestMethod -Uri ($address + '/api/health') -TimeoutSec 1).appId -eq 'gakumas-owned-tool' } catch { return $false }
}
if (-not (Test-Tool)) {
    $runtime = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodePath = if ($runtime) { $runtime.Source } else { Join-Path $appRoot 'runtime/node.exe' }
    if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js 20 이상이 필요합니다.' }
    $logDirectory = Join-Path $appRoot 'data'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $priorPort = [Environment]::GetEnvironmentVariable('GAKUMAS_PORT', 'Process')
    $priorSnapshot = [Environment]::GetEnvironmentVariable('GAKUMAS_SNAPSHOT', 'Process')
    try {
        $env:GAKUMAS_PORT = [string]$Port
        $env:GAKUMAS_SNAPSHOT = $snapshotPath
        Start-Process -FilePath $nodePath -ArgumentList ('"' + (Join-Path $appRoot 'server.mjs') + '"') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log') | Out-Null
    } finally {
        [Environment]::SetEnvironmentVariable('GAKUMAS_PORT', $priorPort, 'Process')
        [Environment]::SetEnvironmentVariable('GAKUMAS_SNAPSHOT', $priorSnapshot, 'Process')
    }
    for ($attempt=0; $attempt -lt 40 -and -not (Test-Tool); $attempt++) { Start-Sleep -Milliseconds 250 }
    if (-not (Test-Tool)) { throw '도구를 시작하지 못했습니다. data/server-error.log를 확인해 주세요.' }
}
$modeBody = if ($Collect) { '{"mode":"collect"}' } else { '{"mode":"normal"}' }
try {
    $mode = Invoke-RestMethod -Uri ($address + '/api/collector-mode') -Method Post -ContentType 'application/json' -Body $modeBody -TimeoutSec 30
} catch {
    Set-CollectorControlOff -DataDirectory $collectorDataDirectory
    throw '실행 모드를 설정하지 못했습니다. 기존 보유노트를 종료하고 최신 버전으로 다시 시작해 주세요.'
}
if (-not $NoBrowser) { Start-Process $address | Out-Null }
