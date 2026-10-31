$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This demo supports Windows x64 only.' }
$bundledNode = Join-Path $root 'platforms\win32-x64\node.exe'
if (-not (Test-Path -LiteralPath $bundledNode)) { throw 'Bundled Node is missing. Copy the complete Demo folder again.' }
# A local copy lets the updater replace the USB runtime without locking node.exe.
$hash = (Get-FileHash -LiteralPath $bundledNode -Algorithm SHA256).Hash.ToLowerInvariant()
$cacheBase = if ($env:AI_USB_HOST_CACHE) { $env:AI_USB_HOST_CACHE } else { Join-Path $env:LOCALAPPDATA 'AI-USB-Demo' }
$runtimeDir = Join-Path $cacheBase 'maintenance-runtime'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$node = Join-Path $runtimeDir ("node-" + $hash + '.exe')
if (-not (Test-Path -LiteralPath $node) -or (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {
    $temporary = $node + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        Copy-Item -LiteralPath $bundledNode -Destination $temporary
        if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw 'Maintenance runtime checksum mismatch.' }
        Move-Item -LiteralPath $temporary -Destination $node -Force
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}
& $node (Join-Path $root 'lib\maintenance-menu.mjs') @args
exit $LASTEXITCODE
