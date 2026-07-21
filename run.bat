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

echo.
echo [2/3] Waiting for Backend to initialize and become active...
echo.

:wait_backend
curl -s -f http://localhost:5000/api/health >nul
if %errorlevel% neq 0 (
    timeout /t 1 /nobreak >nul
    goto wait_backend
)

echo [3/3] Backend is live! Starting Frontend (Vite)...
start "Visiora Frontend" cmd /k "cd /d %~dp0frontend && npm.cmd run dev"

echo Launching web browser...
timeout /t 2 /nobreak >nul
start https://localhost:5173

echo.
echo ============================================================
echo   System is launching! 
echo   Feel free to close this main setup window.
echo   Keep the other two background command windows open.
echo ============================================================
echo.
pause
