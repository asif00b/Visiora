"""
Configuration for Face Recognition Attendance System
Primary: MySQL via XAMPP (PyMySQL)
Fallback: SQLite (database.db) — used automatically if MySQL is unreachable.
"""

import os
import logging
from datetime import timedelta

logger = logging.getLogger(__name__)

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR    = os.path.dirname(BASE_DIR)
STORAGE_DIR = os.path.join(ROOT_DIR, 'storage')

# ── MySQL / XAMPP Connection ──────────────────────────────────────────────────
MYSQL_HOST     = os.environ.get('MYSQL_HOST',     'localhost')
MYSQL_PORT     = int(os.environ.get('MYSQL_PORT', '3306'))
MYSQL_USER     = os.environ.get('MYSQL_USER',     'root')
MYSQL_PASSWORD = os.environ.get('MYSQL_PASSWORD', '')          # XAMPP default: empty
MYSQL_DATABASE = os.environ.get('MYSQL_DATABASE', 'attendance_db')

SQLITE_PATH = os.path.join(BASE_DIR, 'database.db')


def _build_db_uri() -> tuple[str, str]:
    """
    Probe MySQL. If reachable → return MySQL URI + 'mysql'.
    Otherwise → return SQLite URI + 'sqlite'.
    """
    mysql_uri = (
        f'mysql+pymysql://{MYSQL_USER}:{MYSQL_PASSWORD}'
        f'@{MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DATABASE}'
        f'?charset=utf8mb4'
    )
    try:
        import pymysql
        conn = pymysql.connect(
            host=MYSQL_HOST,
            port=MYSQL_PORT,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            database=MYSQL_DATABASE,
            connect_timeout=3,
        )
        conn.close()
        logger.info(f'[Config] MySQL reachable at {MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DATABASE}')
        return mysql_uri, 'mysql'
    except Exception as e:
        logger.warning(
            f'[Config] MySQL unavailable ({e}) — falling back to SQLite: {SQLITE_PATH}'
        )
        return f'sqlite:///{SQLITE_PATH}', 'sqlite'


# Resolve at import time so Flask config can be set synchronously
_DB_URI, DB_BACKEND = _build_db_uri()


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'change-this-secret-abc123xyz!')

    SQLALCHEMY_DATABASE_URI = _DB_URI
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = (
        {
            'pool_recycle': 280,
            'pool_pre_ping': True,
            'connect_args': {'connect_timeout': 10},
        }
        if DB_BACKEND == 'mysql'
        else {
            'connect_args': {'check_same_thread': False},
        }
    )

    JWT_SECRET_KEY           = os.environ.get('JWT_SECRET_KEY', 'nub-attendance-jwt-secret-key-2026-secure!')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=8)

    KNOWN_FACES_DIR    = os.path.join(STORAGE_DIR, 'known_faces')
    UNKNOWN_FACES_DIR  = os.path.join(STORAGE_DIR, 'unknown_faces')
    MAX_CONTENT_LENGTH = 32 * 1024 * 1024  # 32 MB

    CORS_ORIGINS = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
    ]

    DB_BACKEND = DB_BACKEND  # expose for health-check routes
