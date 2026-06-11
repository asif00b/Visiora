@echo off
setlocal enabledelayedexpansion

title Visiora - Running
color 0B

if "%DATABASE_URL%"=="" set "DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/attendance_db"
if "%INSIGHTFACE_MODEL%"=="" set "INSIGHTFACE_MODEL=buffalo_s"
if "%INSIGHTFACE_DET_SIZE%"=="" set "INSIGHTFACE_DET_SIZE=320"
if "%TRACKER_ALGORITHM%"=="" set "TRACKER_ALGORITHM=KCF"

echo.
echo ============================================================
echo   Visiora — Face Recognition Attendance System
echo   PostgreSQL + pgvector + InsightFace
echo ============================================================
echo.

cd /d "%~dp0backend"

if not exist venv\Scripts\activate.bat (
    echo [ERROR] Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)

call venv\Scripts\activate.bat

echo Checking PostgreSQL...
python -c "import os; from sqlalchemy import create_engine,text; e=create_engine(os.environ['DATABASE_URL']); c=e.connect(); c.execute(text('SELECT 1')); c.close(); print('[OK] PostgreSQL reachable')"
if errorlevel 1 (
    echo.
    echo [ERROR] Cannot connect to PostgreSQL with DATABASE_URL:
    echo         %DATABASE_URL%
    echo.
    pause
    exit /b 1
)
echo.

echo Starting Flask backend...
start "Flask Backend :5000" cmd /k "cd /d %~dp0backend && call venv\Scripts\activate.bat && python app.py"

timeout /t 4 /nobreak >nul

echo Starting React frontend...
cd /d "%~dp0frontend"

if not exist node_modules (
    echo [INFO] Installing frontend dependencies...
    npm install
)

start "React Frontend :5173" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 4 /nobreak >nul

echo.
echo ============================================================
echo   System is starting up...
echo.
echo   Backend API: http://localhost:5000/api/health
echo   Frontend:    http://localhost:5173
echo.
echo   Admin login: admin@system.com
echo   Password:    admin123
echo.
echo   Close the two terminal windows to stop the system.
echo ============================================================
echo.

start http://localhost:5173

pause
