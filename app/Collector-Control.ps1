# Shared by the entry scripts. Only the server creates/renews an enabled lease.
function Resolve-CollectorSnapshotPath {
    param([Parameter(Mandatory=$true)][string]$AppRoot)
    $snapshotSetting = [Environment]::GetEnvironmentVariable('GAKUMAS_SNAPSHOT', 'Process')
    if (-not [string]::IsNullOrWhiteSpace($snapshotSetting)) { return [IO.Path]::GetFullPath($snapshotSetting) }
    $installationPath = Join-Path $AppRoot 'data/installation.json'
    if (Test-Path -LiteralPath $installationPath) {
        try {
            $record = Get-Content -Raw -Encoding utf8 -LiteralPath $installationPath | ConvertFrom-Json
            $snapshotProperty = $record.PSObject.Properties['snapshotPath']
            if ($snapshotProperty -and $snapshotProperty.Value -is [string] -and -not [string]::IsNullOrWhiteSpace($snapshotProperty.Value)) {
                return [IO.Path]::GetFullPath($snapshotProperty.Value)
            }
        } catch { }
    }
    return [IO.Path]::GetFullPath((Join-Path $AppRoot 'data/inventory.json'))
}

function Set-CollectorControlOff {
    param([Parameter(Mandatory=$true)][string]$DataDirectory)
    New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
    $controlPath = Join-Path $DataDirectory 'collector-control.json'
    # Persist cancellation first: a stale heartbeat cannot erase it by replacing
    # the lease JSON. Only explicit POST mode=collect may remove this marker.
    foreach ($request in @(
        @{ Path=($controlPath + '.cancel'); Text='{}' },
        @{ Path=$controlPath; Text='{"schemaVersion":1,"enabled":false,"expiresAtUnixMs":0}' }
    )) {
        $temporaryPath = $request.Path + '.tmp.' + [guid]::NewGuid().ToString('N')
        try {
            [IO.File]::WriteAllText($temporaryPath, $request.Text, [Text.UTF8Encoding]::new($false))
            if (Test-Path -LiteralPath $request.Path) { [IO.File]::Replace($temporaryPath, $request.Path, [NullString]::Value) }
            else { [IO.File]::Move($temporaryPath, $request.Path) }
        } finally {
            if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath }
        }
    }
}
