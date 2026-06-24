@echo off
title Visiora - Local Development
color 0B

echo.
echo ============================================================
echo   Starting Visiora (Local)
echo ============================================================
echo.

echo [1/3] Starting Backend (Python)...
start "Visiora Backend" cmd /k "cd /d %~dp0backend && venv\Scripts\python app.py"

echo [2/3] Starting Frontend (Vite)...
start "Visiora Frontend" cmd /k "cd /d %~dp0frontend && npm.cmd run dev"

echo [3/3] Launching web browser...
timeout /t 4 /nobreak >nul
start http://localhost:5173

echo.
echo ============================================================
echo   System is launching! 
echo   Feel free to close this main setup window.
echo   Keep the other two background command windows open.
echo ============================================================
echo.
pause
