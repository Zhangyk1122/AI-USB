@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Windows-harness.ps1" %*
pause
