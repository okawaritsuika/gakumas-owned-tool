@echo off
powershell.exe -NoProfile -File "%~dp0Stop-Tool.ps1"
if errorlevel 1 pause
