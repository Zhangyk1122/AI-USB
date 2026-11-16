@echo off
rem Compatibility alias. The real entry point is dsh.bat (next to this file).
call "%~dp0dsh.bat" %*
exit /b %errorlevel%
