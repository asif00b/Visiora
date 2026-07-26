@echo off
title Visiora - Local Development & Public Tunnel
color 0B

echo.
echo ============================================================
echo   Starting Visiora System
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

echo [3/3] Launching Public Tunnel (Cloudflare)...
start "Visiora Public Tunnel" cmd /k "cloudflared tunnel --url http://localhost:5173"

echo.
echo Backend is live! Starting Frontend (Vite)...
cd /d "%~dp0frontend"
npm.cmd run dev
