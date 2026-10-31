$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = Join-Path $root 'platforms\win32-x64\node.exe'
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This demo supports Windows x64 only.' }
$previousKey = $env:DEEPSEEK_API_KEY
try {
    if (-not $env:DEEPSEEK_API_KEY) {
        $secure = Read-Host 'DeepSeek API Key (hidden, not saved)' -AsSecureString
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $env:DEEPSEEK_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    }
    & $node (Join-Path $root 'lib\launch.mjs') 'codex' @args
    $result = $LASTEXITCODE
} finally { $env:DEEPSEEK_API_KEY = $previousKey }
exit $result
