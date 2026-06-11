"""
Migrate existing project data into PostgreSQL while preserving IDs.

Default source: backend/database.db
Optional source: set SOURCE_DATABASE_URL to any SQLAlchemy-readable legacy URL.

Target: DATABASE_URL from the environment, or config.py's PostgreSQL default.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

from flask import Flask
from sqlalchemy import create_engine, text

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import models  # noqa: F401,E402
from config import Config  # noqa: E402
from database import db  # noqa: E402
from models.attendance import Attendance  # noqa: E402
from models.department import Department  # noqa: E402
from models.face_encoding import FaceEncoding  # noqa: E402
from models.session_model import SessionModel  # noqa: E402
from models.unknown_face import SystemConfig, UnknownFace  # noqa: E402
from models.user import User  # noqa: E402


TABLES = (
    "departments",
    "users",
    "sessions",
    "face_encodings",
    "attendance",
    "unknown_faces",
    "system_config",
)


def main():
    source_url = os.environ.get("SOURCE_DATABASE_URL")
    if not source_url:
        sqlite_path = os.environ.get("SQLITE_SOURCE") or str(BACKEND_DIR / "database.db")
        source_url = f"sqlite:///{sqlite_path}"

    app = Flask(__name__)
    app.config.from_object(Config)
    db.init_app(app)

    with app.app_context():
        _prepare_target()

        source_engine = create_engine(source_url)
        with source_engine.connect() as source:
            counts = _copy_all(source)

        db.session.commit()
        _reset_postgres_sequences()

    print("Migration complete:")
    for table in TABLES:
        print(f"  {table}: {counts.get(table, 0)} row(s)")


def _prepare_target():
    if db.engine.dialect.name != "postgresql":
        raise RuntimeError("Target DATABASE_URL must point to PostgreSQL.")
    with db.engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    db.create_all()


def _copy_all(source):
    counts = {}
    counts["departments"] = _copy_departments(_rows(source, "departments"))
    counts["users"] = _copy_users(_rows(source, "users"))
    counts["sessions"] = _copy_sessions(_rows(source, "sessions"))
    counts["face_encodings"] = _copy_face_encodings(_rows(source, "face_encodings"))
    counts["attendance"] = _copy_attendance(_rows(source, "attendance"))
    counts["unknown_faces"] = _copy_unknown_faces(_rows(source, "unknown_faces"))
    counts["system_config"] = _copy_system_config(_rows(source, "system_config"))
    return counts


def _rows(conn, table):
    try:
        return [dict(row) for row in conn.execute(text(f"SELECT * FROM {table}")).mappings()]
    except Exception:
        return []


def _copy_departments(rows):
    for row in rows:
        db.session.merge(
            Department(
                id=row.get("id"),
                name=row.get("name") or "General",
                description=row.get("description"),
                created_at=_dt(row.get("created_at")),
            )
        )
    db.session.flush()
    return len(rows)


def _copy_users(rows):
    for row in rows:
        db.session.merge(
            User(
                id=row.get("id"),
                name=row.get("name") or "Unknown",
                email=row.get("email") or f"user-{row.get('id')}@local.invalid",
                password_hash=row.get("password_hash") or "$2b$12$placeholder",
                role=row.get("role") or "student",
                student_id=row.get("student_id"),
                phone=row.get("phone"),
                dept_id=row.get("dept_id"),
                image_path=row.get("image_path"),
                is_active=_bool(row.get("is_active"), True),
                created_at=_dt(row.get("created_at")),
            )
        )
    db.session.flush()
    return len(rows)


def _copy_sessions(rows):
    for row in rows:
        db.session.merge(
            SessionModel(
                id=row.get("id"),
                name=row.get("name") or "General",
                description=row.get("description"),
                start_time=_time(row.get("start_time")),
                end_time=_time(row.get("end_time")),
                valid_from=_date(row.get("valid_from")),
                valid_to=_date(row.get("valid_to")),
                allow_multiple=_bool(row.get("allow_multiple"), False),
                cooldown_minutes=row.get("cooldown_minutes") or 10,
                is_active=_bool(row.get("is_active"), True),
                created_at=_dt(row.get("created_at")),
            )
        )
    db.session.flush()
    return len(rows)


def _copy_face_encodings(rows):
    copied = 0
    for row in rows:
        rec = FaceEncoding(
            id=row.get("id"),
            user_id=row.get("user_id"),
            image_path=row.get("image_path"),
            quality_score=row.get("quality_score"),
            created_at=_dt(row.get("created_at")),
            encoding_type=row.get("encoding_type") or "single",
            source_count=row.get("source_count") or 1,
        )
        raw = row.get("encoding_data")
        try:
            rec.set_encoding(json.loads(raw) if isinstance(raw, str) else raw)
        except Exception:
            rec.encoding_data = raw
        db.session.merge(rec)
        copied += 1
    db.session.flush()
    return copied


def _copy_attendance(rows):
    copied = 0
    for row in rows:
        ts = _dt(row.get("timestamp")) or datetime.utcnow()
        db.session.merge(
            Attendance(
                id=row.get("id"),
                user_id=row.get("user_id"),
                session_id=row.get("session_id"),
                attendance_date=_date(row.get("attendance_date")) or ts.date(),
                timestamp=ts,
                status=row.get("status") or "present",
                marked_by_id=row.get("marked_by_id"),
                note=row.get("note"),
            )
        )
        copied += 1
    db.session.flush()
    return copied


def _copy_unknown_faces(rows):
    copied = 0
    for row in rows:
        image_path = row.get("image_path")
        if not image_path:
            continue
        rec = UnknownFace(
            id=row.get("id"),
            image_path=image_path,
            captured_at=_dt(row.get("captured_at")),
            confidence_score=row.get("confidence_score"),
            assigned_to_id=row.get("assigned_to_id"),
            encoding_data=row.get("encoding_data"),
            cluster_id=row.get("cluster_id"),
        )
        db.session.merge(rec)
        copied += 1
    db.session.flush()
    return copied


def _copy_system_config(rows):
    for row in rows:
        db.session.merge(
            SystemConfig(
                id=row.get("id"),
                key=row.get("key"),
                value=str(row.get("value", "")),
                updated_at=_dt(row.get("updated_at")),
            )
        )
    db.session.flush()
    return len(rows)


def _reset_postgres_sequences():
    if db.engine.dialect.name != "postgresql":
        return
    for table in TABLES:
        with db.engine.begin() as conn:
            conn.execute(
                text(
                    f"""
                    SELECT setval(
                        pg_get_serial_sequence('{table}', 'id'),
                        COALESCE((SELECT MAX(id) FROM {table}), 1),
                        true
                    )
                    """
                )
            )


def _dt(value):
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _date(value):
    if value in (None, ""):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    try:
        return date.fromisoformat(str(value)[:10])
    except Exception:
        return None


def _time(value):
    if value in (None, ""):
        return None
    if hasattr(value, "hour") and hasattr(value, "minute"):
        return value
    try:
        return datetime.strptime(str(value)[:5], "%H:%M").time()
    except Exception:
        return None


def _bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


if __name__ == "__main__":
    main()
