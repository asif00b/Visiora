from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def init_db(app):
    """Initialize DB, create tables, and seed defaults."""
    db.init_app(app)
    with app.app_context():
        db.create_all()
        _seed_defaults()


def _seed_defaults():
    from models.department import Department
    from models.user import User
    from models.system_config import SystemConfig
    import bcrypt

    # ── Default department ───────────────────────────────────────────
    if not Department.query.first():
        db.session.add(Department(name='General'))
        db.session.commit()

    default_dept = Department.query.first()

    # ── Default admin account ────────────────────────────────────────
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
        print('[DB] Default admin created: admin@system.com / admin123')

    # ── System configuration defaults ────────────────────────────────
    defaults = {
        'liveness_enabled':             'false',   # Liveness challenge ON/OFF
        'recognition_tolerance':         '0.50',   # Lower = stricter (0.4–0.6)
        'attendance_cooldown_minutes':   '10',      # Min gap between marks
        'scanner_camera_index':          '0',       # Webcam device index
        'save_unknown_faces':            'true',    # Save snapshots of unknowns
        'scanner_interval_ms':           '800',     # Frame send interval
        'face_detection_model':          'hog',     # hog (fast) for scanner
        'face_register_model':           'hog',     # hog for registration too
        'liveness_blink_count':          '2',       # Required blinks
        'min_face_size_px':              '50',      # Minimum face pixel size
    }
    for key, value in defaults.items():
        if not SystemConfig.query.filter_by(key=key).first():
            db.session.add(SystemConfig(key=key, value=value))
    db.session.commit()
