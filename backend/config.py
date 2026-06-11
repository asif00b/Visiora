"""
Application configuration.

The project now targets PostgreSQL with pgvector. Legacy fallback logic was
removed so deployment failures are visible early instead of silently switching
databases.
"""

import os
from datetime import timedelta
from urllib.parse import urlparse

# Load .env from project root automatically so `python app.py` works directly
try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
    load_dotenv(_env_path, override=False)
except ImportError:
    pass  # python-dotenv not installed — rely on OS env vars


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
STORAGE_DIR = os.environ.get("STORAGE_DIR", os.path.join(ROOT_DIR, "storage"))

DEFAULT_DATABASE_URL = (
    "postgresql+psycopg://postgres:postgres@localhost:5432/attendance_db"
)

DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
DATABASE_URL = DATABASE_URL or DEFAULT_DATABASE_URL

# Render provides postgres:// but SQLAlchemy requires postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)


def _db_backend(uri: str) -> str:
    scheme = urlparse(uri).scheme.split("+", 1)[0]
    return scheme or "postgresql"


DB_BACKEND = _db_backend(DATABASE_URL)


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "change-this-secret-abc123xyz!")

    SQLALCHEMY_DATABASE_URI = DATABASE_URL
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_size": int(os.environ.get("DB_POOL_SIZE", "5")),
        "max_overflow": int(os.environ.get("DB_MAX_OVERFLOW", "5")),
        "pool_recycle": int(os.environ.get("DB_POOL_RECYCLE_SECONDS", "1800")),
        "pool_pre_ping": True,
        "connect_args": {
            "connect_timeout": int(os.environ.get("DB_CONNECT_TIMEOUT_SECONDS", "5")),
        },
    }

    JWT_SECRET_KEY = os.environ.get(
        "JWT_SECRET_KEY", "nub-attendance-jwt-secret-key-2026-secure!"
    )
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=8)

    KNOWN_FACES_DIR = os.path.join(STORAGE_DIR, "known_faces")
    UNKNOWN_FACES_DIR = os.path.join(STORAGE_DIR, "unknown_faces")
    MAX_CONTENT_LENGTH = int(os.environ.get("MAX_CONTENT_LENGTH_MB", "32")) * 1024 * 1024

    # Local dev origins + deployed frontend
    CORS_ORIGINS = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # Dynamically add production frontend URL (set in Render env vars)
    _frontend_url = os.environ.get("FRONTEND_URL")
    if _frontend_url:
        CORS_ORIGINS.append(_frontend_url.rstrip("/"))

    DB_BACKEND = DB_BACKEND

    INSIGHTFACE_MODEL = os.environ.get("INSIGHTFACE_MODEL", "buffalo_s")
    INSIGHTFACE_DET_SIZE = int(os.environ.get("INSIGHTFACE_DET_SIZE", "320"))
    ARCFACE_FORCE_CPU = os.environ.get("ARCFACE_FORCE_CPU", "false").lower() == "true"

    TRACKER_ALGORITHM = os.environ.get("TRACKER_ALGORITHM", "KCF")
    TRACKER_DETECTION_INTERVAL = int(os.environ.get("TRACKER_DETECTION_INTERVAL", "5"))
    TRACKER_RECOGNITION_INTERVAL = int(os.environ.get("TRACKER_RECOGNITION_INTERVAL", "18"))
