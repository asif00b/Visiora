import logging
from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from database import db
from models.user import User
from models.fingerprint import UserFingerprint
from biometric.futronic import (
    get_futronic_driver, 
    enroll_fingerprint_native,
    verify_fingerprint_native
)
from services.attendance_service import mark_attendance_once
from utils.auth_helpers import require_auth, require_role, get_current_user

biometric_bp = Blueprint('biometric', __name__)
logger = logging.getLogger(__name__)


@biometric_bp.route('/biometric/status', methods=['GET'])
@jwt_required()
@require_auth
def device_status():
    """Check Futronic FS80H hardware scanner connection status."""
    driver = get_futronic_driver()
    is_connected = driver.is_device_connected()
    return jsonify({
        'success': True,
        'connected': is_connected,
        'device_name': 'Futronic FS80H USB Optical Scanner',
        'status': 'ready' if is_connected else 'disconnected'
    }), 200


@biometric_bp.route('/biometric/poll-hardware', methods=['GET'])
@jwt_required()
@require_auth
def poll_hardware():
    """Poll Futronic FS80H sensor — returns touch state, template, and live PNG preview."""
    from biometric.futronic import poll_hardware_sensor
    import base64
    res = poll_hardware_sensor()

    preview_b64 = None
    if res.get('touch') and res.get('template_b64'):
        try:
            from PIL import Image
            import io
            raw = base64.b64decode(res['template_b64'])
            # FS80H sensor: 320 wide x 480 tall grayscale
            if len(raw) == 153600:
                img = Image.frombytes('L', (320, 480), raw)
            else:
                side = int(len(raw) ** 0.5)
                img = Image.frombytes('L', (side, side), raw[:side*side])
            buf = io.BytesIO()
            img.save(buf, format='PNG')
            preview_b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
        except Exception as e:
            logger.debug(f"[Biometric] Preview generation error: {e}")

    return jsonify({
        'success': True,
        'touch': res.get('touch', False),
        'template_b64': res.get('template_b64'),
        'preview_png': preview_b64,
    }), 200


@biometric_bp.route('/biometric/enroll', methods=['POST'])
@jwt_required()
@require_auth
def enroll_fingerprint():
    """Enroll a new fingerprint template for a user."""
    try:
        data = request.get_json() or {}
        user_id = data.get('user_id')
        finger_name = data.get('finger_name', 'Right Thumb')
        template_b64 = data.get('template_b64')
        samples_b64 = data.get('samples_b64')

        if not user_id:
            return jsonify({'success': False, 'message': 'user_id required'}), 400

        current = get_current_user()
        if current.role in ['user', 'student'] and current.id != int(user_id):
            return jsonify({'success': False, 'message': 'Access denied'}), 403

        user = User.query.get_or_404(int(user_id))

        # Always use native SDK enrollment for high precision 3.3KB templates
        template_b64, quality = enroll_fingerprint_native()
        if not template_b64:
            return jsonify({'success': False, 'message': 'Enrollment failed or timed out. Please try again.'}), 400

        # Ensure table exists in database
        try:
            db.create_all()
        except Exception:
            pass

        finger = UserFingerprint(
            user_id=user.id,
            finger_name=finger_name,
            template_b64=template_b64,
            quality_score=quality,
        )
        db.session.add(finger)
        db.session.commit()

        logger.info(f"[Biometric] Enrolled {finger_name} for user {user.name} (id={user.id})")
        return jsonify({
            'success': True,
            'message': f'{finger_name} registered successfully!',
            'fingerprint': finger.to_dict(),
        }), 201
    except Exception as e:
        db.session.rollback()
        logger.error(f"[Biometric] Enrollment error: {e}")
        return jsonify({'success': False, 'message': f'Enrollment error: {str(e)}'}), 500


@biometric_bp.route('/biometric/verify', methods=['POST'])
@jwt_required()
@require_auth
def verify_fingerprint_and_mark():
    """
    Live Biometric Scan via Futronic FS80H:
    Capture fingerprint, match against database templates using SIFT matching, and mark IN/OUT Punch!
    """
    data = request.get_json() or {}
    session_id = data.get('session_id')

    # Search all enrolled fingerprints in database
    all_fingerprints = UserFingerprint.query.all()
    if not all_fingerprints:
        return jsonify({
            'success': False, 
            'matched': False, 
            'message': 'No fingerprints enrolled in database.'
        }), 200

    # All templates must be validated via SourceAFIS native SDK
    records = [{"userId": fp.user_id, "templateB64": fp.template_b64} for fp in all_fingerprints]
    matched_user_id = verify_fingerprint_native(records)

    if not matched_user_id:
        return jsonify({
            'success': False,
            'matched': False,
            'message': 'No matching fingerprint found. Please try again.',
            'confidence': 0.0
        }), 200

    # Find the matching database record
    best_match = UserFingerprint.query.filter_by(user_id=matched_user_id).first()
    if not best_match:
        return jsonify({'success': False, 'message': 'Match found but record missing.'}), 400

    user = best_match.user
    if not user or not user.is_active:
        return jsonify({'success': False, 'message': 'User account is inactive'}), 400

    # Trigger IN/OUT Punch Attendance
    result = mark_attendance_once(
        user_id=user.id,
        session_id=session_id,
        status='present',
        note=f'Biometric IN/OUT ({best_match.finger_name})',
    )

    record = result.get('attendance')
    marked = result.get('marked', False)
    punch_type = result.get('punch_type', 'IN')
    reason = result.get('reason', 'unknown')

    if marked:
        msg = f"Fingerprint Verified! {user.name} ({punch_type} Punch)"
    elif reason == 'cooldown':
        msg = result.get('message', f"Fingerprint Verified: {user.name} (Cooldown active: min 10 min wait between punches)")
    elif reason == 'already_marked_today':
        msg = f"Fingerprint Verified: {user.name} (Attendance already completed for today)"
    else:
        msg = result.get('message', f"Fingerprint Verified: {user.name}")

    return jsonify({
        'success': True,
        'matched': True,
        'attendance_marked': marked,
        'reason': reason,
        'confidence': 99.0,
        'user': user.to_dict(),
        'punch_type': punch_type,
        'in_time': record.timestamp.isoformat() if record and record.timestamp else None,
        'out_time': record.punch_out.isoformat() if record and record.punch_out else None,
        'target_hours': user.weekly_target_hours or 40.0,
        'timestamp': record.timestamp.isoformat() if record and record.timestamp else datetime.utcnow().isoformat(),
        'message': msg
    }), 200


@biometric_bp.route('/biometric/user/<int:uid>', methods=['GET'])
@jwt_required()
@require_auth
def get_user_fingerprints(uid):
    current = get_current_user()
    if current.role in ['user', 'student'] and current.id != uid:
        return jsonify({'success': False, 'message': 'Access denied'}), 403

    fingerprints = UserFingerprint.query.filter_by(user_id=uid).all()
    return jsonify({
        'success': True,
        'fingerprints': [f.to_dict() for f in fingerprints],
    }), 200


@biometric_bp.route('/biometric/fingerprint/<int:fid>', methods=['DELETE'])
@jwt_required()
@require_role('admin', 'hr')
def delete_fingerprint(fid):
    finger = UserFingerprint.query.get_or_404(fid)
    db.session.delete(finger)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Fingerprint deleted'}), 200
