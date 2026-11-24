param(
    [string]$GameDirectory = 'D:\DMM\gakumas',
    [string]$SnapshotPath = '',
    [switch]$CheckOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath($PSScriptRoot)
. (Join-Path $appRoot 'Collector-Control.ps1')
$dataDirectory = Join-Path $appRoot 'data'
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
$statusFile = Join-Path $dataDirectory 'install-status.json'
$status = @{ state='starting'; startedAt=(Get-Date).ToString('o') }
function Save-Status { $status | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statusFile -Encoding utf8 }
Save-Status
try {
    $gameRoot = (Resolve-Path -LiteralPath $GameDirectory).ProviderPath.TrimEnd('\','/')
    if (-not (Test-Path -LiteralPath (Join-Path $gameRoot 'gakumas.exe') -PathType Leaf)) { throw '선택한 폴더에 학마스 실행 파일이 없습니다.' }
    if (-not $CheckOnly -and @(Get-Process -Name gakumas -ErrorAction SilentlyContinue).Count) { throw '게임이 실행 중입니다. 게임을 완전히 종료한 뒤 수집기 연결을 다시 실행해 주세요.' }
    $sourceDll = Join-Path $appRoot 'collector/version.dll'
    if (-not (Test-Path -LiteralPath $sourceDll)) { $sourceDll = Join-Path (Split-Path -Parent $appRoot) 'collector/build/version.dll' }
    if (-not (Test-Path -LiteralPath $sourceDll -PathType Leaf)) { throw '검증된 수집 모듈을 찾을 수 없습니다.' }
    $collectorHash = (Get-FileHash -LiteralPath $sourceDll -Algorithm SHA256).Hash
    $manifestFile = Join-Path $appRoot 'collector/manifest.json'
    if (Test-Path -LiteralPath $manifestFile) {
        $buildManifest = Get-Content -Raw -Encoding utf8 -LiteralPath $manifestFile | ConvertFrom-Json
        if ($buildManifest.sha256 -ne $collectorHash) { throw '수집 모듈 파일의 확인값이 다릅니다.' }
    }
    $targetDll = Join-Path $gameRoot 'version.dll'
    $updateOwnCollector = $false
    if ((Test-Path -LiteralPath $targetDll) -and (Get-FileHash -LiteralPath $targetDll -Algorithm SHA256).Hash -ne $collectorHash) {
        $previousManifest = Join-Path $dataDirectory 'installation.json'
        if (Test-Path -LiteralPath $previousManifest) {
            $previous = Get-Content -Raw -Encoding utf8 -LiteralPath $previousManifest | ConvertFrom-Json
            $previousFile = @($previous.files | Where-Object { $_.path -eq $targetDll })
            $updateOwnCollector = $previous.gameDirectory -eq $gameRoot -and $previousFile.Count -eq 1 -and
                $previousFile[0].sha256 -eq (Get-FileHash -LiteralPath $targetDll -Algorithm SHA256).Hash
        }
        if (-not $updateOwnCollector) { throw '게임 폴더에 다른 한글패치 또는 모듈이 있습니다. 기존 파일을 덮어쓰지 않고 통합이 필요합니다.' }
    }
    $systemVersion = Join-Path ([Environment]::SystemDirectory) 'version.dll'
    $systemHash = (Get-FileHash -LiteralPath $systemVersion -Algorithm SHA256).Hash
    $companion = Join-Path $gameRoot 'gakumas_inventory_system_version.dll'
    if ((Test-Path -LiteralPath $companion) -and (Get-FileHash -LiteralPath $companion -Algorithm SHA256).Hash -ne $systemHash) {
        throw '기존 보조 파일과 현재 Windows 버전이 다릅니다. 게임을 종료한 뒤 업데이트가 필요합니다.'
    }
    if (-not $SnapshotPath) { $SnapshotPath = Resolve-CollectorSnapshotPath -AppRoot $appRoot }
    $SnapshotPath = [IO.Path]::GetFullPath($SnapshotPath)
    $status['gameDirectory'] = $gameRoot
    $status['snapshotPath'] = $SnapshotPath
    $status['collectorSha256'] = $collectorHash
    $status['state'] = 'checked'
    Save-Status
    if ($CheckOnly) { Write-Output '설치 대상과 모듈 확인을 마쳤습니다. 게임 폴더는 변경하지 않았습니다.'; exit 0 }
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($SnapshotPath)) -Force | Out-Null
    $configDirectory = Join-Path $gameRoot 'gakumas-inventory'
    New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
    $configPath = Join-Path $configDirectory 'collector.ini'
    if (Test-Path -LiteralPath $configPath) {
        $backupPath = Join-Path $dataDirectory ('collector-config-before-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.ini')
        Copy-Item -LiteralPath $configPath -Destination $backupPath
        $status['previousConfigBackup'] = $backupPath
    }
    # The Windows loader resolves these genuine forwarders; no runtime code patch.
    if (-not (Test-Path -LiteralPath $companion)) { Copy-Item -LiteralPath $systemVersion -Destination $companion }
    $collectorDataDirectory = [IO.Path]::GetDirectoryName($SnapshotPath)
    $controlPath = Join-Path $collectorDataDirectory 'collector-control.json'
    Set-CollectorControlOff -DataDirectory $collectorDataDirectory
    [IO.File]::WriteAllText($configPath, "[collector]`r`noutput=$SnapshotPath`r`ncontrol=$controlPath`r`ninterval_seconds=10`r`n", [Text.Encoding]::Unicode)
    if ($updateOwnCollector) {
        $backupName = 'gakumas-inventory.previous-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.dll'
        $backupDll = [IO.Path]::GetFullPath((Join-Path $gameRoot $backupName))
        if ([IO.Path]::GetDirectoryName($backupDll) -ne $gameRoot -or (Test-Path -LiteralPath $backupDll)) { throw '이전 수집 모듈의 보관 경로를 확인할 수 없습니다.' }
        Rename-Item -LiteralPath $targetDll -NewName $backupName
        try { Copy-Item -LiteralPath $sourceDll -Destination $targetDll }
        catch { if (-not (Test-Path -LiteralPath $targetDll)) { Rename-Item -LiteralPath $backupDll -NewName 'version.dll' }; throw }
        $status['previousCollectorBackup'] = $backupDll
    } elseif (-not (Test-Path -LiteralPath $targetDll)) { Copy-Item -LiteralPath $sourceDll -Destination $targetDll }
    if ((Get-FileHash -LiteralPath $targetDll -Algorithm SHA256).Hash -ne $collectorHash) { throw '설치한 모듈의 확인값이 일치하지 않습니다.' }
    $installation = @{
        installedAt=(Get-Date).ToString('o'); gameDirectory=$gameRoot; snapshotPath=$SnapshotPath;
        files=@(@{path=$targetDll;sha256=$collectorHash},@{path=$companion;sha256=$systemHash});
        collectorConfig=$configPath; collectorControl=$controlPath; moduleVersion='0.1.3';
    }
    $installation | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $dataDirectory 'installation.json') -Encoding utf8
    $status['state'] = 'installed'
    $status['restartRequired'] = $true
    Save-Status
    Write-Output '수집 모듈을 연결했습니다. 기본은 일반 모드입니다. 게임을 다시 실행한 뒤 수집 모드로 시작.cmd를 선택할 때만 보유 목록을 갱신합니다.'
} catch {
    $status['state']='error'; $status['message']=$_.Exception.Message; Save-Status
    Write-Error $_.Exception.Message
    exit 1
}
