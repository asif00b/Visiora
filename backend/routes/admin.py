import os
import logging
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required

from database import db, db_health_check
from models.unknown_face import UnknownFace, SystemConfig
from models.user import User
from utils.auth_helpers import require_role

admin_bp = Blueprint('admin', __name__)
logger   = logging.getLogger(__name__)


# ── System Config ─────────────────────────────────────────────────────────────

@admin_bp.route('/admin/config', methods=['GET'])
@jwt_required()
@require_role('admin')
def get_config():
    try:
        configs = SystemConfig.query.all()
        return jsonify({
            'success': True,
            'config': {c.key: c.value for c in configs}
        }), 200
    except Exception as e:
        logger.error(f'[Config] GET error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@admin_bp.route('/admin/config', methods=['PUT'])
@jwt_required()
@require_role('admin')
def update_config():
    try:
        data = request.get_json() or {}
        for key, value in data.items():
            SystemConfig.set(key, value)

        # Reload active face engine after recognition-related config changes.
        try:
            from face_engine.engine_factory import reset_engine, get_engine
            reset_engine()
            get_engine().load_from_db()
        except Exception:
            pass

        return jsonify({'success': True, 'message': 'Config updated'}), 200
    except Exception as e:
        logger.error(f'[Config] PUT error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


# ── Unknown Faces ─────────────────────────────────────────────────────────────

@admin_bp.route('/admin/unknown-faces', methods=['GET'])
@jwt_required()
@require_role('admin')
def list_unknown_faces():
    try:
        page     = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 100, type=int)
        unknowns = (
            UnknownFace.query
            .order_by(UnknownFace.captured_at.desc())
            .limit(per_page)
            .offset((page - 1) * per_page)
            .all()
        )
        total = UnknownFace.query.count()
        return jsonify({
            'success':       True,
            'unknown_faces': [u.safe_to_dict() for u in unknowns],
            'total':         total,
            'page':          page,
        }), 200
    except Exception as e:
        logger.error(f'[UnknownFaces] List error: {e}')
        return jsonify({'success': True, 'unknown_faces': [], 'total': 0}), 200


@admin_bp.route('/admin/unknown-faces/stats', methods=['GET'])
@jwt_required()
@require_role('admin')
def unknown_faces_stats():
    """Return count, disk usage, and oldest entry for unknown faces."""
    try:
        total   = UnknownFace.query.count()
        oldest  = UnknownFace.query.order_by(UnknownFace.captured_at.asc()).first()
        newest  = UnknownFace.query.order_by(UnknownFace.captured_at.desc()).first()

        # Disk usage
        unk_dir    = current_app.config['UNKNOWN_FACES_DIR']
        disk_bytes = 0
        file_count = 0
        if os.path.isdir(unk_dir):
            for fname in os.listdir(unk_dir):
                fpath = os.path.join(unk_dir, fname)
                if os.path.isfile(fpath):
                    disk_bytes += os.path.getsize(fpath)
                    file_count += 1

        return jsonify({
            'success':    True,
            'total_db':   total,
            'total_files': file_count,
            'disk_mb':    round(disk_bytes / 1024 / 1024, 2),
            'oldest':     oldest.captured_at.isoformat() if oldest and oldest.captured_at else None,
            'newest':     newest.captured_at.isoformat() if newest and newest.captured_at else None,
        }), 200
    except Exception as e:
        logger.error(f'[UnknownFaces] Stats error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@admin_bp.route('/admin/unknown-faces/<int:uid>/assign', methods=['POST'])
@jwt_required()
@require_role('admin')
def assign_unknown_face(uid):
    try:
        unknown = UnknownFace.query.get_or_404(uid)
        data    = request.get_json() or {}
        user_id = data.get('user_id')

        if not user_id:
            return jsonify({'success': False, 'message': 'user_id required'}), 400

        User.query.get_or_404(user_id)
        unknown.assigned_to_id = user_id
        db.session.commit()

        return jsonify({'success': True, 'message': 'Assigned successfully'}), 200
    except Exception as e:
        logger.error(f'[UnknownFaces] Assign error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@admin_bp.route('/admin/unknown-faces/<int:uid>', methods=['DELETE'])
@jwt_required()
@require_role('admin')
def delete_unknown_face(uid):
    try:
        unknown  = UnknownFace.query.get_or_404(uid)
        unk_dir  = current_app.config['UNKNOWN_FACES_DIR']
        _delete_file_safe(unknown.image_path, unk_dir)
        db.session.delete(unknown)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Deleted'}), 200
    except Exception as e:
        logger.error(f'[UnknownFaces] Delete error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@admin_bp.route('/admin/unknown-faces/bulk-delete', methods=['DELETE'])
@jwt_required()
@require_role('admin')
def bulk_delete_unknown_faces():
    """
    Bulk delete unknown faces.
    Body: {"ids": [1,2,3]}  or  {"all": true}  to wipe everything.
    """
    try:
        data    = request.get_json() or {}
        unk_dir = current_app.config['UNKNOWN_FACES_DIR']

        if data.get('all'):
            all_records = UnknownFace.query.all()
            count = len(all_records)
            for rec in all_records:
                _delete_file_safe(rec.image_path, unk_dir)
            UnknownFace.query.delete()
            db.session.commit()
            return jsonify({'success': True, 'deleted': count, 'message': f'{count} unknown faces deleted'}), 200

        ids = data.get('ids', [])
        if not ids:
            return jsonify({'success': False, 'message': 'ids or all=true required'}), 400

        records = UnknownFace.query.filter(UnknownFace.id.in_(ids)).all()
        count   = len(records)
        for rec in records:
            _delete_file_safe(rec.image_path, unk_dir)
            db.session.delete(rec)
        db.session.commit()
        return jsonify({'success': True, 'deleted': count, 'message': f'{count} unknown face(s) deleted'}), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f'[UnknownFaces] Bulk delete error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@admin_bp.route('/admin/unknown-faces/cleanup', methods=['POST'])
@jwt_required()
@require_role('admin')
def cleanup_unknown_faces():
    """
    Trigger cleanup:
      1. Remove records older than `max_age_days`.
      2. Remove duplicate encodings above threshold.
      3. Remove orphaned files not in DB.
    Returns a report.
    """
    try:
        from datetime import timedelta, datetime
        import numpy as np

        unk_dir     = current_app.config['UNKNOWN_FACES_DIR']
        max_age     = int(SystemConfig.get('unknown_face_max_age_days', '7'))
        threshold   = float(SystemConfig.get('unknown_face_dedup_threshold', '0.6'))
        deleted_old = 0
        deleted_dup = 0
        deleted_orf = 0

        # 1. Stale records
        cutoff = datetime.utcnow() - timedelta(days=max_age)
        stale  = UnknownFace.query.filter(UnknownFace.captured_at < cutoff).all()
        for rec in stale:
            _delete_file_safe(rec.image_path, unk_dir)
            db.session.delete(rec)
            deleted_old += 1
        db.session.flush()

        # 2. Dedup — remove records whose encoding is too close to an earlier one
        try:
            from face_engine.engine_factory import get_engine
            engine       = get_engine()
            all_recs     = UnknownFace.query.order_by(UnknownFace.captured_at.asc()).all()
            seen_encs    = []
            to_delete    = []
            for rec in all_recs:
                enc = rec.get_encoding()
                if enc is None:
                    continue
                enc_arr = np.array(enc)
                if engine.is_duplicate_unknown(enc_arr, seen_encs, threshold=threshold):
                    to_delete.append(rec)
                else:
                    seen_encs.append(enc_arr)
            for rec in to_delete:
                _delete_file_safe(rec.image_path, unk_dir)
                db.session.delete(rec)
                deleted_dup += 1
            db.session.flush()
        except Exception as de:
            logger.warning(f'[Cleanup] Dedup pass failed: {de}')

        # 3. Orphaned files
        if os.path.isdir(unk_dir):
            db_paths = {os.path.basename(r.image_path) for r in UnknownFace.query.all()}
            for fname in os.listdir(unk_dir):
                if fname not in db_paths:
                    try:
                        os.remove(os.path.join(unk_dir, fname))
                        deleted_orf += 1
                    except Exception:
                        pass

        db.session.commit()

        report = {
            'stale_deleted':   deleted_old,
            'dup_deleted':     deleted_dup,
            'orphan_deleted':  deleted_orf,
            'total_deleted':   deleted_old + deleted_dup + deleted_orf,
            'remaining':       UnknownFace.query.count(),
        }
        logger.info(f'[UnknownCleanup] {report}')
        return jsonify({'success': True, 'report': report}), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f'[Cleanup] Error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


# ── Storage Management ────────────────────────────────────────────────────────

@admin_bp.route('/admin/storage/cleanup', methods=['POST'])
@jwt_required()
@require_role('admin')
def storage_cleanup():
    """
    Scan known_faces/ and unknown_faces/ directories and remove
    any files that have no corresponding DB record.
    """
    try:
        from models.face_encoding import FaceEncoding

        known_dir  = current_app.config['KNOWN_FACES_DIR']
        unk_dir    = current_app.config['UNKNOWN_FACES_DIR']
        deleted    = 0
        bytes_freed = 0

        # Known faces: should be {user_id}.jpg
        if os.path.isdir(known_dir):
            valid_ids = {str(e.user_id) for e in FaceEncoding.query.all()}
            for fname in os.listdir(known_dir):
                uid = os.path.splitext(fname)[0]
                if uid not in valid_ids:
                    fpath = os.path.join(known_dir, fname)
                    try:
                        bytes_freed += os.path.getsize(fpath)
                        os.remove(fpath)
                        deleted += 1
                        logger.info(f'[StorageCleanup] Removed orphan known_face: {fname}')
                    except Exception:
                        pass

        # Unknown faces
        if os.path.isdir(unk_dir):
            db_files = {os.path.basename(r.image_path) for r in UnknownFace.query.all()}
            for fname in os.listdir(unk_dir):
                if fname not in db_files:
                    fpath = os.path.join(unk_dir, fname)
                    try:
                        bytes_freed += os.path.getsize(fpath)
                        os.remove(fpath)
                        deleted += 1
                    except Exception:
                        pass

        return jsonify({
            'success':     True,
            'deleted':     deleted,
            'bytes_freed': bytes_freed,
            'mb_freed':    round(bytes_freed / 1024 / 1024, 2),
            'message':     f'{deleted} orphaned file(s) removed ({round(bytes_freed/1024,1)} KB freed)',
        }), 200

    except Exception as e:
        logger.error(f'[StorageCleanup] Error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@admin_bp.route('/admin/storage/compress', methods=['POST'])
@jwt_required()
@require_role('admin')
def storage_compress():
    """
    Re-save all stored JPEG images at 85% quality to reduce disk usage.
    """
    try:
        import cv2
        import numpy as np
        CV2_OK = True
    except ImportError:
        CV2_OK = False

    if not CV2_OK:
        return jsonify({'success': False, 'message': 'OpenCV not available — cannot compress'}), 503

    try:
        known_dir  = current_app.config['KNOWN_FACES_DIR']
        unk_dir    = current_app.config['UNKNOWN_FACES_DIR']
        compressed = 0
        bytes_saved = 0

        for directory in [known_dir, unk_dir]:
            if not os.path.isdir(directory):
                continue
            for fname in os.listdir(directory):
                if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                    continue
                fpath = os.path.join(directory, fname)
                try:
                    orig_size = os.path.getsize(fpath)
                    img       = cv2.imread(fpath)
                    if img is None:
                        continue
                    cv2.imwrite(fpath, img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    new_size   = os.path.getsize(fpath)
                    bytes_saved += max(0, orig_size - new_size)
                    compressed  += 1
                except Exception as fe:
                    logger.warning(f'[Compress] Failed on {fname}: {fe}')

        return jsonify({
            'success':     True,
            'compressed':  compressed,
            'bytes_saved': bytes_saved,
            'mb_saved':    round(bytes_saved / 1024 / 1024, 2),
            'message':     f'{compressed} image(s) compressed ({round(bytes_saved/1024,1)} KB saved)',
        }), 200

    except Exception as e:
        logger.error(f'[Compress] Error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@admin_bp.route('/admin/storage/info', methods=['GET'])
@jwt_required()
@require_role('admin')
def storage_info():
    """Return disk usage stats for storage directories."""
    try:
        known_dir = current_app.config['KNOWN_FACES_DIR']
        unk_dir   = current_app.config['UNKNOWN_FACES_DIR']

        def dir_stats(path):
            total, count = 0, 0
            if os.path.isdir(path):
                for fname in os.listdir(path):
                    fp = os.path.join(path, fname)
                    if os.path.isfile(fp):
                        total += os.path.getsize(fp)
                        count += 1
            return {'files': count, 'bytes': total, 'mb': round(total / 1024 / 1024, 2)}

        return jsonify({
            'success':      True,
            'known_faces':  dir_stats(known_dir),
            'unknown_faces': dir_stats(unk_dir),
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ── Cache Reload ──────────────────────────────────────────────────────────────

@admin_bp.route('/admin/reload-cache', methods=['POST'])
@jwt_required()
@require_role('admin')
def reload_face_cache():
    """Force reload of in-memory face encoding cache from DB."""
    try:
        from face_engine.engine_factory import get_engine
        engine = get_engine()
        engine.load_from_db()
        return jsonify({
            'success': True,
            'message': f'Cache reloaded. {engine.cache_size()} encoding(s) loaded.',
            'gpu':     engine.gpu_available,
            'model':   engine.recommended_model,
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ── Database Health ───────────────────────────────────────────────────────────

@admin_bp.route('/admin/db-health', methods=['GET'])
@jwt_required()
@require_role('admin')
def database_health():
    """Check DB connectivity and table row counts."""
    result = db_health_check()
    status = 200 if result.get('status') == 'ok' else 503
    return jsonify({'success': result.get('status') == 'ok', **result}), status


# ── System Info ───────────────────────────────────────────────────────────────

@admin_bp.route('/admin/system-info', methods=['GET'])
@jwt_required()
@require_role('admin')
def system_info():
    try:
        from face_engine.engine_factory import get_engine, engine_info
        from face_engine.encoder import CV2_AVAILABLE
        engine             = get_engine()
        info               = engine_info()
        cache_size         = engine.cache_size()
        face_available     = engine.available
        cv2_available      = CV2_AVAILABLE
        gpu_available      = engine.gpu_available
        recommended_model  = engine.recommended_model
    except Exception:
        cache_size         = 0
        face_available     = False
        cv2_available      = False
        gpu_available      = False
        recommended_model  = 'hog'

    from models.user import User
    from models.attendance import Attendance
    from models.face_encoding import FaceEncoding

    return jsonify({
        'success': True,
        'info': {
            'face_recognition_available': face_available,
            'opencv_available':           cv2_available,
            'gpu_available':              gpu_available,
            'recommended_model':          recommended_model,
            'face_engine_backend':        info.get('backend'),
            'embedding_dim':              info.get('embedding_dim'),
            'cache_size':                 cache_size,
            'total_users':                User.query.count(),
            'total_encodings':            FaceEncoding.query.count(),
            'total_attendance':           Attendance.query.count(),
            'total_unknown_faces':        UnknownFace.query.count(),
        }
    }), 200


# ── Internal helpers ──────────────────────────────────────────────────────────

def _delete_file_safe(image_path: str, base_dir: str):
    """Safely delete a file given its relative path and base directory."""
    try:
        fname = os.path.basename(image_path)
        fpath = os.path.join(base_dir, fname)
        if os.path.exists(fpath):
            os.remove(fpath)
    except Exception:
        pass
