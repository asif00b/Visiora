@echo off
setlocal enabledelayedexpansion

title Face Recognition Attendance System — Setup
color 0A

echo.
echo ============================================================
echo   Face Recognition Attendance System — Setup
echo   Version 6 ^| XAMPP MySQL
echo ============================================================
echo.

REM ── Check Python ────────────────────────────────────────────
echo [1/6] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not on PATH.
    echo         Download Python 3.9 or 3.10 from https://python.org
    echo         Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)
for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo [OK] Python %PYVER% found.
echo.

REM ── Check XAMPP MySQL ────────────────────────────────────────
echo [2/6] Checking XAMPP MySQL connection...
python -c "import pymysql; pymysql.connect(host='localhost',port=3306,user='root',password='',connect_timeout=3)" >nul 2>&1
if errorlevel 1 (
    echo.
    echo [WARNING] Could not connect to MySQL at localhost:3306
    echo           Make sure XAMPP is running and MySQL is started (green light).
    echo           Press any key to continue anyway, or Ctrl+C to abort.
    pause
) else (
    echo [OK] XAMPP MySQL is reachable.
)
echo.

REM ── Create virtual environment ───────────────────────────────
echo [3/6] Setting up Python virtual environment...
cd /d "%~dp0backend"

if not exist venv (
    python -m venv venv
    echo [OK] Virtual environment created.
) else (
    echo [OK] Virtual environment already exists.
)
echo.

REM ── Activate venv ────────────────────────────────────────────
call venv\Scripts\activate.bat

REM ── Upgrade pip silently ─────────────────────────────────────
echo [4/6] Upgrading pip...
python -m pip install --upgrade pip --quiet
echo [OK] pip upgraded.
echo.

REM ── Core dependencies (no dlib yet) ─────────────────────────
echo [5/6] Installing Python packages...

python -m pip install --quiet ^
    "flask>=3.0.0" ^
    "flask-cors>=4.0.0" ^
    "flask-jwt-extended>=4.6.0" ^
    "flask-sqlalchemy>=3.1.0" ^
    "sqlalchemy>=2.0.0" ^
    "bcrypt>=4.0.0" ^
    "PyMySQL>=1.1.0" ^
    "numpy>=1.24.0,<2.0.0" ^
    "Pillow>=10.0.0" ^
    "opencv-python-headless>=4.8.0"

if errorlevel 1 (
    echo [ERROR] Failed to install core packages.
    pause
    exit /b 1
)
echo [OK] Core packages installed.
echo.

REM ── Try installing dlib + face_recognition ───────────────────
echo [5b] Installing face_recognition (this may take a few minutes)...
echo      If this fails, see the manual instructions below.
echo.

REM Try pre-compiled dlib wheel first (no cmake needed)
python -m pip install --quiet dlib 2>nul
if errorlevel 1 (
    echo [WARNING] Could not install dlib automatically.
    echo.
    echo ┌─────────────────────────────────────────────────────────┐
    echo │  MANUAL dlib INSTALLATION (Windows)                    │
    echo │                                                         │
    echo │  Option A — Pre-built wheel (easiest):                 │
    echo │    1. Go to: https://github.com/z-mahmud22/Dlib_Windows_Python3.x
    echo │    2. Download the .whl for YOUR Python version         │
    echo │       (e.g. dlib-19.24.1-cp310-cp310-win_amd64.whl)   │
    echo │    3. Run: pip install path\to\dlib.whl                │
    echo │    4. Then run this setup.bat again                     │
    echo │                                                         │
    echo │  Option B — Build from source:                         │
    echo │    1. Install CMake: https://cmake.org/download/        │
    echo │    2. Install Visual Studio Build Tools                 │
    echo │    3. Run: pip install dlib                             │
    echo └─────────────────────────────────────────────────────────┘
    echo.
    echo [INFO] Skipping face_recognition for now. Install dlib manually.
    echo        The rest of the system will still work.
) else (
    python -m pip install --quiet "face-recognition>=1.3.0"
    if errorlevel 1 (
        echo [WARNING] face-recognition install failed after dlib succeeded.
        echo           Try:  pip install face-recognition
    ) else (
        echo [OK] face_recognition installed.
    )
)
echo.

REM ── Create MySQL database ────────────────────────────────────
echo [6/6] Creating MySQL database...
python create_mysql_db.py
if errorlevel 1 (
    echo [WARNING] Could not create MySQL database automatically.
    echo           Make sure XAMPP MySQL is running and try again.
    echo           Or create database manually: CREATE DATABASE attendance_db CHARACTER SET utf8mb4;
)
echo.

echo ============================================================
echo   Setup complete!
echo.
echo   To start the system:  run start.bat
echo   Admin login:          admin@system.com / admin123
echo ============================================================
echo.
pause
