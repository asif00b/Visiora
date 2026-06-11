@echo off
setlocal enabledelayedexpansion

title Visiora - Setup
color 0A

if "%DATABASE_URL%"=="" set "DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/attendance_db"
if "%INSIGHTFACE_MODEL%"=="" set "INSIGHTFACE_MODEL=buffalo_s"
if "%INSIGHTFACE_DET_SIZE%"=="" set "INSIGHTFACE_DET_SIZE=320"
if "%TRACKER_ALGORITHM%"=="" set "TRACKER_ALGORITHM=KCF"

echo.
echo ============================================================
echo   Visiora - Setup
echo   PostgreSQL + pgvector + InsightFace
echo ============================================================
echo.

echo [1/5] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not on PATH.
    echo         Install Python 3.10 and enable "Add Python to PATH".
    pause
    exit /b 1
)
for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo [OK] Python %PYVER% found.
echo.

echo [2/5] Creating Python virtual environment...
cd /d "%~dp0backend"
if not exist venv (
    python -m venv venv
    echo [OK] Virtual environment created.
) else (
    echo [OK] Virtual environment already exists.
)
call venv\Scripts\activate.bat
echo.

echo [3/5] Installing backend packages...
python -m pip install --upgrade pip --quiet
python -m pip install --quiet -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Backend package installation failed.
    echo         If faiss-cpu is unavailable on your Windows Python build,
    echo         install FAISS with Conda or temporarily remove faiss-cpu;
    echo         the app will fall back to NumPy matching until FAISS is installed.
    pause
    exit /b 1
)
echo [OK] Backend packages installed.
echo.

echo [4/5] Checking PostgreSQL and pgvector...
python -c "import os; from sqlalchemy import create_engine,text; e=create_engine(os.environ['DATABASE_URL']); c=e.connect(); c.execute(text('CREATE EXTENSION IF NOT EXISTS vector')); c.commit(); c.close(); print('[OK] PostgreSQL reachable and pgvector enabled')"
if errorlevel 1 (
    echo.
    echo [ERROR] Cannot connect to PostgreSQL using DATABASE_URL:
    echo         %DATABASE_URL%
    echo.
    echo Create the database first, then run setup again:
    echo   createdb attendance_db
    echo   psql -d attendance_db -c "CREATE EXTENSION vector;"
    pause
    exit /b 1
)

echo [4b] Creating tables and default admin...
python -c "from flask import Flask; from config import Config; from database import init_db; import models; app=Flask('init'); app.config.from_object(Config); init_db(app); print('[OK] Database schema ready')"
if errorlevel 1 (
    echo [ERROR] Database initialization failed.
    pause
    exit /b 1
)
echo.

if exist database.db (
    echo [INFO] Existing legacy database found: backend\database.db
    echo        To migrate it into PostgreSQL, run:
    echo        cd backend
    echo        venv\Scripts\python scripts\migrate_to_postgres.py
    echo.
)

echo [5/5] Installing frontend packages...
cd /d "%~dp0frontend"
if not exist node_modules (
    npm install
) else (
    npm install
)
if errorlevel 1 (
    echo [ERROR] Frontend package installation failed.
    pause
    exit /b 1
)
echo [OK] Frontend packages installed.
echo.

echo ============================================================
echo   Setup complete.
echo.
echo   Start the system with: start.bat
echo   Admin login: admin@system.com / admin123
echo ============================================================
echo.
pause
