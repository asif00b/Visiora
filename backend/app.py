"""
Visiora — Backend
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
    logger.info('Starting Visiora — AI Organizational Suite v6.0.0')

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
    from routes.biometric import biometric_bp
    from routes.leaves import leaves_bp

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
    app.register_blueprint(biometric_bp,      url_prefix=prefix)
    app.register_blueprint(leaves_bp,         url_prefix=prefix)


    # ── Static file serving (profile/face images) ────────────────────────────
    from config import STORAGE_DIR as _STORAGE_ROOT

    @app.route('/storage/<path:filepath>')
    def serve_storage(filepath):
        return send_from_directory(os.path.abspath(_STORAGE_ROOT), filepath)

    # ── Serve built frontend (SPA) ─────────────────────────────────────────
    _FRONTEND_DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'dist')

    @app.route('/')
    def serve_frontend_root():
        dist = os.path.abspath(_FRONTEND_DIST)
        if os.path.isfile(os.path.join(dist, 'index.html')):
            return send_from_directory(dist, 'index.html')
        return jsonify({
            'name': 'Visiora — AI Organizational Suite Backend',
            'status': 'active',
            'version': '6.1.0',
            'hint': 'Run "npm run build" in frontend/ to enable web UI'
        }), 200

    @app.route('/<path:path>')
    def serve_frontend_files(path):
        dist = os.path.abspath(_FRONTEND_DIST)
        # Serve actual files (JS, CSS, images, etc.)
        full_path = os.path.join(dist, path)
        if os.path.isfile(full_path):
            return send_from_directory(dist, path)
        # SPA fallback — return index.html for client-side routes
        if os.path.isfile(os.path.join(dist, 'index.html')):
            return send_from_directory(dist, 'index.html')
        return jsonify({'error': 'Not found'}), 404

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

        # ── Start Periodic IMAP Gmail Polling Background Worker ──
        try:
            import threading
            def _background_gmail_poller(flask_app):
                while True:
                    time.sleep(15)
                    try:
                        with flask_app.app_context():
                            from services.email_leave_parser import fetch_and_process_gmail_inbox
                            fetch_and_process_gmail_inbox()
                    except Exception as pe:
                        logger.debug(f"[BackgroundIMAP] Poll error: {pe}")

            poller_thread = threading.Thread(target=_background_gmail_poller, args=(app,), daemon=True)
            poller_thread.start()
            logger.info('[Startup] Background IMAP Gmail Email Poller started (15s interval).')
        except Exception as te:
            logger.warning(f'[Startup] Could not start IMAP Poller: {te}')

    logger.info('Application startup complete.')
    return app


if __name__ == '__main__':
    app = create_app()
    print('\n' + '=' * 55)
    print('  Visiora — AI Organizational Suite · Backend v6.1')
    print('  Running on http://localhost:5000')
    is_debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host='0.0.0.0', port=5000, debug=is_debug, use_reloader=is_debug)
