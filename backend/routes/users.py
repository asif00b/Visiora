import os
import base64
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required
import bcrypt

from database import db
from models.user import User
from models.department import Department
from utils.auth_helpers import require_role, require_auth, get_current_user

users_bp = Blueprint('users', __name__)


@users_bp.route('/users', methods=['GET'])
@jwt_required()
@require_auth
def list_users():
    current = get_current_user()
    # Students can only see themselves
    if current.role == 'student':
        return jsonify({'success': True, 'users': [current.to_dict()]}), 200

    users = User.query.order_by(User.created_at.desc()).all()
    return jsonify({'success': True, 'users': [u.to_dict() for u in users]}), 200


@users_bp.route('/users/<int:uid>', methods=['GET'])
@jwt_required()
@require_auth
def get_user(uid):
    current = get_current_user()
    if current.role == 'student' and current.id != uid:
        return jsonify({'success': False, 'message': 'Access denied'}), 403

    user = User.query.get_or_404(uid)
    return jsonify({'success': True, 'user': user.to_dict()}), 200


@users_bp.route('/users', methods=['POST'])
@jwt_required()
@require_role('admin', 'hr')
def create_user():
    data = request.get_json()
    required = ['name', 'email', 'password', 'role']
    for field in required:
        if not data.get(field):
            return jsonify({'success': False, 'message': f'{field} is required'}), 400

    # HR cannot create admins
    current = get_current_user()
    if current.role == 'hr' and data['role'] == 'admin':
        return jsonify({'success': False, 'message': 'HR cannot create admin accounts'}), 403

    if User.query.filter_by(email=data['email'].lower()).first():
        return jsonify({'success': False, 'message': 'Email already exists'}), 409

    pw_hash = bcrypt.hashpw(data['password'].encode(), bcrypt.gensalt()).decode()
    user = User(
        name=data['name'],
        email=data['email'].lower().strip(),
        password_hash=pw_hash,
        role=data['role'],
        student_id=data.get('student_id') or None,
        phone=data.get('phone') or None,
        dept_id=data.get('dept_id') if data.get('dept_id') != '' else None,
    )
    db.session.add(user)
    db.session.commit()

    # Handle profile image
    if data.get('image_b64'):
        _save_profile_image(user, data['image_b64'])

    return jsonify({'success': True, 'user': user.to_dict()}), 201


@users_bp.route('/users/<int:uid>', methods=['PUT'])
@jwt_required()
@require_role('admin', 'hr')
def update_user(uid):
    current = get_current_user()
    user = User.query.get_or_404(uid)

    # HR cannot edit admins
    if current.role == 'hr' and user.role == 'admin':
        return jsonify({'success': False, 'message': 'HR cannot edit admin accounts'}), 403

    data = request.get_json()

    if 'name' in data:
        user.name = data['name']
    if 'email' in data:
        existing = User.query.filter_by(email=data['email'].lower()).first()
        if existing and existing.id != uid:
            return jsonify({'success': False, 'message': 'Email already in use'}), 409
        user.email = data['email'].lower().strip()
    if 'phone' in data:
        user.phone = data['phone'] or None
    if 'dept_id' in data:
        user.dept_id = data['dept_id'] if data['dept_id'] != '' else None
    if 'student_id' in data:
        user.student_id = data['student_id'] or None
    if 'is_active' in data:
        user.is_active = data['is_active']
    if 'role' in data and current.role == 'admin':
        user.role = data['role']
    if 'password' in data and data['password']:
        user.password_hash = bcrypt.hashpw(data['password'].encode(), bcrypt.gensalt()).decode()
    if data.get('image_b64'):
        _save_profile_image(user, data['image_b64'])

    db.session.commit()
    return jsonify({'success': True, 'user': user.to_dict()}), 200


@users_bp.route('/users/<int:uid>', methods=['DELETE'])
@jwt_required()
@require_role('admin')
def delete_user(uid):
    current = get_current_user()
    if current.id == uid:
        return jsonify({'success': False, 'message': 'Cannot delete yourself'}), 400

    user = User.query.get_or_404(uid)
    # Remove face cache
    try:
        from face_engine.encoder import FaceEngine
        FaceEngine.get_instance().remove_from_cache(uid)
    except Exception:
        pass

    db.session.delete(user)
    db.session.commit()
    return jsonify({'success': True, 'message': 'User deleted'}), 200


def _save_profile_image(user: User, b64_string: str):
    """Save base64 profile image to disk and update user.image_path."""
    try:
        known_dir = current_app.config['KNOWN_FACES_DIR']
        os.makedirs(known_dir, exist_ok=True)

        if ',' in b64_string:
            b64_string = b64_string.split(',', 1)[1]

        image_bytes = base64.b64decode(b64_string)
        filename = f'profile_{user.id}.jpg'
        filepath = os.path.join(known_dir, filename)

        with open(filepath, 'wb') as f:
            f.write(image_bytes)

        user.image_path = f'known_faces/{filename}'
        db.session.commit()
    except Exception as e:
        current_app.logger.error(f'Profile image save error: {e}')
