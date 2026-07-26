@echo off
title Visiora - Attendance System Launcher
color 0B
cd /d "%~dp0"
backend\venv\Scripts\python.exe launcher.py
pause
