@echo off
setlocal
echo AI USB Demo
echo 1. DeepSeek direct - Codex (experimental bridge)
echo 2. DeepSeek direct - Claude Code
echo 3. DeepSeek direct - Harness Web
echo 4. Check DeepSeek API key
echo 5. Open USB CC Switch (configure providers first)
echo 6. CC Switch - Codex
echo 7. CC Switch - Claude Code
echo 8. CC Switch - Harness Web
echo 9. Maintenance - diagnostics, backup, restore, update
choice /c 123456789 /n /m "Choose [1-9]: "
if errorlevel 9 goto maintain
if errorlevel 8 goto cc-harness
if errorlevel 7 goto cc-claude
if errorlevel 6 goto cc-codex
if errorlevel 5 goto cc-switch
if errorlevel 4 goto check
if errorlevel 3 goto harness
if errorlevel 2 goto claude
call "%~dp0Windows-codex.bat"
goto end
:claude
call "%~dp0Windows-claude.bat"
goto end
:harness
call "%~dp0Windows-harness.bat"
goto end
:check
call "%~dp0Windows-Check-API.bat"
goto end
:cc-switch
call "%~dp0Windows-CC-Switch.bat"
goto end
:cc-codex
call "%~dp0Windows-CC-codex.bat"
goto end
:cc-claude
call "%~dp0Windows-CC-claude.bat"
goto end
:cc-harness
call "%~dp0Windows-CC-harness.bat"
goto end
:maintain
call "%~dp0Windows-Maintain.bat"
goto end
:end
endlocal
