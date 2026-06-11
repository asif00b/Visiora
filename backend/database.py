"""
Database initialization, schema validation, and seeding.
Uses checkfirst=True so create_all never raises on existing tables/indexes.
"""
import logging

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
logger = logging.getLogger(__name__)


def init_db(app):
    """Initialize DB, create tables (idempotent), validate schema, seed defaults."""
    db.init_app(app)
    with app.app_context():
        _safe_create_all()
        _validate_schema()
        _seed_defaults()


def _safe_create_all():
    """
    Create all tables and indexes that don't already exist.
    Uses individual table.create(checkfirst=True) so MySQL 'Duplicate key' errors
    are avoided even when the DB was partially initialised by an older app version.
    """
    from sqlalchemy import inspect, text
    inspector = inspect(db.engine)
    existing_tables = set(inspector.get_table_names())

    for table in db.metadata.sorted_tables:
        if table.name not in existing_tables:
            try:
                table.create(db.engine, checkfirst=True)
                logger.info(f'[DB] Created table: {table.name}')
            except Exception as e:
                logger.warning(f'[DB] Could not create table {table.name}: {e}')
        else:
            # Table exists — ensure any NEW columns are added (safe ALTER)
            _add_missing_columns(table, inspector)
            # Ensure indexes exist without error
            _ensure_indexes(table, inspector)


def _add_missing_columns(table, inspector):
    """Add columns that are in the model but missing from the live table."""
    from sqlalchemy import text
    try:
        existing_cols = {c['name'] for c in inspector.get_columns(table.name)}
        for col in table.columns:
            if col.name not in existing_cols:
                col_type = col.type.compile(dialect=db.engine.dialect)
                nullable  = '' if col.nullable else ' NOT NULL'
                default   = f' DEFAULT {col.server_default.arg}' if col.server_default else ''
                alter_sql = f'ALTER TABLE `{table.name}` ADD COLUMN `{col.name}` {col_type}{nullable}{default}'
                with db.engine.connect() as conn:
                    conn.execute(text(alter_sql))
                    conn.commit()
                logger.info(f'[DB] Added column {table.name}.{col.name}')
    except Exception as e:
        logger.debug(f'[DB] Column migration skipped for {table.name}: {e}')


def _ensure_indexes(table, inspector):
    """Create any missing indexes, skip if already present."""
    try:
        existing_idx = {i['name'] for i in inspector.get_indexes(table.name)}
        for idx in table.indexes:
            if idx.name and idx.name not in existing_idx:
                try:
                    idx.create(db.engine)
                    logger.info(f'[DB] Created index: {idx.name}')
                except Exception as e:
                    logger.debug(f'[DB] Index {idx.name} skipped: {e}')
    except Exception as e:
        logger.debug(f'[DB] Index check skipped for {table.name}: {e}')


def _validate_schema():
    """Verify that all required tables exist after create."""
    from sqlalchemy import inspect
    inspector = inspect(db.engine)
    existing  = set(inspector.get_table_names())
    required  = {'users', 'attendance', 'face_encodings', 'sessions',
                 'departments', 'unknown_faces', 'system_config'}
    missing   = required - existing
    if missing:
        logger.warning(f'[DB] Still missing tables after create: {missing}')
    else:
        logger.info('[DB] Schema validation OK — all required tables present.')


def db_health_check():
    """Return DB connectivity info for a health-check API."""
    try:
        from models.user import User
        from models.attendance import Attendance
        from models.face_encoding import FaceEncoding
        from models.unknown_face import UnknownFace
        from sqlalchemy import text

        db.session.execute(text('SELECT 1'))

        from config import DB_BACKEND
        return {
            'status':         'ok',
            'backend':        DB_BACKEND,
            'users':          User.query.count(),
            'attendance':     Attendance.query.count(),
            'face_encodings': FaceEncoding.query.count(),
            'unknown_faces':  UnknownFace.query.count(),
        }
    except Exception as e:
        logger.error(f'[DB] Health check failed: {e}')
        return {'status': 'error', 'message': str(e)}


def _seed_defaults():
    from models.department import Department
    from models.user import User
    from models.unknown_face import SystemConfig
    import bcrypt

    try:
        # Default department
        if not Department.query.first():
            db.session.add(Department(name='General'))
            db.session.commit()

        default_dept = Department.query.first()

        # Default admin
        if not User.query.filter_by(role='admin').first():
            pw_hash = bcrypt.hashpw(b'admin123', bcrypt.gensalt()).decode('utf-8')
            admin = User(
                name='Administrator',
                email='admin@system.com',
                password_hash=pw_hash,
                role='admin',
                student_id='ADM001',
                dept_id=default_dept.id if default_dept else None,
            )
            db.session.add(admin)
            db.session.commit()
            logger.info('[DB] Default admin created: admin@system.com / admin123')

        # System config defaults
        defaults = {
            'liveness_enabled':            'false',
            'recognition_tolerance':        '0.50',
            'arcface_tolerance':            '0.40',
            'face_engine_backend':          'auto',
            'attendance_cooldown_minutes':  '10',
            'scanner_camera_index':         '0',
            'save_unknown_faces':           'true',
            'scanner_interval_ms':          '800',
            'face_detection_model':         'hog',
            'face_register_model':          'hog',
            'liveness_blink_count':         '2',
            'min_face_size_px':             '50',
            'unknown_face_dedup_threshold': '0.6',
            'unknown_face_max_age_days':    '7',
            'unknown_face_max_per_cluster': '5',
            'unknown_face_max_total':       '100',
        }
        for key, value in defaults.items():
            if not SystemConfig.query.filter_by(key=key).first():
                db.session.add(SystemConfig(key=key, value=value))
        db.session.commit()
        logger.info('[DB] System config defaults seeded.')

    except Exception as e:
        db.session.rollback()
        logger.error(f'[DB] Seed defaults failed: {e}')
