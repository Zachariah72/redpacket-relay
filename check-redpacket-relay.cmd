@echo off
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" --check server.js
if errorlevel 1 exit /b 1
"C:\Program Files\nodejs\node.exe" --check public\app.js
if errorlevel 1 exit /b 1
echo RedPacket Relay checks passed.
