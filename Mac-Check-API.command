#!/bin/bash
set -e
USB_ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE="$USB_ROOT/platforms/darwin-arm64/node"
if [ "$(uname -m)" != "arm64" ]; then echo "This demo supports Apple Silicon Mac only."; exit 1; fi
if [ ! -x "$NODE" ]; then echo "Missing bundled Node runtime."; exit 1; fi
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
    read -r -s -p "DeepSeek API Key (hidden, not saved): " DEEPSEEK_API_KEY
    echo
    export DEEPSEEK_API_KEY
fi
exec "$NODE" "$USB_ROOT/lib/check-api.mjs" "$@"
