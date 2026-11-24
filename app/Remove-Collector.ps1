Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Collector-Control.ps1')
$snapshotPath = Resolve-CollectorSnapshotPath -AppRoot $PSScriptRoot
Set-CollectorControlOff -DataDirectory ([IO.Path]::GetDirectoryName($snapshotPath))
$manifestFile = Join-Path $PSScriptRoot 'data/installation.json'
if (-not (Test-Path -LiteralPath $manifestFile)) { throw '이 도구의 설치 기록이 없습니다.' }
$installation = Get-Content -Raw -Encoding utf8 -LiteralPath $manifestFile | ConvertFrom-Json
$gameRoot = [IO.Path]::GetFullPath($installation.gameDirectory).TrimEnd('\','/')
if (-not (Test-Path -LiteralPath (Join-Path $gameRoot 'gakumas.exe'))) { throw '설치했던 게임 폴더를 확인할 수 없습니다.' }
if (@(Get-Process -Name gakumas -ErrorAction SilentlyContinue).Count) { throw '게임이 실행 중입니다. 게임을 완전히 종료한 뒤 수집기 해제를 다시 실행해 주세요.' }
foreach ($record in $installation.files) {
    $target = [IO.Path]::GetFullPath($record.path)
    if ([IO.Path]::GetDirectoryName($target) -ne $gameRoot -or [IO.Path]::GetFileName($target) -notin @('version.dll','gakumas_inventory_system_version.dll')) { throw '제거 대상이 설치한 모듈 범위를 벗어납니다.' }
    if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $record.sha256) { throw '파일이 설치 이후 변경되어 자동으로 제거할 수 없습니다.' }
}
foreach ($record in $installation.files) {
    if (Test-Path -LiteralPath $record.path) { Remove-Item -LiteralPath $record.path }
}
Write-Output '이 도구의 수집 DLL을 제거했습니다. 저장한 보유 목록과 설정은 보존했습니다.'
