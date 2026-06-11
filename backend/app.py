"""
Face Recognition Attendance System — Backend
Flask Application Entry Point
"""

import os
import time
import logging
import logging.handlers
from flask import Flask, send_from_directory, jsonify, g, request
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from config import Config
from database import db, init_db

# Import all models so SQLAlchemy sees them before create_all()
import models  # noqa: F401


# ── Logging setup ─────────────────────────────────────────────────────────────

def setup_logging(log_dir: str):
    """Configure root logger: file (rotating) + console."""
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, 'app.log')

    fmt = logging.Formatter(
        '%(asctime)s [%(levelname)s] %(name)s — %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    )

    # Rotating file handler — keeps last 5 × 5 MB logs
    fh = logging.handlers.RotatingFileHandler(
        log_file, maxBytes=5 * 1024 * 1024, backupCount=5, encoding='utf-8'
    )
    fh.setFormatter(fmt)
    fh.setLevel(logging.DEBUG)

    # Console handler
    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    ch.setLevel(logging.INFO)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.addHandler(fh)
    root.addHandler(ch)


def create_app():
    # Configure logging before anything else
    base_dir = os.path.dirname(os.path.abspath(__file__))
    log_dir  = os.path.join(base_dir, 'logs')
    setup_logging(log_dir)

    logger = logging.getLogger(__name__)
    logger.info('Starting Face Recognition Attendance System v6.0.0')

    app = Flask(__name__)
    app.config.from_object(Config)

    # CORS — allow Vite dev server
    CORS(app, resources={r'/api/*': {'origins': app.config['CORS_ORIGINS']}},
         supports_credentials=True)

    # JWT
    JWTManager(app)

    # Database
    init_db(app)

    # Storage dirs
    os.makedirs(app.config['KNOWN_FACES_DIR'], exist_ok=True)
    os.makedirs(app.config['UNKNOWN_FACES_DIR'], exist_ok=True)

    # ── Request timing middleware ─────────────────────────────────────────────
    @app.before_request
    def _before():
        g._start_time = time.monotonic()

    @app.after_request
    def _after(response):
        elapsed = time.monotonic() - getattr(g, '_start_time', time.monotonic())
        ms = round(elapsed * 1000, 1)
        if ms > 2000:
            app.logger.warning(
                f'SLOW REQUEST {request.method} {request.path} — {ms}ms'
            )
        response.headers['X-Response-Time'] = f'{ms}ms'
        return response

    # ── Register Blueprints ───────────────────────────────────────────────────
    from routes.auth import auth_bp
    from routes.users import users_bp
    from routes.departments import departments_bp
    from routes.sessions import sessions_bp
    from routes.attendance import attendance_bp
    from routes.face import face_bp
    from routes.admin import admin_bp
    from routes.train import train_bp
    from routes.face_quality import face_quality_bp

    prefix = '/api'
    app.register_blueprint(auth_bp,           url_prefix=prefix)
    app.register_blueprint(users_bp,          url_prefix=prefix)
    app.register_blueprint(departments_bp,    url_prefix=prefix)
    app.register_blueprint(sessions_bp,       url_prefix=prefix)
    app.register_blueprint(attendance_bp,     url_prefix=prefix)
    app.register_blueprint(face_bp,           url_prefix=prefix)
    app.register_blueprint(admin_bp,          url_prefix=prefix)
    app.register_blueprint(train_bp,          url_prefix=prefix)
    app.register_blueprint(face_quality_bp,   url_prefix=prefix)

    # ── Static file serving (profile/face images) ────────────────────────────
    from config import STORAGE_DIR as _STORAGE_ROOT

    @app.route('/storage/<path:filepath>')
    def serve_storage(filepath):
        return send_from_directory(os.path.abspath(_STORAGE_ROOT), filepath)

    # ── Health check ─────────────────────────────────────────────────────────
    @app.route('/api/health')
    def health():
        return jsonify({'status': 'ok', 'version': '6.1.0'}), 200

    # ── Load face encoding cache ──────────────────────────────────────────────
    with app.app_context():
        try:
            from face_engine.engine_factory import get_engine
            engine = get_engine()
            engine.load_from_db()
            logger.info(f'[Startup] Face engine: {engine.__class__.__name__} | cached {engine.cache_size()} user(s)')
        except Exception as e:
            app.logger.warning(f'Face engine cache load skipped: {e}')

    logger.info('Application startup complete.')
    return app


if __name__ == '__main__':
    app = create_app()
    print('\n' + '=' * 55)
    print('  FaceAttend — AI Attendance System · Backend v6.1')
    print('  Running on http://localhost:5000')
    print('=' * 55 + '\n')
    app.run(host='0.0.0.0', port=5000, debug=True)
