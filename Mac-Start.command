#!/bin/bash
set -e
USB_ROOT="$(cd "$(dirname "$0")" && pwd)"
echo "AI USB Demo"
echo "1. DeepSeek direct - Codex (experimental bridge)"
echo "2. DeepSeek direct - Claude Code"
echo "3. DeepSeek direct - Harness Web"
echo "4. Check DeepSeek API key"
echo "5. Open USB CC Switch (configure providers first)"
echo "6. CC Switch - Codex"
echo "7. CC Switch - Claude Code"
echo "8. CC Switch - Harness Web"
echo "9. Maintenance - diagnostics, backup, restore, update"
read -r -p "Choose [1-9]: " choice
case "$choice" in
  1) exec "$USB_ROOT/Mac-codex.command" ;;
  2) exec "$USB_ROOT/Mac-claude.command" ;;
  3) exec "$USB_ROOT/Mac-harness.command" ;;
  4) "$USB_ROOT/Mac-Check-API.command"; read -r -p "Press Enter to close..." ;;
  5) exec "$USB_ROOT/Mac-CC-Switch.command" ;;
  6) exec "$USB_ROOT/Mac-CC-codex.command" ;;
  7) exec "$USB_ROOT/Mac-CC-claude.command" ;;
  8) exec "$USB_ROOT/Mac-CC-harness.command" ;;
  9) exec "$USB_ROOT/Mac-Maintain.command" ;;
  *) echo "Invalid choice"; exit 1 ;;
esac
