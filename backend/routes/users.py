import os
import base64
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required
import bcrypt

from database import db
from models.user import User
from models.department import Department
from models.profile_change_request import ProfileChangeRequest
from utils.auth_helpers import require_role, require_auth, get_current_user
from datetime import datetime

users_bp = Blueprint('users', __name__)


def _parse_time_str(time_str):
    if not time_str or str(time_str).strip() in ('', 'null', 'None'):
        return None
    try:
        parts = str(time_str).split(':')
        hr = int(parts[0])
        mn = int(parts[1])
        sc = int(parts[2]) if len(parts) > 2 else 0
        from datetime import time as dt_time
        return dt_time(hr, mn, sc)
    except Exception:
        raise ValueError(f"Invalid time format: {time_str}. Use HH:MM:SS or HH:MM")


@users_bp.route('/users', methods=['GET'])
@jwt_required()
@require_auth
def list_users():
    current = get_current_user()
    # General users can only see themselves
    if current.role in ['user', 'student']:
        return jsonify({'success': True, 'users': [current.to_dict()]}), 200

    users = User.query.order_by(User.created_at.desc()).all()
    # Hide default system admin from user list if needed, or return all
    filtered_users = [u.to_dict() for u in users if u.email != 'admin@system.com']
    return jsonify({'success': True, 'users': filtered_users}), 200


@users_bp.route('/users/<int:uid>', methods=['GET'])
@jwt_required()
@require_auth
def get_user(uid):
    current = get_current_user()
    if current.role in ['user', 'student'] and current.id != uid:
        return jsonify({'success': False, 'message': 'Access denied'}), 403

    user = User.query.get_or_404(uid)
    user_dict = user.to_dict()
    pending_req = ProfileChangeRequest.query.filter_by(user_id=uid, status='pending').first()
    user_dict['pending_profile_request'] = pending_req.to_dict() if pending_req else None
    return jsonify({'success': True, 'user': user_dict}), 200


@users_bp.route('/users', methods=['POST'])
@jwt_required()
@require_role('admin', 'hr')
def create_user():
    data = request.get_json()
    required = ['name', 'email', 'password']
    for field in required:
        if not data.get(field):
            return jsonify({'success': False, 'message': f'{field} is required'}), 400

    role = data.get('role', 'user')
    if role == 'student':
        role = 'user'

    phone = data.get('phone')
    if phone:
        import re
        if not re.match(r'^01\d{9}$', str(phone)):
            return jsonify({'success': False, 'message': 'Phone must be an 11-digit Bangladeshi number starting with 01'}), 400

    # HR cannot create admins
    current = get_current_user()
    if current.role == 'hr' and role == 'admin':
        return jsonify({'success': False, 'message': 'HR cannot create admin accounts'}), 403

    # Duplicate Unique Identifier Checks
    email_clean = data['email'].lower().strip()
    existing_email = User.query.filter(db.func.lower(User.email) == email_clean).first()
    if existing_email:
        return jsonify({
            'success': False,
            'already_registered': True,
            'message': f'Already Registered: Email "{email_clean}" is registered to existing user {existing_email.name} (ID: {existing_email.student_id or existing_email.id}).'
        }), 409

    sid_clean = data.get('student_id', '').strip() if data.get('student_id') else None
    if sid_clean:
        existing_sid = User.query.filter_by(student_id=sid_clean).first()
        if existing_sid:
            return jsonify({
                'success': False,
                'already_registered': True,
                'message': f'Already Registered: Employee/Student ID "{sid_clean}" is registered to existing user {existing_sid.name} (Email: {existing_sid.email}).'
            }), 409

    phone_clean = data.get('phone', '').strip() if data.get('phone') else None
    if phone_clean:
        existing_phone = User.query.filter_by(phone=phone_clean).first()
        if existing_phone:
            return jsonify({
                'success': False,
                'already_registered': True,
                'message': f'Already Registered: Phone number "{phone_clean}" is registered to existing user {existing_phone.name} (ID: {existing_phone.student_id or existing_phone.id}).'
            }), 409

    pw_hash = bcrypt.hashpw(data['password'].encode(), bcrypt.gensalt()).decode()
    try:
        check_in = _parse_time_str(data.get('must_check_in_time'))
        in_start = _parse_time_str(data.get('must_be_in_start'))
        in_end = _parse_time_str(data.get('must_be_in_end'))
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400

    user = User(
        name=data['name'],
        email=data['email'].lower().strip(),
        password_hash=pw_hash,
        role=role,
        student_id=data.get('student_id') or None,
        phone=data.get('phone') or None,
        dept_id=data.get('dept_id') if data.get('dept_id') != '' else None,
        weekly_target_hours=float(data.get('weekly_target_hours', 40.0)),
        must_check_in_time=check_in,
        must_be_in_start=in_start,
        must_be_in_end=in_end,
    )
    db.session.add(user)
    db.session.commit()

    # Handle profile image
    if data.get('image_b64'):
        _save_profile_image(user, data['image_b64'])

    return jsonify({'success': True, 'user': user.to_dict()}), 201


@users_bp.route('/users/bulk-schedule', methods=['PUT'])
@jwt_required()
@require_role('admin', 'hr')
def bulk_schedule_update():
    """Bulk update schedules and targets for multiple users."""
    try:
        data = request.get_json() or {}
        user_ids = data.get('user_ids')
        dept_id = data.get('dept_id')
        
        weekly_target = data.get('weekly_target_hours')
        must_check_in = data.get('must_check_in_time')
        must_be_in_start = data.get('must_be_in_start')
        must_be_in_end = data.get('must_be_in_end')

        q = User.query
        if user_ids is not None:
            if not isinstance(user_ids, list):
                return jsonify({'success': False, 'message': 'user_ids must be a list'}), 400
            q = q.filter(User.id.in_(user_ids))
        elif dept_id is not None and str(dept_id).strip() not in ('', 'all', 'null', 'None'):
            q = q.filter(User.dept_id == int(dept_id))

        users_to_update = q.all()
        if not users_to_update:
            return jsonify({'success': True, 'message': 'No users found matching filters', 'count': 0}), 200

        parsed_check_in = _parse_time_str(must_check_in) if must_check_in is not None else None
        parsed_in_start = _parse_time_str(must_be_in_start) if must_be_in_start is not None else None
        parsed_in_end = _parse_time_str(must_be_in_end) if must_be_in_end is not None else None

        updated_count = 0
        for u in users_to_update:
            if u.role == 'admin':
                continue
            
            if weekly_target is not None:
                u.weekly_target_hours = float(weekly_target) if weekly_target != '' else 40.0
            
            if must_check_in is not None:
                u.must_check_in_time = parsed_check_in
            if must_be_in_start is not None:
                u.must_be_in_start = parsed_in_start
            if must_be_in_end is not None:
                u.must_be_in_end = parsed_in_end
                
            updated_count += 1

        db.session.commit()
        return jsonify({
            'success': True,
            'message': f'Successfully updated target and schedule settings for {updated_count} user(s).',
            'count': updated_count
        }), 200

    except ValueError as ve:
        return jsonify({'success': False, 'message': str(ve)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Server error: {str(e)}'}), 500


@users_bp.route('/users/<int:uid>', methods=['PUT'])
@jwt_required()
@require_auth
def update_user(uid):
    current = get_current_user()
    
    # General users can only update their own profile
    if current.role in ['user', 'student'] and current.id != uid:
        return jsonify({'success': False, 'message': 'Access denied'}), 403

    user = User.query.get_or_404(uid)

    # HR cannot edit admins
    if current.role == 'hr' and user.role == 'admin':
        return jsonify({'success': False, 'message': 'HR cannot edit admin accounts'}), 403

    data = request.get_json() or {}

    # Restrict general user updates to only allow safe fields
    if current.role in ['user', 'student']:
        for forbidden in ['email', 'password', 'role', 'student_id', 'is_active', 'dept_id', 'weekly_target_hours']:
            data.pop(forbidden, None)

        if 'phone' in data:
            phone = data['phone']
            if phone:
                import re
                if not re.match(r'^01\d{9}$', str(phone)):
                    return jsonify({'success': False, 'message': 'Phone must be an 11-digit Bangladeshi number starting with 01'}), 400

        # Handle user changes via ProfileChangeRequest approval queue
        pending_req = ProfileChangeRequest.query.filter_by(user_id=uid, status='pending').first()
        
        req_img_path = None
        if data.get('image_b64'):
            try:
                req_img_path = _save_pending_profile_image(uid, data['image_b64'])
            except Exception as e:
                return jsonify({'success': False, 'message': f'Failed to process profile picture: {e}'}), 500
        elif pending_req:
            req_img_path = pending_req.requested_image_path

        if pending_req:
            pending_req.requested_name = data.get('name', pending_req.requested_name)
            pending_req.requested_phone = data.get('phone', pending_req.requested_phone)
            pending_req.requested_image_path = req_img_path
            pending_req.created_at = datetime.now()
        else:
            pending_req = ProfileChangeRequest(
                user_id=uid,
                requested_name=data.get('name', user.name),
                requested_phone=data.get('phone', user.phone),
                requested_image_path=req_img_path,
                status='pending'
            )
            db.session.add(pending_req)
        
        db.session.commit()
        return jsonify({
            'success': True,
            'message': 'Your profile changes have been submitted for admin approval.',
            'pending': True
        }), 202

    if 'name' in data:
        user.name = data['name']
    if 'email' in data:
        email_clean = data['email'].lower().strip()
        existing_email = User.query.filter(db.func.lower(User.email) == email_clean).first()
        if existing_email and existing_email.id != uid:
            return jsonify({
                'success': False,
                'already_registered': True,
                'message': f'Already Registered: Email "{email_clean}" is registered to existing user {existing_email.name} (ID: {existing_email.student_id or existing_email.id}).'
            }), 409
        user.email = email_clean

    if 'phone' in data:
        phone = data['phone']
        if phone and str(phone).strip():
            import re
            phone_clean = str(phone).strip()
            if not re.match(r'^01\d{9}$', phone_clean):
                return jsonify({'success': False, 'message': 'Phone must be an 11-digit Bangladeshi number starting with 01'}), 400
            existing_phone = User.query.filter_by(phone=phone_clean).first()
            if existing_phone and existing_phone.id != uid:
                return jsonify({
                    'success': False,
                    'already_registered': True,
                    'message': f'Already Registered: Phone number "{phone_clean}" is registered to existing user {existing_phone.name} (ID: {existing_phone.student_id or existing_phone.id}).'
                }), 409
            user.phone = phone_clean
        else:
            user.phone = None

    if 'student_id' in data:
        sid = data['student_id']
        if sid and str(sid).strip():
            sid_clean = str(sid).strip()
            existing_sid = User.query.filter_by(student_id=sid_clean).first()
            if existing_sid and existing_sid.id != uid:
                return jsonify({
                    'success': False,
                    'already_registered': True,
                    'message': f'Already Registered: Employee/Student ID "{sid_clean}" is registered to existing user {existing_sid.name} (Email: {existing_sid.email}).'
                }), 409
            user.student_id = sid_clean
        else:
            user.student_id = None
    if 'weekly_target_hours' in data:
        try:
            user.weekly_target_hours = float(data['weekly_target_hours']) if data['weekly_target_hours'] != '' else 40.0
        except Exception:
            pass
    if 'must_check_in_time' in data:
        try:
            user.must_check_in_time = _parse_time_str(data['must_check_in_time'])
        except Exception as e:
            return jsonify({'success': False, 'message': f'Invalid check-in time: {e}'}), 400
    if 'must_be_in_start' in data:
        try:
            user.must_be_in_start = _parse_time_str(data['must_be_in_start'])
        except Exception as e:
            return jsonify({'success': False, 'message': f'Invalid must-be-in start time: {e}'}), 400
    if 'must_be_in_end' in data:
        try:
            user.must_be_in_end = _parse_time_str(data['must_be_in_end'])
        except Exception as e:
            return jsonify({'success': False, 'message': f'Invalid must-be-in end time: {e}'}), 400
    if 'is_active' in data:
        user.is_active = data['is_active']
    if 'role' in data and current.role == 'admin':
        new_role = data['role']
        if new_role == 'student':
            new_role = 'user'
        if new_role in ['admin', 'user', 'hr']:
            # Safety check: prevent demoting the last admin
            if user.role == 'admin' and new_role != 'admin':
                admin_count = User.query.filter_by(role='admin', is_active=True).count()
                if admin_count <= 1:
                    return jsonify({'success': False, 'message': 'Cannot demote the last remaining active Administrator'}), 400
            user.role = new_role
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
    if user.email == 'admin@system.com':
        return jsonify({'success': False, 'message': 'Cannot delete default administrator account'}), 400
    
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


def _save_pending_profile_image(uid: int, b64_string: str) -> str:
    """Save base64 profile image to disk as a pending image and return its relative path."""
    try:
        known_dir = current_app.config['KNOWN_FACES_DIR']
        os.makedirs(known_dir, exist_ok=True)

        if ',' in b64_string:
            b64_string = b64_string.split(',', 1)[1]

        image_bytes = base64.b64decode(b64_string)
        filename = f'pending_profile_{uid}.jpg'
        filepath = os.path.join(known_dir, filename)

        with open(filepath, 'wb') as f:
            f.write(image_bytes)

        return f'known_faces/{filename}'
    except Exception as e:
        current_app.logger.error(f'Pending profile image save error: {e}')
        raise e

