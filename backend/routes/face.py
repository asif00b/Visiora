import os
import io
import base64
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required

from database import db
from models.face_encoding import FaceEncoding
from models.user import User
from models.unknown_face import UnknownFace, SystemConfig
from models.attendance import Attendance
from models.session_model import SessionModel
from utils.auth_helpers import require_role, require_auth, get_current_user
from face_engine.encoder import FaceEngine

face_bp = Blueprint('face', __name__)


# ── Registration ──────────────────────────────────────────────────────────────

@face_bp.route('/face/register', methods=['POST'])
@jwt_required()
@require_role('admin', 'hr')
def register_face():
    """
    Register face encodings for a student/user.

    Body:
        {
            "user_id": int,
            "images":  [base64_string, ...]   # 1–10 photos recommended
        }

    Each image is validated individually:
      - Exactly 1 face must be present
      - Face must be large enough (≥ 80px)
      - Image must not be too blurry
    """
    data    = request.get_json() or {}
    user_id = data.get('user_id')
    images  = data.get('images', [])

    if not user_id or not images:
        return jsonify({'success': False, 'message': 'user_id and images are required'}), 400

    user   = User.query.get_or_404(user_id)
    engine = FaceEngine.get_instance()

    if not engine.available:
        return jsonify({
            'success': False,
            'message': (
                'face_recognition library is not installed.\n'
                'Run setup.bat to install all dependencies.'
            )
        }), 503

    # Pull config settings
    register_model = SystemConfig.get('face_register_model', 'hog')
    min_face_size  = int(SystemConfig.get('min_face_size_px', '50'))

    from face_engine.encoder import score_image_quality, select_best_image

    # ── Step 1: Evaluate every submitted image, keep successful candidates ──
    candidates = []
    rejected   = []

    for idx, img_b64 in enumerate(images):
        label = f'Image {idx + 1}'
        try:
            image_rgb = engine.decode_image(img_b64)
            if image_rgb is None:
                rejected.append(f'{label}: decode failed')
                continue

            result = engine.encode_face_for_registration(
                image_rgb,
                model=register_model,
                min_face_size=min_face_size,
            )

            if not result['success']:
                rejected.append(f'{label}: {result["message"]}')
                continue

            # Re-score with the full composite scorer for ranking
            quality = score_image_quality(image_rgb, result['face_box'])

            candidates.append({
                'image_rgb':    image_rgb,
                'b64':          img_b64,
                'encoding':     result['encoding'],
                'quality_score': quality,
                'face_box':     result['face_box'],
                'index':        idx,
            })

        except Exception as e:
            current_app.logger.error(f'Face registration error image {idx}: {e}')
            rejected.append(f'{label}: unexpected error — {e}')

    if not candidates:
        return jsonify({
            'success': False,
            'message': 'No usable face found in any image. See errors for details.',
            'saved':   0,
            'errors':  rejected,
            'details': [],
        }), 400

    # ── Step 2: Select the single best image ────────────────────────────────
    best = select_best_image(candidates)

    # ── Step 3: Clear old encodings for this user (clean re-registration) ───
    FaceEncoding.query.filter_by(user_id=user_id).delete()
    db.session.flush()

    # ── Step 4: Save the best encoding to DB ────────────────────────────────
    enc_obj = FaceEncoding(user_id=user_id)
    enc_obj.set_encoding(best['encoding'])
    enc_obj.quality_score = best['quality_score']

    # Save {user_id}.jpg as the canonical face image
    img_path = _save_best_face_image(user_id, best['b64'])
    enc_obj.image_path = img_path

    # Also update user.image_path so the profile header shows the face photo
    user.image_path = img_path

    db.session.add(enc_obj)
    db.session.commit()

    # ── Step 5: Replace cache entry with best encoding ───────────────────────
    engine.add_to_cache(user_id, user.name, best['encoding'])

    return jsonify({
        'success': True,
        'message': (
            f'Best face selected from {len(candidates)} candidate(s) '
            f'(quality {round(best["quality_score"] * 100)}%). '
            f'{len(rejected)} image(s) skipped.'
        ),
        'saved':   1,
        'errors':  rejected,
        'details': [{
            'index':         best['index'],
            'success':       True,
            'quality_score': best['quality_score'],
            'message':       f'Selected as best (score {round(best["quality_score"] * 100)}%)',
        }],
    }), 200


@face_bp.route('/face/delete/<int:user_id>', methods=['DELETE'])
@jwt_required()
@require_role('admin')
def delete_face_encodings(user_id):
    """Delete all face encodings for a user."""
    deleted = FaceEncoding.query.filter_by(user_id=user_id).delete()
    db.session.commit()
    FaceEngine.get_instance().remove_from_cache(user_id)
    return jsonify({
        'success': True,
        'message': f'{deleted} face encoding(s) deleted',
    }), 200


@face_bp.route('/face/status/<int:user_id>', methods=['GET'])
@jwt_required()
@require_role('admin', 'hr')
def face_status(user_id):
    """Return how many face encodings a user has."""
    count = FaceEncoding.query.filter_by(user_id=user_id).count()
    return jsonify({
        'success':      True,
        'user_id':      user_id,
        'face_count':   count,
        'is_registered': count > 0,
    }), 200


# ── Recognition ───────────────────────────────────────────────────────────────

@face_bp.route('/face/recognize', methods=['POST'])
@jwt_required()
@require_role('admin', 'hr')
def recognize_face():
    """
    Recognize faces in an image and optionally mark attendance.

    Body:
        {
            "image":           base64_string,
            "session_id":      int | null,
            "mark_attendance": bool   (default true)
        }

    Returns:
        {
            "success": true,
            "faces": [
                {
                    "user_id":           int | null,
                    "name":              str,
                    "box":               {top, right, bottom, left},
                    "confidence":        float (0-100),
                    "confidence_label":  "High" | "Medium" | "Low",
                    "distance":          float,
                    "matched":           bool,
                    "attendance_marked": bool
                },
                ...
            ]
        }
    """
    data        = request.get_json() or {}
    image_data  = data.get('image')
    session_id  = data.get('session_id')
    should_mark = data.get('mark_attendance', True)

    if not image_data:
        return jsonify({'success': False, 'message': 'image is required'}), 400

    engine = FaceEngine.get_instance()
    if not engine.available:
        return jsonify({
            'success': False,
            'message': 'face_recognition not installed. Run setup.bat.',
            'faces':   [],
        }), 503

    tolerance   = float(SystemConfig.get('recognition_tolerance', '0.50'))
    model       = SystemConfig.get('face_detection_model', 'hog')
    save_unknown = SystemConfig.get('save_unknown_faces', 'true').lower() == 'true'

    results = engine.recognize(image_data, tolerance=tolerance, model=model)
    output  = []

    for face in results:
        confidence       = round((1 - face['distance']) * 100, 1)
        confidence_label = ('High' if confidence >= 85 else 'Medium' if confidence >= 65 else 'Low')

        face_out = {
            **face,
            'confidence':        confidence,
            'confidence_label':  confidence_label,
            'attendance_marked': False,
        }

        if face['matched'] and should_mark:
            marked = _try_mark_attendance(face['user_id'], session_id)
            face_out['attendance_marked'] = marked

        elif not face['matched'] and save_unknown:
            _save_unknown_face(image_data, face.get('distance', 1.0))

        output.append(face_out)

    return jsonify({'success': True, 'faces': output, 'total': len(output)}), 200


# ── Liveness ──────────────────────────────────────────────────────────────────

@face_bp.route('/face/liveness', methods=['POST'])
@jwt_required()
def liveness_check():
    """
    Check liveness on a single frame.
    Body: {image: base64, session_data: {blink_count, consec_closed}}
    """
    data            = request.get_json() or {}
    image_data      = data.get('image')
    session_data    = data.get('session_data', {})
    required_blinks = int(SystemConfig.get('liveness_blink_count', '2'))

    if not image_data:
        return jsonify({'success': False, 'message': 'image is required'}), 400

    engine    = FaceEngine.get_instance()
    image_rgb = engine.decode_image(image_data)
    if image_rgb is None:
        return jsonify({'success': False, 'message': 'Image decode failed'}), 400

    from face_engine.liveness import check_liveness_frame
    result = check_liveness_frame(image_rgb, session_data, required_blinks=required_blinks)
    result['session_data'] = session_data

    return jsonify({'success': True, **result}), 200


# ── Cache management ──────────────────────────────────────────────────────────

@face_bp.route('/face/cache/reload', methods=['POST'])
@jwt_required()
@require_role('admin')
def reload_cache():
    """Force reload the in-memory face encoding cache from DB."""
    engine = FaceEngine.get_instance()
    engine.load_from_db()
    return jsonify({
        'success':    True,
        'message':    'Cache reloaded.',
        'cache_size': engine.cache_size(),
    }), 200


# ── Internal helpers ──────────────────────────────────────────────────────────

def _try_mark_attendance(user_id: int, session_id) -> bool:
    from datetime import timedelta
    cooldown = int(SystemConfig.get('attendance_cooldown_minutes', '10'))

    session_obj = None
    if session_id:
        session_obj = SessionModel.query.get(session_id)

    # Cooldown check
    since = datetime.utcnow() - timedelta(minutes=cooldown)
    query = Attendance.query.filter(
        Attendance.user_id   == user_id,
        Attendance.timestamp >= since,
    )
    if session_id:
        query = query.filter(Attendance.session_id == session_id)
    if query.first():
        return False  # Already marked within cooldown window

    # Same-session single-mark check
    if session_obj and not session_obj.allow_multiple:
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        existing = Attendance.query.filter(
            Attendance.user_id   == user_id,
            Attendance.session_id == session_id,
            Attendance.timestamp >= today_start,
        ).first()
        if existing:
            return False

    record = Attendance(user_id=user_id, session_id=session_id, status='present')
    db.session.add(record)
    db.session.commit()
    return True


def _save_best_face_image(user_id: int, b64_string: str) -> str | None:
    """
    Save the best face image as storage/known_faces/{user_id}.jpg.
    Returns relative path 'known_faces/{user_id}.jpg' or None on failure.
    Overwrites any previous image for this user.
    """
    try:
        known_dir = current_app.config['KNOWN_FACES_DIR']
        os.makedirs(known_dir, exist_ok=True)

        if ',' in b64_string:
            b64_string = b64_string.split(',', 1)[1]

        image_bytes = base64.b64decode(b64_string)
        filename    = f'{user_id}.jpg'
        filepath    = os.path.join(known_dir, filename)

        with open(filepath, 'wb') as f:
            f.write(image_bytes)

        return f'known_faces/{filename}'
    except Exception as e:
        current_app.logger.error(f'Save best face image error: {e}')
        return None


MAX_UNKNOWN_FACES = 20  # Keep only the N most recent unknown face snapshots


def _save_unknown_face(image_data: str, distance: float):
    """Save unknown face snapshot; keep at most MAX_UNKNOWN_FACES records."""
    try:
        unk_dir = current_app.config['UNKNOWN_FACES_DIR']
        os.makedirs(unk_dir, exist_ok=True)

        if ',' in image_data:
            image_data = image_data.split(',', 1)[1]

        image_bytes = base64.b64decode(image_data)
        filename    = f'unknown_{int(datetime.utcnow().timestamp())}.jpg'
        filepath    = os.path.join(unk_dir, filename)

        with open(filepath, 'wb') as f:
            f.write(image_bytes)

        record = UnknownFace(
            image_path=f'unknown_faces/{filename}',
            confidence_score=distance,
        )
        db.session.add(record)
        db.session.flush()  # get the new record an id before we count

        # ── Enforce cap: delete oldest records beyond the limit ────────────
        total = UnknownFace.query.count()
        if total > MAX_UNKNOWN_FACES:
            excess = (
                UnknownFace.query
                .order_by(UnknownFace.captured_at.asc())
                .limit(total - MAX_UNKNOWN_FACES)
                .all()
            )
            for old in excess:
                try:
                    old_path = os.path.join(
                        current_app.config['UNKNOWN_FACES_DIR'],
                        os.path.basename(old.image_path),
                    )
                    if os.path.exists(old_path):
                        os.remove(old_path)
                except Exception:
                    pass
                db.session.delete(old)

        db.session.commit()
    except Exception as e:
        current_app.logger.error(f'Save unknown face error: {e}')
