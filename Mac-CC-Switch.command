#!/bin/bash
USB_ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE="$USB_ROOT/platforms/darwin-arm64/node"
if [ "$(uname -m)" != "arm64" ]; then echo "This demo supports Apple Silicon Mac only."; exit 1; fi
if [ ! -x "$NODE" ]; then echo "Missing bundled Node runtime."; exit 1; fi
"$NODE" "$USB_ROOT/lib/cc-switch.mjs" "$@"
result=$?
if [ "$result" -ne 0 ] && [ -t 0 ]; then read -r -p "Press Enter to close..."; fi
exit "$result"
