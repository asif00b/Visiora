@echo off
setlocal enabledelayedexpansion

title Face Recognition Attendance System — Running
color 0B

echo.
echo ============================================================
echo   Face Recognition Attendance System
echo   Version 6 ^| XAMPP MySQL
echo ============================================================
echo.

REM ── Check MySQL is reachable ─────────────────────────────────
echo Checking XAMPP MySQL...
python -c "import pymysql; c=pymysql.connect(host='localhost',port=3306,user='root',password='',connect_timeout=3); c.close()" >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Cannot reach MySQL at localhost:3306
    echo         Please start MySQL in XAMPP Control Panel first!
    echo.
    pause
    exit /b 1
)
echo [OK] MySQL is running.
echo.

REM ── Activate virtual environment ─────────────────────────────
cd /d "%~dp0backend"

if not exist venv\Scripts\activate.bat (
    echo [ERROR] Virtual environment not found.
    echo         Please run setup.bat first!
    pause
    exit /b 1
)

call venv\Scripts\activate.bat

REM ── Start Flask backend in a new window ─────────────────────
echo Starting Flask backend...
start "Flask Backend :5000" cmd /k "cd /d %~dp0backend && call venv\Scripts\activate.bat && python app.py"

REM Wait 3 seconds for Flask to initialize
timeout /t 3 /nobreak >nul

REM ── Start Vite frontend ──────────────────────────────────────
echo Starting React frontend...
cd /d "%~dp0frontend"

if not exist node_modules (
    echo [INFO] Installing frontend dependencies (first time)...
    npm install
)

start "React Frontend :5173" cmd /k "cd /d %~dp0frontend && npm run dev"

REM Wait for Vite to start
timeout /t 4 /nobreak >nul

echo.
echo ============================================================
echo   System is starting up...
echo.
echo   Backend API:   http://localhost:5000/api/health
echo   Frontend:      http://localhost:5173
echo.
echo   Admin login:   admin@system.com
echo   Password:      admin123
echo.
echo   Close the two terminal windows to stop the system.
echo ============================================================
echo.

REM Open browser automatically
start http://localhost:5173

pause
