@echo off
title AR Family Games
color 0b
cls
echo ========================================================
echo        AR FAMILY GAMES - ALL-IN-ONE KINETIC ARENA
echo ========================================================
echo.

cd /d "%~dp0"

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js was not found in your PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

echo [1/3] Preventing Windows sleep and screen darkening...
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\keep_awake.ps1" >nul 2>&1

echo [2/3] Starting local LAN game server on port 3000...
start "AR Family Games Server" /min cmd /c "node server/index.js"

echo [3/3] Waiting for server to initialize...
timeout /t 2 /nobreak >nul

echo Launching Console: http://localhost:3000/
start http://localhost:3000/

echo.
echo ========================================================
echo  KINETIC CONSOLE IS LIVE!
echo.
echo  - SINGLE ACCESS POINT: http://localhost:3000/
echo  - Press F11 in your browser for Fullscreen immersion!
echo  - Step in front of the camera to play (up to 4 players)
echo  - Raise hand to browse & hover to start games!
echo.
echo  (You can minimize this window. Close it to stop the game)
echo ========================================================
echo.
pause
taskkill /f /im node.exe >nul 2>&1
