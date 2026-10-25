@echo off
cd /d "%~dp0"
echo Shutting down AR Family Games server...
powershell -Command "try { Invoke-RestMethod -Uri 'http://localhost:3000/api/shutdown' -TimeoutSec 1 } catch {}" >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
echo Done.
