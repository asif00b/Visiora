"""
Configuration for Face Recognition Attendance System
Supports XAMPP MySQL (default) with PyMySQL driver.
"""

import os
from datetime import timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
STORAGE_DIR = os.path.join(ROOT_DIR, 'storage')

# ── MySQL / XAMPP Connection ──────────────────────────────────────────────────
MYSQL_HOST     = os.environ.get('MYSQL_HOST',     'localhost')
MYSQL_PORT     = int(os.environ.get('MYSQL_PORT', '3306'))
MYSQL_USER     = os.environ.get('MYSQL_USER',     'root')
MYSQL_PASSWORD = os.environ.get('MYSQL_PASSWORD', '')          # XAMPP default: empty
MYSQL_DATABASE = os.environ.get('MYSQL_DATABASE', 'attendance_db')


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'change-this-secret-abc123xyz!')

    # MySQL via PyMySQL (pure Python, no C compiler needed)
    SQLALCHEMY_DATABASE_URI = (
        f'mysql+pymysql://{MYSQL_USER}:{MYSQL_PASSWORD}'
        f'@{MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DATABASE}'
        f'?charset=utf8mb4'
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_recycle': 280,          # Avoid MySQL "gone away" after idle
        'pool_pre_ping': True,        # Test connection before using
        'connect_args': {
            'connect_timeout': 10,
        }
    }

    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'nub-attendance-jwt-secret-key-2026-secure!')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=8)

    KNOWN_FACES_DIR   = os.path.join(STORAGE_DIR, 'known_faces')
    UNKNOWN_FACES_DIR = os.path.join(STORAGE_DIR, 'unknown_faces')
    MAX_CONTENT_LENGTH = 32 * 1024 * 1024  # 32 MB

    CORS_ORIGINS = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
    ]
