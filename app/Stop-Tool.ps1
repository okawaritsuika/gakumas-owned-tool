param([ValidateRange(1, 65535)][int]$Port = 43127)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Collector-Control.ps1')
$snapshotPath = Resolve-CollectorSnapshotPath -AppRoot $PSScriptRoot
Set-CollectorControlOff -DataDirectory ([IO.Path]::GetDirectoryName($snapshotPath))
$address = 'http://127.0.0.1:' + $Port
try {
    $health = Invoke-RestMethod -Uri ($address + '/api/health') -TimeoutSec 30
} catch {
    if ($_.Exception -is [System.Net.WebException] -and $_.Exception.Status -eq [System.Net.WebExceptionStatus]::ConnectFailure) {
        Write-Output '실행 중인 보유노트가 없습니다. 브라우저 탭을 닫으시면 됩니다.'
        exit 0
    }
    throw '보유노트 응답을 확인하지 못했습니다. 계산 중이라면 잠시 뒤 다시 실행해 주세요.'
}
if ($health.appId -ne 'gakumas-owned-tool') { throw '다른 프로그램이 이 주소를 사용하고 있어 종료하지 않았습니다.' }
$result = Invoke-RestMethod -Uri ($address + '/api/shutdown') -Method Post -ContentType 'application/json' -Body '{"appId":"gakumas-owned-tool"}' -TimeoutSec 30
if (-not $result.ok) { throw '보유노트 종료 요청을 확인하지 못했습니다.' }
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri ($address + '/api/health') -TimeoutSec 1
    } catch {
        Write-Output '보유노트를 종료했습니다. 브라우저 탭도 닫아 주세요.'
        Write-Output '수집 중지 설정을 저장했습니다. 구버전 수집기가 실행 중이면 게임을 완전히 종료해야 적용됩니다.'
        exit 0
    }
    if ($health.appId -ne 'gakumas-owned-tool') { throw '종료 확인 중 주소를 사용하는 프로그램이 바뀌었습니다.' }
    Start-Sleep -Milliseconds 250
}
throw '아직 종료 중입니다. 잠시 뒤 종료.cmd를 다시 실행해 주세요.'
