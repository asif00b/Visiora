"""
routes/train.py  —  Model training via face dataset uploads.

Strategy:
  face_recognition (dlib) uses a FIXED pre-trained ResNet-34 weight file.
  You cannot modify its weights.  What *does* improve recognition accuracy is
  building a richer reference database:

    • More images per person  →  more diverse encodings
    • Diverse angles/lighting →  better angle-invariant matching

  This endpoint processes a labelled face dataset (folder-per-person ZIP, or
  individual files) and registers each person as a registered user with
  multiple encodings.

Supported dataset formats:
  1. ZIP with sub-folders:  PersonName/img1.jpg, PersonName/img2.jpg …
  2. Multiple image uploads where the filename is "StudentID_*.jpg"
"""

import os
import io
import json
import time
import base64
import zipfile
import logging
import threading

import numpy as np

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required

from database import db
from models.face_encoding import FaceEncoding
from models.user import User
from models.unknown_face import SystemConfig
from utils.auth_helpers import require_role
from face_engine.engine_factory import get_engine, compare_encodings as _engine_compare

train_bp = Blueprint('train', __name__)
logger   = logging.getLogger(__name__)

# ── In-process training job tracker ──────────────────────────────────────────
_jobs: dict = {}   # job_id -> {status, progress, log, result}
_jobs_lock  = threading.Lock()


def _new_job(job_id: str):
    _jobs[job_id] = {
        'status':   'queued',
        'progress': 0,
        'log':      [],
        'result':   None,
        'started':  time.time(),
    }


def _update_job(job_id, **kwargs):
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(kwargs)


def _log_job(job_id, msg):
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id]['log'].append(msg)
    logger.info(f'[Train:{job_id}] {msg}')


# ── Routes ────────────────────────────────────────────────────────────────────

@train_bp.route('/train/stats', methods=['GET'])
@jwt_required()
@require_role('admin')
def train_stats():
    """Return overall training statistics from the face encoding table."""
    from sqlalchemy import func
    from models.face_encoding import FaceEncoding

    total_enc   = FaceEncoding.query.count()
    total_users = User.query.filter(User.is_active == True).count()
    trained     = db.session.query(func.count(func.distinct(FaceEncoding.user_id))).scalar()

    breakdown = db.session.query(
        FaceEncoding.encoding_type, func.count(FaceEncoding.id)
    ).group_by(FaceEncoding.encoding_type).all()

    avg_quality = db.session.query(func.avg(FaceEncoding.quality_score)).scalar()
    engine      = get_engine()
    cache_size  = engine.cache_size()
    engine_name = engine.__class__.__name__

    untrained = User.query.filter(
        User.is_active == True
    ).filter(
        ~User.id.in_(
            db.session.query(FaceEncoding.user_id)
        )
    ).all()

    return jsonify({
        'success':          True,
        'total_encodings':  total_enc,
        'total_users':      total_users,
        'trained_users':    trained,
        'untrained_users':  len(untrained),
        'untrained_names':  [u.name for u in untrained[:10]],
        'avg_quality_pct':  round((avg_quality or 0) * 100, 1),
        'cache_live':       cache_size,
        'max_per_user':     engine.MAX_ENCODINGS_PER_USER,
        'type_breakdown':   {t or 'unknown': c for t, c in breakdown},
        'engine':           engine_name,
        'embedding_dim':    512 if 'ArcFace' in engine_name else 128,
    }), 200


@train_bp.route('/train/jobs', methods=['GET'])
@jwt_required()
@require_role('admin')
def list_jobs():
    """Return all training job statuses."""
    with _jobs_lock:
        jobs = {jid: {**j, 'log': j['log'][-30:]} for jid, j in _jobs.items()}
    return jsonify({'success': True, 'jobs': jobs}), 200


@train_bp.route('/train/jobs/<job_id>', methods=['GET'])
@jwt_required()
@require_role('admin')
def get_job(job_id):
    """Poll a specific training job."""
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        return jsonify({'success': False, 'message': 'Job not found'}), 404
    return jsonify({'success': True, 'job': {**job, 'log': job['log'][-50:]}}), 200


@train_bp.route('/train/upload-dataset', methods=['POST'])
@jwt_required()
@require_role('admin')
def upload_dataset():
    """
    Upload a labelled face dataset ZIP and train face encodings for each person.

    ZIP format (folder-per-person):
        PersonName/image1.jpg
        PersonName/image2.jpg
        ...

    The person's name is matched against existing users by name (case-insensitive).
    If no user is found, the person is skipped.
    Set ?create_users=1 to auto-create new User records from folder names.
    """
    create_users = request.args.get('create_users', '0') == '1'

    if 'zip' not in request.files:
        return jsonify({'success': False, 'message': 'No ZIP file uploaded. Use field name "zip".'}), 400

    zip_file = request.files['zip']
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_file.read()))
    except Exception:
        return jsonify({'success': False, 'message': 'Invalid or corrupted ZIP file.'}), 400

    person_images: dict = {}
    for name in zf.namelist():
        parts = name.replace('\\', '/').split('/')
        if len(parts) < 2:
            continue
        person_name = parts[0].strip()
        filename    = parts[-1]
        if not filename or not filename.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.webp')):
            continue
        person_images.setdefault(person_name, [])
        try:
            person_images[person_name].append((filename, zf.read(name)))
        except Exception:
            pass

    if not person_images:
        return jsonify({
            'success': False,
            'message': 'No images found. ZIP must have structure: PersonName/image1.jpg …',
        }), 400

    import uuid
    job_id = str(uuid.uuid4())[:8]
    _new_job(job_id)

    app = current_app._get_current_object()
    thread = threading.Thread(
        target=_run_training_job,
        args=(app, job_id, person_images, create_users),
        daemon=True,
    )
    thread.start()

    return jsonify({
        'success':  True,
        'message':  f'Training started for {len(person_images)} person(s). Poll /api/train/jobs/{job_id} for progress.',
        'job_id':   job_id,
        'persons':  list(person_images.keys()),
        'total_images': sum(len(v) for v in person_images.values()),
    }), 202


@train_bp.route('/train/reload-cache', methods=['POST'])
@jwt_required()
@require_role('admin')
def reload_cache():
    """Reload the in-memory face recognition cache from all stored encodings."""
    engine = get_engine()
    engine.load_from_db()
    return jsonify({
        'success':    True,
        'message':    f'Cache reloaded with {engine.cache_size()} user(s).',
        'cache_size': engine.cache_size(),
    }), 200


# ── Background training worker ────────────────────────────────────────────────

def _run_training_job(app, job_id: str, person_images: dict, create_users: bool):
    """Process dataset images in a background thread."""
    import cv2

    with app.app_context():
        engine = get_engine()

        if not engine.available:
            _update_job(job_id, status='failed', result={'error': 'face_recognition not installed'})
            return

        from face_engine.encoder import score_image_quality, normalize_face_box

        model      = SystemConfig.get('face_register_model', 'hog')
        max_enc    = engine.MAX_ENCODINGS_PER_USER
        dedup_thr  = 0.42

        total_persons = len(person_images)
        total_added   = 0
        total_skipped = 0
        results       = []

        _update_job(job_id, status='running')

        for p_idx, (person_name, images) in enumerate(person_images.items()):
            _update_job(job_id, progress=int(p_idx / total_persons * 100))

            # ── Match to a registered user ──────────────────────────────────
            user = User.query.filter(
                db.func.lower(User.name) == person_name.lower()
            ).first()

            if not user and create_users:
                user = User(
                    name=person_name,
                    email=f'{person_name.lower().replace(" ", ".")}@dataset.local',
                    password_hash='$2b$12$placeholder',
                    role='student',
                    is_active=True,
                )
                db.session.add(user)
                db.session.flush()
                _log_job(job_id, f'Created user: {person_name}')

            if not user:
                _log_job(job_id, f'SKIP {person_name} — no matching user (use ?create_users=1 to auto-create)')
                results.append({'person': person_name, 'added': 0, 'skipped': len(images), 'reason': 'no_user'})
                continue

            # ── Load existing encodings for this user ──────────────────────
            existing_db  = FaceEncoding.query.filter_by(user_id=user.id).all()
            existing_enc = []
            for e in existing_db:
                try:
                    existing_enc.append(np.array(e.get_encoding()))
                except Exception:
                    pass

            slots = max(0, max_enc - len(existing_db))
            if slots == 0:
                _log_job(job_id, f'FULL {person_name} — already at {max_enc} encodings')
                results.append({'person': person_name, 'added': 0, 'skipped': len(images), 'reason': 'full'})
                continue

            # ── Process each image ─────────────────────────────────────────
            person_added   = 0
            person_skipped = 0
            new_encs_batch = []

            for filename, img_bytes in images:
                if person_added >= slots:
                    break
                try:
                    nparr    = np.frombuffer(img_bytes, np.uint8)
                    img_bgr  = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    if img_bgr is None:
                        person_skipped += 1
                        continue
                    image_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

                    result = engine.encode_face_for_registration(
                        image_rgb, model=model, min_face_size=40, num_jitters=2
                    )
                    if not result['success']:
                        person_skipped += 1
                        continue

                    enc_arr  = result['encoding']
                    norm_box = normalize_face_box(result.get('face_box'))
                    quality  = score_image_quality(image_rgb, norm_box) if norm_box else 0.5

                    # BUG FIX #6: use engine-agnostic compare_encodings
                    all_known = existing_enc + [np.array(e) for e in new_encs_batch]
                    if all_known:
                        dists = _engine_compare(all_known, enc_arr)
                        if len(dists) > 0 and float(np.min(dists)) < dedup_thr:
                            person_skipped += 1
                            continue

                    enc_rec = FaceEncoding(user_id=user.id)
                    enc_rec.set_encoding(enc_arr)
                    enc_rec.quality_score = quality
                    enc_rec.encoding_type = 'dataset'
                    enc_rec.source_count  = 1
                    db.session.add(enc_rec)
                    new_encs_batch.append(enc_arr)
                    person_added += 1

                except Exception as e:
                    person_skipped += 1
                    logger.warning(f'[Train:{job_id}] Error on {person_name}/{filename}: {e}')

            db.session.commit()

            if new_encs_batch:
                engine.add_encodings_to_cache(user.id, user.name,
                                              [np.array(e) for e in new_encs_batch])

            total_added   += person_added
            total_skipped += person_skipped
            _log_job(job_id, f'{person_name}: +{person_added} encodings ({person_skipped} skipped)')
            results.append({'person': person_name, 'user_id': user.id, 'added': person_added, 'skipped': person_skipped})

        _update_job(job_id, status='done', progress=100, result={
            'total_added':   total_added,
            'total_skipped': total_skipped,
            'persons':       results,
        })
        _log_job(job_id, f'Done: +{total_added} encodings across {total_persons} person(s).')
