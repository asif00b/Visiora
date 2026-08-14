"""Database initialization, lightweight schema checks, and default seeding."""

import logging

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import inspect, text

db = SQLAlchemy()
logger = logging.getLogger(__name__)


def init_db(app):
    db.init_app(app)
    with app.app_context():
        _enable_postgres_extensions()
        _safe_create_all()
        _ensure_postgres_indexes()
        _validate_schema()
        _seed_defaults()


def _enable_postgres_extensions():
    if db.engine.dialect.name != "postgresql":
        return
    with db.engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    logger.info("[DB] PostgreSQL extension ready: vector")


def _safe_create_all():
    inspector = inspect(db.engine)
    existing_tables = set(inspector.get_table_names())

    for table in db.metadata.sorted_tables:
        if table.name not in existing_tables:
            try:
                table.create(db.engine, checkfirst=True)
                logger.info("[DB] Created table: %s", table.name)
            except Exception as exc:
                logger.warning("[DB] Could not create table %s: %s", table.name, exc)
        else:
            _add_missing_columns(table, inspector)
            _ensure_indexes(table, inspector)


def _add_missing_columns(table, inspector):
    try:
        existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
        preparer = db.engine.dialect.identifier_preparer
        table_name = preparer.quote(table.name)

        for col in table.columns:
            if col.name in existing_cols:
                continue
            col_type = col.type.compile(dialect=db.engine.dialect)
            nullable = "" if col.nullable or col.primary_key else " NOT NULL"
            default = ""
            if col.server_default is not None:
                default = f" DEFAULT {col.server_default.arg}"
            sql = (
                f"ALTER TABLE {table_name} ADD COLUMN "
                f"{preparer.quote(col.name)} {col_type}{default}{nullable}"
            )
            with db.engine.begin() as conn:
                conn.execute(text(sql))
            logger.info("[DB] Added column %s.%s", table.name, col.name)
    except Exception as exc:
        logger.debug("[DB] Column migration skipped for %s: %s", table.name, exc)


def _ensure_indexes(table, inspector):
    try:
        existing_idx = {i["name"] for i in inspector.get_indexes(table.name)}
        for idx in table.indexes:
            if idx.name and idx.name not in existing_idx:
                try:
                    idx.create(db.engine)
                    logger.info("[DB] Created index: %s", idx.name)
                except Exception as exc:
                    logger.debug("[DB] Index %s skipped: %s", idx.name, exc)
    except Exception as exc:
        logger.debug("[DB] Index check skipped for %s: %s", table.name, exc)


def _ensure_postgres_indexes():
    if db.engine.dialect.name != "postgresql":
        return

    statements = [
        # Drop legacy unique index/constraint if present
        "DROP INDEX IF EXISTS uq_attendance_user_day",
        "ALTER TABLE attendance DROP CONSTRAINT IF EXISTS uq_attendance_user_day",
        # Create session-specific unique index
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_user_session_day
        ON attendance (user_id, attendance_date, session_id)
        WHERE session_id IS NOT NULL
        """,
        # Create general unique index
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_user_general_day
        ON attendance (user_id, attendance_date)
        WHERE session_id IS NULL
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_face_encodings_embedding_hnsw
        ON face_encodings
        USING hnsw (embedding_vector vector_cosine_ops)
        WHERE embedding_vector IS NOT NULL
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_attendance_recent
        ON attendance (attendance_date DESC, timestamp DESC)
        """,
    ]
    with db.engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
            except Exception as exc:
                logger.debug("[DB] PostgreSQL index statement skipped: %s", exc)


def _validate_schema():
    inspector = inspect(db.engine)
    existing = set(inspector.get_table_names())
    required = {
        "users",
        "attendance",
        "face_encodings",
        "sessions",
        "departments",
        "unknown_faces",
        "system_config",
        "profile_change_requests",
        "leaves",
    }
    missing = required - existing
    if missing:
        logger.warning("[DB] Still missing tables after create: %s", missing)
    else:
        logger.info("[DB] Schema validation OK.")


def db_health_check():
    try:
        from config import DB_BACKEND
        from models.attendance import Attendance
        from models.face_encoding import FaceEncoding
        from models.unknown_face import UnknownFace
        from models.user import User

        db.session.execute(text("SELECT 1"))
        return {
            "status": "ok",
            "backend": DB_BACKEND,
            "users": User.query.count(),
            "attendance": Attendance.query.count(),
            "face_encodings": FaceEncoding.query.count(),
            "unknown_faces": UnknownFace.query.count(),
        }
    except Exception as exc:
        logger.error("[DB] Health check failed: %s", exc)
        return {"status": "error", "message": str(exc)}


def _seed_defaults():
    from models.department import Department
    from models.unknown_face import SystemConfig
    from models.user import User
    import bcrypt

    try:
        if not Department.query.first():
            corp_depts = [
                Department(name="General"),
                Department(name="Software Engineering & IT"),
                Department(name="Human Resources"),
                Department(name="Finance & Accounting"),
                Department(name="Operations & Logistics"),
            ]
            db.session.add_all(corp_depts)
            db.session.commit()

        default_dept = Department.query.first()

        if not User.query.filter_by(role="admin").first():
            pw_hash = bcrypt.hashpw(b"admin123", bcrypt.gensalt()).decode("utf-8")
            admin = User(
                name="Administrator",
                email="admin@system.com",
                password_hash=pw_hash,
                role="admin",
                student_id="ADM001",
                dept_id=default_dept.id if default_dept else None,
            )
            db.session.add(admin)
            db.session.commit()
            logger.info("[DB] Default admin created: admin@system.com / admin123")

        defaults = {
            "liveness_enabled": "false",
            "recognition_tolerance": "0.50",
            "arcface_tolerance": "0.40",
            "face_engine_backend": "auto",
            "attendance_cooldown_seconds": "600",
            "scanner_camera_index": "0",
            "save_unknown_faces": "true",
            "scanner_interval_ms": "240",
            "scanner_frame_max_width": "640",
            "face_detection_model": "hog",
            "face_register_model": "hog",
            "liveness_blink_count": "2",
            "min_face_size_px": "50",
            "unknown_face_dedup_threshold": "0.6",
            "unknown_face_max_age_days": "7",
            "unknown_face_max_per_cluster": "5",
            "unknown_face_max_total": "100",
        }
        for key, value in defaults.items():
            if not SystemConfig.query.filter_by(key=key).first():
                db.session.add(SystemConfig(key=key, value=value))
        db.session.commit()
        logger.info("[DB] System config defaults seeded.")

    except Exception as exc:
        db.session.rollback()
        logger.error("[DB] Seed defaults failed: %s", exc)
