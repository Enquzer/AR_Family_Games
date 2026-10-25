@echo off
:: ==============================================================================
:: AR Family Games - Single-Window Launcher
:: Launches the background server silently and opens the game as a single window.
:: ==============================================================================
cd /d "%~dp0"
start "" wscript.exe "%~dp0Play_AR_Games.vbs"
exit /b 0
