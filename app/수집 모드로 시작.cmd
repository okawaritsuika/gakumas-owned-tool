@echo off
powershell.exe -NoProfile -File "%~dp0Start-Tool.ps1" -Collect
if errorlevel 1 pause
