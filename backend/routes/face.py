import os
import io
import base64
import logging
import numpy as np
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required

from database import db
from models.face_encoding import FaceEncoding
from models.user import User
from models.unknown_face import UnknownFace, SystemConfig
from services.attendance_service import mark_attendance_once
from services.face_service import recognize_and_validate
from utils.auth_helpers import require_role, require_auth, get_current_user
from face_engine.engine_factory import (
    get_engine, engine_info as _engine_info, reset_engine,
    compare_encodings as _engine_compare,
)

face_bp = Blueprint('face', __name__)
logger  = logging.getLogger(__name__)

# In-memory per-day deduplication cache. PostgreSQL and attendance_service still
# enforce correctness, this just avoids repeated DB writes during live scanning.
_session_marked_cache = set()
_session_marked_day = None


def _attendance_cache_key(user_id, session_id):
    global _session_marked_day
    today = datetime.now().date()
    if _session_marked_day != today:
        _session_marked_cache.clear()
        _session_marked_day = today
    if session_id is not None and str(session_id).strip() not in ('', '0', 'null', 'None'):
        session_id = int(session_id)
    else:
        session_id = None
    return int(user_id), session_id, today


# ── Registration ──────────────────────────────────────────────────────────────

@face_bp.route('/face/register', methods=['POST'])
@jwt_required()
@require_auth
def register_face():
    """
    Register face encodings for a student/user.

    Body:
        {
            "user_id": int,
            "images":  [base64_string, ...]   # 1–10 photos recommended
        }
    """
    data    = request.get_json() or {}
    user_id = int(data.get('user_id')) if data.get('user_id') is not None else None
    images  = data.get('images', [])

    if not user_id or not images:
        return jsonify({'success': False, 'message': 'user_id and images are required'}), 400

    current = get_current_user()
    if current.role == 'student' and current.id != user_id:
        return jsonify({'success': False, 'message': 'Access denied'}), 403

    user   = User.query.get_or_404(user_id)
    engine = get_engine()

    if not engine.available:
        return jsonify({
            'success': False,
            'message': (
                'Face recognition library is not installed.\n'
                'Run setup.bat to install all dependencies.'
            )
        }), 503

    # Pull config settings
    register_model = SystemConfig.get('face_register_model', 'hog')
    min_face_size  = int(SystemConfig.get('min_face_size_px', '50'))

    from face_engine.encoder import (
        score_image_quality, select_best_image, normalize_face_box
    )

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
                num_jitters=3,
            )

            if not result['success']:
                rejected.append(f'{label}: {result["message"]}')
                continue

            norm_box = normalize_face_box(result.get('face_box'))
            quality  = score_image_quality(image_rgb, norm_box) if norm_box else 0.5

            candidates.append({
                'image_rgb':     image_rgb,
                'b64':           img_b64,
                'encoding':      result['encoding'],
                'quality_score': quality,
                'face_box':      result.get('face_box'),
                'index':         idx,
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

    # ── Step 1.4: Duplicate Face Prevention Check ──
    if candidates and engine.cache_size() > 0:
        register_tolerance = float(SystemConfig.get('arcface_tolerance', '0.45'))
        for cand in candidates[:3]:
            matches = engine.find_matches(cand['encoding'], tolerance=register_tolerance, top_k=3)
            for m in matches:
                matched_user_id = m.get('user_id')
                if matched_user_id and str(matched_user_id) != 'Unknown' and int(matched_user_id) != user.id:
                    existing_m_user = User.query.get(int(matched_user_id))
                    if existing_m_user:
                        logger.warning(f"[Register] Duplicate face blocked: candidate matches existing user {existing_m_user.name} (id={existing_m_user.id})")
                        return jsonify({
                            'success': False,
                            'already_registered': True,
                            'existing_user': existing_m_user.to_dict(),
                            'message': f'Already Registered: Face matches existing user "{existing_m_user.name}" (ID: {existing_m_user.student_id or existing_m_user.id}, Email: {existing_m_user.email}). Duplicate account registration is prohibited.'
                        }), 409

    # ── Step 1.5: Enforce Liveness Check (EAR Variance) ──
    liveness_enabled = SystemConfig.get('liveness_enabled', 'false').lower() == 'true'
    if liveness_enabled and len(candidates) >= 2:
        from face_engine.liveness import get_eye_aspect_ratio_from_image
        ears = []
        for c in candidates:
            norm_box = normalize_face_box(c['face_box'])
            ear = get_eye_aspect_ratio_from_image(c['image_rgb'], norm_box)
            if ear is not None:
                ears.append(ear)
        if len(ears) >= 2:
            ear_var = float(np.var(ears))
            logger.info(f"[Register] EAR values: {ears}, variance: {ear_var}")
            if ear_var < 0.0001:  # Threshold for static image (same eyes in all pictures)
                return jsonify({
                    'success': False,
                    'message': 'Liveness check failed: Static photo detected. Please blink or move your face slightly during capture.'
                }), 400


    # ── Step 2: Select the best profile image ───────────────────────────────
    best        = select_best_image(candidates)
    avg_quality = round(sum(c['quality_score'] for c in candidates) / len(candidates), 3)

    logger.info(
        f'[Register] user_id={user_id} candidates={len(candidates)} '
        f'rejected={len(rejected)} avg_quality={avg_quality} best_idx={best["index"]}'
    )

    # Save the best image as profile picture
    try:
        from routes.users import _save_profile_image
        _save_profile_image(user, best['b64'])
    except Exception as e:
        logger.error(f'Failed to save best face as profile picture: {e}')

    # ── Step 3: Implement Quality-based Encoding Selection ──
    existing_records = FaceEncoding.query.filter_by(user_id=user_id).all()
    all_items = []
    
    # Add existing database records to the pool
    for r in existing_records:
        try:
            enc = r.get_encoding()
            all_items.append({
                'quality_score': r.quality_score or 0.5,
                'encoding': enc,
                'record': r,
                'is_new': False
            })
        except Exception as r_err:
            logger.warning(f'Failed to parse existing encoding {r.id}: {r_err}')

    # Add new candidate records to the pool
    for c in candidates:
        all_items.append({
            'quality_score': c['quality_score'],
            'encoding': c['encoding'],
            'record': None,
            'is_new': True
        })

    # Sort all items by quality score descending
    all_items.sort(key=lambda x: x['quality_score'], reverse=True)

    # Deduplicate and pick up to MAX_ENCODINGS_PER_USER
    saved_items = []
    dedup_threshold = 0.40  # dlib Euclidean / ArcFace cosine

    for item in all_items:
        if len(saved_items) >= engine.MAX_ENCODINGS_PER_USER:
            break
        # Check similarity against already saved items in this selection
        already = [np.array(x['encoding']) for x in saved_items]
        if already:
            dists = _engine_compare(already, item['encoding'])
            if len(dists) > 0 and float(np.min(dists)) < dedup_threshold:
                # Too similar — discard the lower-quality copy
                continue
        saved_items.append(item)

    # Deletions: records present in DB but not kept in saved_items
    kept_record_ids = {x['record'].id for x in saved_items if x['record'] is not None}
    for r in existing_records:
        if r.id not in kept_record_ids:
            db.session.delete(r)

    # Inserts & Reloads
    saved_encodings = []
    for x in saved_items:
        if x['is_new']:
            enc_rec = FaceEncoding(user_id=user_id)
            enc_rec.set_encoding(x['encoding'])
            enc_rec.quality_score = x['quality_score']
            enc_rec.encoding_type = 'individual'
            enc_rec.source_count  = 1
            db.session.add(enc_rec)
            saved_encodings.append(x['encoding'])
        else:
            saved_encodings.append(x['encoding'])

    db.session.commit()

    # ── Step 5: Reload this user's cache from all stored encodings ───────────
    engine.remove_from_cache(user_id)
    if saved_encodings:
        engine.add_to_cache(user_id, user.name, saved_encodings[0])
        if len(saved_encodings) > 1:
            engine.add_encodings_to_cache(user_id, user.name,
                                          [np.array(e) for e in saved_encodings[1:]])

    return jsonify({
        'success': True,
        'message': (
            f'{len(saved_items)} encoding(s) kept/registered. '
            f'Added {len([x for x in saved_items if x["is_new"]])} new scan(s). '
            f'{len(rejected)} image(s) skipped.'
        ),
        'saved':         len(saved_items),
        'encoding_type': 'multi-individual',
        'source_count':  len(candidates),
        'errors':        rejected,
    }), 200


@face_bp.route('/face/train-dataset/<int:user_id>', methods=['POST'])
@jwt_required()
@require_role('admin', 'hr')
def train_dataset(user_id):
    """
    Augment a user's face recognition model with additional images or a ZIP
    dataset — WITHOUT wiping existing encodings.
    """
    user   = User.query.get_or_404(user_id)
    engine = get_engine()

    if not engine.available:
        return jsonify({'success': False, 'message': 'face_recognition library not installed.'}), 503

    register_model = SystemConfig.get('face_register_model', 'hog')
    min_face_size  = int(SystemConfig.get('min_face_size_px', '50'))

    # ── Collect images from multipart or JSON ────────────────────────────────
    raw_images = []

    if request.content_type and 'multipart' in request.content_type:
        for f in request.files.getlist('images'):
            try:
                raw_images.append(('file', f.read(), f.filename))
            except Exception:
                pass
        for f in request.files.getlist('zip'):
            try:
                raw_images.extend(_extract_zip_images(f))
            except Exception as ze:
                logger.warning(f'ZIP extract error: {ze}')
    else:
        data   = request.get_json() or {}
        for img_b64 in data.get('images', []):
            raw_images.append(('b64', img_b64, 'unknown'))

    if not raw_images:
        return jsonify({'success': False, 'message': 'No images provided.'}), 400

    # ── Load existing encodings for dedup comparison ─────────────────────────
    from face_engine.encoder import score_image_quality, normalize_face_box

    existing_db = FaceEncoding.query.filter_by(user_id=user_id).all()
    existing_encodings = []
    for e in existing_db:
        try:
            existing_encodings.append(np.array(e.get_encoding()))
        except Exception:
            pass

    max_total = engine.MAX_ENCODINGS_PER_USER
    current   = len(existing_db)
    slots     = max(0, max_total - current)

    if slots == 0:
        return jsonify({
            'success': False,
            'message': f'User already has {current}/{max_total} encodings. '
                       f'Re-register to reset, then upload a new dataset.',
            'current': current,
            'maximum': max_total,
        }), 400

    # ── Process each image ───────────────────────────────────────────────────
    dedup_threshold = 0.42

    accepted  = []
    rejected  = []
    new_encs  = []

    for src_type, raw, label in raw_images:
        if len(accepted) >= slots:
            rejected.append(f'{label}: slot cap reached ({max_total} max)')
            continue
        try:
            if src_type == 'b64':
                image_rgb = engine.decode_image(raw)
            else:
                import cv2
                nparr     = np.frombuffer(raw, np.uint8)
                img_bgr   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                image_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB) if img_bgr is not None else None

            if image_rgb is None:
                rejected.append(f'{label}: decode failed')
                continue

            result = engine.encode_face_for_registration(
                image_rgb,
                model=register_model,
                min_face_size=min_face_size,
                num_jitters=2,
            )

            if not result['success']:
                rejected.append(f'{label}: {result["message"]}')
                continue

            enc_arr  = result['encoding']
            norm_box = normalize_face_box(result.get('face_box'))
            quality  = score_image_quality(image_rgb, norm_box) if norm_box else 0.5

            # BUG FIX #5: Use engine-agnostic compare_encodings
            all_known = existing_encodings + [np.array(e) for e in new_encs]
            if all_known:
                dists    = _engine_compare(all_known, enc_arr)
                if len(dists) > 0:
                    min_dist = float(np.min(dists))
                    if min_dist < dedup_threshold:
                        rejected.append(f'{label}: duplicate (dist {round(min_dist, 3)} < {dedup_threshold})')
                        continue

            enc_rec = FaceEncoding(user_id=user_id)
            enc_rec.set_encoding(enc_arr)
            enc_rec.quality_score = quality
            enc_rec.encoding_type = 'dataset'
            enc_rec.source_count  = 1
            db.session.add(enc_rec)
            new_encs.append(enc_arr)
            accepted.append({'label': label, 'quality': round(quality * 100)})

        except Exception as e:
            logger.error(f'[Dataset] Error processing {label}: {e}')
            rejected.append(f'{label}: error — {e}')

    if accepted:
        db.session.commit()
        added = engine.add_encodings_to_cache(
            user_id, user.name, [np.array(e) for e in new_encs]
        )
        logger.info(
            f'[Dataset] user_id={user_id} accepted={len(accepted)} '
            f'rejected={len(rejected)} cache_added={added}'
        )
    else:
        db.session.rollback()

    total_now = FaceEncoding.query.filter_by(user_id=user_id).count()

    return jsonify({
        'success':    len(accepted) > 0,
        'message':    (
            f'{len(accepted)} new encoding(s) added. '
            f'{len(rejected)} image(s) skipped. '
            f'User now has {total_now}/{max_total} encodings.'
        ),
        'added':      len(accepted),
        'rejected':   len(rejected),
        'total_encodings': total_now,
        'maximum':    max_total,
        'accepted_details': accepted[:10],
        'rejected_details': rejected[:20],
    }), 200


@face_bp.route('/face/encodings/<int:user_id>', methods=['GET'])
@jwt_required()
@require_auth
def get_encodings_info(user_id):
    """Return encoding count, type breakdown, and quality stats for a user."""
    current = get_current_user()
    if current.role == 'student' and current.id != user_id:
        return jsonify({'success': False, 'message': 'Access denied'}), 403

    User.query.get_or_404(user_id)
    encs = FaceEncoding.query.filter_by(user_id=user_id).order_by(
        FaceEncoding.quality_score.desc()
    ).all()

    quality_scores = [e.quality_score for e in encs if e.quality_score is not None]
    engine = get_engine()
    engine_name = engine.__class__.__name__
    embedding_dim = 512 if 'ArcFace' in engine_name else 128

    return jsonify({
        'success': True,
        'user_id': user_id,
        'total': len(encs),
        'maximum': engine.MAX_ENCODINGS_PER_USER,
        'slots_remaining': max(0, engine.MAX_ENCODINGS_PER_USER - len(encs)),
        'avg_quality': round(sum(quality_scores) / len(quality_scores) * 100) if quality_scores else 0,
        'min_quality': round(min(quality_scores) * 100) if quality_scores else 0,
        'max_quality': round(max(quality_scores) * 100) if quality_scores else 0,
        'embedding_dim': embedding_dim,
        'type_breakdown': {
            'individual': sum(1 for e in encs if e.encoding_type == 'individual'),
            'dataset':    sum(1 for e in encs if e.encoding_type == 'dataset'),
            'merged':     sum(1 for e in encs if e.encoding_type in ('merged', 'single', None)),
        },
        'encodings': [e.to_dict() for e in encs],
    }), 200


def _extract_zip_images(zip_file) -> list:
    """Extract image bytes from an uploaded ZIP file."""
    import zipfile
    results = []
    with zipfile.ZipFile(io.BytesIO(zip_file.read())) as zf:
        for name in zf.namelist():
            if name.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.webp')):
                try:
                    data = zf.read(name)
                    results.append(('file', data, name))
                except Exception:
                    pass
    return results


@face_bp.route('/face/delete/<int:user_id>', methods=['DELETE'])
@jwt_required()
@require_role('admin')
def delete_face_encodings(user_id):
    """Delete all face encodings for a user."""
    deleted = FaceEncoding.query.filter_by(user_id=user_id).delete()
    db.session.commit()
    get_engine().remove_from_cache(user_id)
    return jsonify({
        'success': True,
        'message': f'{deleted} face encoding(s) deleted',
    }), 200


@face_bp.route('/face/status/<int:user_id>', methods=['GET'])
@jwt_required()
@require_auth
def face_status(user_id):
    """Return how many face encodings a user has."""
    current = get_current_user()
    if current.role == 'student' and current.id != user_id:
        return jsonify({'success': False, 'message': 'Access denied'}), 403
    enc   = FaceEncoding.query.filter_by(user_id=user_id).first()
    count = FaceEncoding.query.filter_by(user_id=user_id).count()
    engine = get_engine()
    engine_name   = engine.__class__.__name__
    embedding_dim = 512 if 'ArcFace' in engine_name else 128
    return jsonify({
        'success':        True,
        'user_id':        user_id,
        'face_count':     count,
        'is_registered':  count > 0,
        'encoding_type':  enc.encoding_type if enc else None,
        'source_count':   enc.source_count  if enc else 0,
        'quality_score':  enc.quality_score if enc else None,
        'embedding_dim':  embedding_dim,
        'engine':         engine_name,
    }), 200


@face_bp.route('/face/engine-info', methods=['GET'])
@jwt_required()
def face_engine_info():
    """Return which recognition engine is active and its accuracy metrics."""
    info = _engine_info()

    try:
        from face_engine.arcface_engine import ARCFACE_AVAILABLE, arcface_ready
        info['arcface_installed'] = ARCFACE_AVAILABLE
        info['arcface_ready']     = arcface_ready()
    except Exception:
        info['arcface_installed'] = False
        info['arcface_ready']     = False

    try:
        from face_engine.encoder import FACE_RECOGNITION_AVAILABLE
        info['dlib_available'] = FACE_RECOGNITION_AVAILABLE
    except Exception:
        info['dlib_available'] = False

    return jsonify({'success': True, **info}), 200


@face_bp.route('/face/engine/set', methods=['POST'])
@jwt_required()
@require_role('admin')
def set_engine_backend():
    """Switch face recognition backend: arcface | dlib | auto"""
    data    = request.get_json() or {}
    backend = data.get('backend', 'auto').strip().lower()
    if backend not in ('arcface', 'dlib', 'auto'):
        return jsonify({'success': False, 'message': 'backend must be arcface | dlib | auto'}), 400

    SystemConfig.set('face_engine_backend', backend)
    reset_engine()

    try:
        eng = get_engine()
        eng.load_from_db()
        cache_sz = eng.cache_size()
    except Exception as e:
        return jsonify({'success': False, 'message': f'Engine switch failed: {e}'}), 500

    return jsonify({
        'success':     True,
        'message':     f'Engine set to {backend}. Cache reloaded ({cache_sz} user(s)).',
        'backend':     backend,
        'engine_info': _engine_info(),
    }), 200


@face_bp.route('/face/engine/setup', methods=['POST'])
@jwt_required()
@require_role('admin')
def setup_arcface():
    """Trigger ArcFace model download + initialisation."""
    try:
        from face_engine.arcface_engine import ARCFACE_AVAILABLE
        if not ARCFACE_AVAILABLE:
            return jsonify({
                'success': False,
                'message': 'InsightFace package not installed. Run: pip install insightface onnxruntime-gpu',
            }), 503

        from insightface.app import FaceAnalysis
        model_name = current_app.config.get('INSIGHTFACE_MODEL', 'buffalo_s')
        det_size = current_app.config.get('INSIGHTFACE_DET_SIZE', 320)
        app = FaceAnalysis(name=model_name, providers=['CPUExecutionProvider'])
        app.prepare(ctx_id=-1, det_size=(det_size, det_size))

        from face_engine.arcface_engine import ArcFaceEngine
        ArcFaceEngine._instance = None
        reset_engine()

        return jsonify({
            'success': True,
            'message': f'ArcFace {model_name} model loaded successfully. Switch backend to arcface to activate.',
        }), 200
    except Exception as e:
        logger.error(f'[ArcFace Setup] {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


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
    """
    data        = request.get_json() or {}
    image_data  = data.get('image')
    _raw_sid   = data.get('session_id')
    session_id = int(_raw_sid) if _raw_sid and str(_raw_sid).strip() not in ('', '0', 'null') else None
    should_mark = data.get('mark_attendance', True)
    scanner_id  = data.get('scanner_id') or request.remote_addr or 'default'

    if not image_data:
        return jsonify({'success': False, 'message': 'image is required'}), 400

    engine = get_engine()
    if not engine.available:
        return jsonify({
            'success': False,
            'message': 'Face engine not available. Run setup.bat and verify InsightFace/ONNX Runtime installation.',
            'faces':   [],
        }), 503

    tolerance = float(
        SystemConfig.get('arcface_tolerance', '0.48')
        if getattr(engine, 'backend', 'dlib') == 'arcface'
        else SystemConfig.get('recognition_tolerance', '0.50')
    )
    model        = SystemConfig.get('face_detection_model', 'hog')
    save_unknown = SystemConfig.get('save_unknown_faces', 'true').lower() == 'true'
    min_face_size = int(SystemConfig.get('min_face_size_px', '50'))

    try:
        results = recognize_and_validate(
            image_data,
            engine,
            tolerance=tolerance,
            model=model,
            scanner_id=scanner_id,
            min_face_size=min_face_size,
        )
    except Exception as e:
        import traceback as _tb
        logger.error(f'[Recognize] Engine error: {e}\n{_tb.format_exc()}')
        return jsonify({'success': False, 'message': f'Recognition error: {e}', 'faces': []}), 500

    output = []

    from face_engine.liveness import evaluate_real_human_liveness
    image_rgb_decoded = engine.decode_image(image_data) if hasattr(engine, 'decode_image') else None

    # Step 1: Per-Face Liveness Evaluation & Filtering
    evaluated_faces = []
    seen_matched_user_ids = set()

    for face in results:
        dist_val = float(face.get('distance', 1.0)) if face.get('distance') is not None else 1.0
        confidence = round((1.0 - dist_val) * 100, 1)
        confidence_label = ('High' if confidence >= 85 else 'Medium' if confidence >= 65 else 'Low')

        # Honor stateful liveness result from tracker pipeline
        is_spoof = bool(face.get('is_spoof', False))
        liveness_passed = bool(face.get('liveness_passed', False)) and not is_spoof
        liveness_reason = face.get('liveness_reason', 'Spoof Attack Blocked' if is_spoof else 'Real human verified')

        # Only allow matching and attendance when liveness is explicitly PASSED (LIVE_VERIFIED)
        if is_spoof or not liveness_passed:
            matched = False
            rec_confirmed = False
            user_id = 'Unknown'
            user_name = 'Unknown'
        else:
            user_id = face.get('user_id', 'Unknown')
            matched = face.get('matched', False) and user_id != 'Unknown'
            rec_confirmed = face.get('recognition_confirmed', False) and matched
            user_name = face.get('name', 'Unknown')

            # Deduplicate: Only allow primary live face per user per frame
            if matched:
                if user_id in seen_matched_user_ids:
                    rec_confirmed = False
                    matched = False
                    user_id = 'Unknown'
                    user_name = 'Unknown'
                else:
                    seen_matched_user_ids.add(user_id)

        face_out = {
            **face,
            'user_id':           user_id,
            'name':              user_name,
            'matched':           matched,
            'recognition_confirmed': rec_confirmed,
            'confidence':        confidence,
            'confidence_label':  confidence_label,
            'attendance_marked': False,
            'liveness_passed':   liveness_passed,
            'is_spoof':          is_spoof,
            'liveness_score':    face.get('liveness_score', 0.05 if is_spoof else 0.95),
            'liveness_reason':   liveness_reason,
            'diagnostics':       face.get('diagnostics', {})
        }

        # Fetch additional user details (student_id, photo)
        if matched and user_id != 'Unknown':
            from models.user import User
            try:
                u = User.query.get(int(user_id))
                if u:
                    face_out['student_id'] = u.student_id
                    face_out['photo_url'] = u.image_path
                    face_out['target_hours'] = u.weekly_target_hours or 40.0
            except Exception:
                pass

        face_encoding = face_out.pop('_embedding', None)

        if matched and rec_confirmed and should_mark:
            try:
                mark_result = mark_attendance_once(user_id, session_id, status='present', note='Face Scanner IN/OUT')
                face_out['attendance_marked'] = mark_result['marked']
                face_out['attendance_status'] = mark_result['reason']
                face_out['punch_type'] = mark_result.get('punch_type', 'IN')
                face_out['message'] = mark_result.get('message', '')
                
                att = mark_result.get('attendance')
                if att:
                    face_out['in_time'] = att.timestamp.isoformat() if att.timestamp else None
                    face_out['out_time'] = att.punch_out.isoformat() if att.punch_out else None
                    
                logger.info(
                    f'[Attendance] user_id={user_id} '
                    f'distance={round(dist_val, 4)} '
                    f'confidence={confidence}% '
                    f'marked={mark_result["marked"]} '
                    f'punch_type={mark_result.get("punch_type","?")} '
                    f'reason={mark_result["reason"]}'
                )
            except Exception as mark_err:
                logger.error(f'[Attendance] mark failed for user_id={user_id}: {mark_err}')
                face_out['attendance_marked'] = False
        elif not matched and not is_spoof and face_encoding is not None and save_unknown:
            _save_unknown_face(image_data, engine, dist_val, face_encoding)

        output.append(face_out)

    return jsonify({'success': True, 'faces': output, 'total': len(output)}), 200






# ── Verify endpoint (single-user identity check) ──────────────────────────────

@face_bp.route('/face/verify', methods=['POST'])
@jwt_required()
@require_role('admin', 'hr')
def verify_face():
    """
    Check if a single face image matches a specific registered user.
    Useful for spot-checking recognition confidence before attendance marking.

    Body:
        {
            "image":   base64_string,
            "user_id": int
        }

    Returns:
        {
            "success":    bool,
            "matched":    bool,
            "confidence": float (0–100),
            "distance":   float,
            "engine":     str
        }
    """
    data    = request.get_json() or {}
    image_data = data.get('image')
    user_id    = data.get('user_id')

    if not image_data or not user_id:
        return jsonify({'success': False, 'message': 'image and user_id are required'}), 400

    user = User.query.get_or_404(user_id)
    engine = get_engine()

    if not engine.available:
        return jsonify({'success': False, 'message': 'Face engine not available'}), 503

    # Load this user's encodings
    encs = FaceEncoding.query.filter_by(user_id=user_id).all()
    if not encs:
        return jsonify({
            'success': False,
            'message': f'{user.name} has no registered face data.',
            'matched': False,
        }), 200

    known = []
    for e in encs:
        try:
            known.append(np.array(e.get_encoding()))
        except Exception:
            pass

    if not known:
        return jsonify({'success': False, 'message': 'Could not load face encodings', 'matched': False}), 200

    # Decode probe image
    image_rgb = engine.decode_image(image_data)
    if image_rgb is None:
        return jsonify({'success': False, 'message': 'Image decode failed', 'matched': False}), 400

    result = engine.encode_face_for_registration(image_rgb, num_jitters=1)
    if not result.get('success'):
        return jsonify({
            'success': False,
            'message': result.get('message', 'No face detected'),
            'matched': False,
        }), 200

    probe = np.array(result['encoding'])
    dists = _engine_compare(known, probe)

    if len(dists) == 0:
        return jsonify({'success': False, 'message': 'Comparison failed', 'matched': False}), 200

    best_dist  = float(np.min(dists))
    tolerance  = float(
        SystemConfig.get('arcface_tolerance', '0.40')
        if getattr(engine, 'backend', 'dlib') == 'arcface'
        else SystemConfig.get('recognition_tolerance', '0.50')
    )
    matched    = best_dist <= tolerance
    confidence = round((1 - best_dist) * 100, 1)
    engine_name = engine.__class__.__name__

    return jsonify({
        'success':    True,
        'matched':    matched,
        'confidence': confidence,
        'distance':   round(best_dist, 4),
        'tolerance':  tolerance,
        'engine':     engine_name,
        'user_id':    user_id,
        'user_name':  user.name,
    }), 200


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

    engine    = get_engine()
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
    engine = get_engine()
    engine.load_from_db()
    return jsonify({
        'success':    True,
        'message':    'Cache reloaded.',
        'cache_size': engine.cache_size(),
    }), 200


# ── Internal helpers ──────────────────────────────────────────────────────────

# In-memory LRU cache of recent unknown face encodings for dedup
_DEDUP_WINDOW = 50
_recent_unknown_encodings: list = []

def _save_unknown_face(image_data: str, engine, distance: float, face_encoding=None):
    """
    Deduplicates and durably saves a new unknown face.
    Avoids saving duplicate pictures of the same unknown person.
    """
    if face_encoding is None:
        return None

    import uuid
    # Convert face_encoding to a numpy array for calculation
    probe = np.array(face_encoding, dtype=np.float32)

    # 1. Check the in-memory LRU cache first (very fast)
    global _recent_unknown_encodings
    tolerance = float(
        SystemConfig.get('arcface_tolerance', '0.40')
        if getattr(engine, 'backend', 'dlib') == 'arcface'
        else SystemConfig.get('recognition_tolerance', '0.50')
    )
    # Deduplication threshold uses the active engine tolerance
    dedup_threshold = tolerance

    if _recent_unknown_encodings:
        dists = engine.compare_encodings(_recent_unknown_encodings, probe)
        if len(dists) > 0 and float(np.min(dists)) <= dedup_threshold:
            # Already captured in recent frames — skip
            return None

    # 2. Check the database to make it durable across server restarts (last 100 entries)
    try:
        recent_db_records = UnknownFace.query.order_by(UnknownFace.captured_at.desc()).limit(100).all()
        db_encodings = []
        for rec in recent_db_records:
            enc = rec.get_encoding()
            if enc is not None:
                db_encodings.append(np.array(enc, dtype=np.float32))

        if db_encodings:
            dists = engine.compare_encodings(db_encodings, probe)
            if len(dists) > 0 and float(np.min(dists)) <= dedup_threshold:
                # Already captured in database — skip, but add to in-memory cache to speed up subsequent frames
                _recent_unknown_encodings.append(probe)
                if len(_recent_unknown_encodings) > _DEDUP_WINDOW:
                    _recent_unknown_encodings.pop(0)
                return None
    except Exception as exc:
        logger.warning(f"[UnknownFace] Database dedup check skipped: {exc}")

    # 3. New unique unknown face! Decode, save to disk, and record in DB
    filename = f"{uuid.uuid4()}.jpg"
    filepath = os.path.join(current_app.config['UNKNOWN_FACES_DIR'], filename)

    try:
        # Decode base64 image data
        if image_data.startswith('data:'):
            image_data = image_data.split(',', 1)[1]
        img_bytes = base64.b64decode(image_data)
        with open(filepath, 'wb') as f:
            f.write(img_bytes)

        db_path = f"unknown_faces/{filename}"
        new_unknown = UnknownFace(
            image_path=db_path,
            confidence_score=distance,
        )
        new_unknown.set_encoding(probe)
        db.session.add(new_unknown)
        db.session.commit()

        # Add to in-memory cache
        _recent_unknown_encodings.append(probe)
        if len(_recent_unknown_encodings) > _DEDUP_WINDOW:
            _recent_unknown_encodings.pop(0)

        logger.info(f"[UnknownFace] Saved new unknown face to {db_path} with distance={distance}")
        return new_unknown
    except Exception as e:
        db.session.rollback()
        logger.error(f"[UnknownFace] Failed to save unknown face: {e}")
        return None
