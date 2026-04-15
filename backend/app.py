"""
Face Recognition Attendance System — Backend
Flask Application Entry Point
"""

import os
from flask import Flask, send_from_directory, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from config import Config
from database import db, init_db

# Import all models so SQLAlchemy sees them before create_all()
import models  # noqa: F401


def create_app():
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

    # ── Register Blueprints ───────────────────────────────────────────────────
    from routes.auth import auth_bp
    from routes.users import users_bp
    from routes.departments import departments_bp
    from routes.sessions import sessions_bp
    from routes.attendance import attendance_bp
    from routes.face import face_bp
    from routes.admin import admin_bp

    prefix = '/api'
    app.register_blueprint(auth_bp, url_prefix=prefix)
    app.register_blueprint(users_bp, url_prefix=prefix)
    app.register_blueprint(departments_bp, url_prefix=prefix)
    app.register_blueprint(sessions_bp, url_prefix=prefix)
    app.register_blueprint(attendance_bp, url_prefix=prefix)
    app.register_blueprint(face_bp, url_prefix=prefix)
    app.register_blueprint(admin_bp, url_prefix=prefix)

    # ── Static file serving (profile/face images) ────────────────────────────
    storage_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'storage')

    @app.route('/storage/<path:filepath>')
    def serve_storage(filepath):
        return send_from_directory(os.path.abspath(storage_root), filepath)

    # ── Health check ─────────────────────────────────────────────────────────
    @app.route('/api/health')
    def health():
        return jsonify({'status': 'ok', 'version': '6.0.0'}), 200

    # ── Load face encoding cache ──────────────────────────────────────────────
    with app.app_context():
        try:
            from face_engine.encoder import FaceEngine
            FaceEngine.get_instance().load_from_db()
        except Exception as e:
            app.logger.warning(f'Face engine cache load skipped: {e}')

    return app


if __name__ == '__main__':
    app = create_app()
    print('\n' + '=' * 55)
    print('  Face Recognition Attendance System — Backend')
    print('  Running on http://localhost:5000')
    print('  Default admin: admin@system.com / admin123')
    print('=' * 55 + '\n')
    app.run(host='0.0.0.0', port=5000, debug=True)
