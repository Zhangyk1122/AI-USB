$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = Join-Path $root 'platforms\win32-x64\node.exe'
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This demo supports Windows x64 only.' }
& $node (Join-Path $root 'lib\cc-switch.mjs') @args
exit $LASTEXITCODE
