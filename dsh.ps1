$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = Join-Path $root 'platforms\win32-x64\node.exe'
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This demo supports Windows x64 only.' }
if (-not (Test-Path -LiteralPath $node)) { throw 'Missing bundled Node runtime. Copy the complete AI-USB-Demo folder again.' }
& $node (Join-Path $root 'lib\launch.mjs') @args
exit $LASTEXITCODE
