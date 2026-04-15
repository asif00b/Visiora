from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from database import db
from models.unknown_face import UnknownFace, SystemConfig
from models.user import User
from utils.auth_helpers import require_role

admin_bp = Blueprint('admin', __name__)


# ── System Config ─────────────────────────────────────────────────────────────

@admin_bp.route('/admin/config', methods=['GET'])
@jwt_required()
@require_role('admin')
def get_config():
    configs = SystemConfig.query.all()
    return jsonify({
        'success': True,
        'config': {c.key: c.value for c in configs}
    }), 200


@admin_bp.route('/admin/config', methods=['PUT'])
@jwt_required()
@require_role('admin')
def update_config():
    data = request.get_json()
    for key, value in data.items():
        SystemConfig.set(key, value)

    # Reload face engine tolerance from new config
    try:
        from face_engine.encoder import FaceEngine
        FaceEngine.get_instance().load_from_db()
    except Exception:
        pass

    return jsonify({'success': True, 'message': 'Config updated'}), 200


# ── Unknown Faces ─────────────────────────────────────────────────────────────

@admin_bp.route('/admin/unknown-faces', methods=['GET'])
@jwt_required()
@require_role('admin')
def list_unknown_faces():
    unknowns = UnknownFace.query.order_by(UnknownFace.captured_at.desc()).limit(100).all()
    return jsonify({'success': True, 'unknown_faces': [u.to_dict() for u in unknowns]}), 200


@admin_bp.route('/admin/unknown-faces/<int:uid>/assign', methods=['POST'])
@jwt_required()
@require_role('admin')
def assign_unknown_face(uid):
    unknown = UnknownFace.query.get_or_404(uid)
    data = request.get_json()
    user_id = data.get('user_id')

    if not user_id:
        return jsonify({'success': False, 'message': 'user_id required'}), 400

    User.query.get_or_404(user_id)
    unknown.assigned_to_id = user_id
    db.session.commit()

    return jsonify({'success': True, 'message': 'Assigned successfully'}), 200


@admin_bp.route('/admin/unknown-faces/<int:uid>', methods=['DELETE'])
@jwt_required()
@require_role('admin')
def delete_unknown_face(uid):
    unknown = UnknownFace.query.get_or_404(uid)
    import os
    try:
        from flask import current_app
        full_path = os.path.join(
            current_app.config['UNKNOWN_FACES_DIR'].replace('unknown_faces', ''),
            unknown.image_path
        )
        if os.path.exists(full_path):
            os.remove(full_path)
    except Exception:
        pass
    db.session.delete(unknown)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Deleted'}), 200


# ── Cache Reload ──────────────────────────────────────────────────────────────

@admin_bp.route('/admin/reload-cache', methods=['POST'])
@jwt_required()
@require_role('admin')
def reload_face_cache():
    """Force reload of in-memory face encoding cache from DB."""
    try:
        from face_engine.encoder import FaceEngine
        engine = FaceEngine.get_instance()
        engine.load_from_db()
        return jsonify({
            'success': True,
            'message': f'Cache reloaded. {engine.cache_size()} encodings loaded.'
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ── System Info ───────────────────────────────────────────────────────────────

@admin_bp.route('/admin/system-info', methods=['GET'])
@jwt_required()
@require_role('admin')
def system_info():
    try:
        from face_engine.encoder import FaceEngine, FACE_RECOGNITION_AVAILABLE, CV2_AVAILABLE
        engine = FaceEngine.get_instance()
        cache_size = engine.cache_size()
        face_available = FACE_RECOGNITION_AVAILABLE
        cv2_available = CV2_AVAILABLE
    except Exception:
        cache_size = 0
        face_available = False
        cv2_available = False

    from models.user import User
    from models.attendance import Attendance
    from models.face_encoding import FaceEncoding

    return jsonify({
        'success': True,
        'info': {
            'face_recognition_available': face_available,
            'opencv_available': cv2_available,
            'cache_size': cache_size,
            'total_users': User.query.count(),
            'total_encodings': FaceEncoding.query.count(),
            'total_attendance': Attendance.query.count(),
        }
    }), 200
