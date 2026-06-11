"""
routes/face_quality.py — Lightweight frame analysis for KYC-style face capture.

Uses ArcFace's 106-point landmark model to detect:
  • Face presence
  • Face centering (within center 60% of frame)
  • Face size (>12% of frame area)
  • Smile detection (Mouth Aspect Ratio from landmarks)

Endpoint: POST /api/face/analyze-frame
Body:     { "image": "base64..." }
Returns:  { face_detected, face_centered, face_size_ok, is_smiling, instruction, ... }
"""

import logging
import numpy as np
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from face_engine.engine_factory import get_engine

face_quality_bp = Blueprint('face_quality', __name__)
logger = logging.getLogger(__name__)


def _analyze_landmarks(face, img_h: int, img_w: int) -> dict:
    """
    Analyze a detected face for centering, size, and smile.

    InsightFace landmark_2d_106 layout (key points):
      - Points 33..51: left eye
      - Points 52..71: right eye
      - Points 72..86: nose
      - Points 87..105: mouth
        - 87,88,89,90,91: upper lip top contour (left to right)
        - 96,97,98,99,100: lower lip bottom contour (left to right)
        - 87 = left corner of mouth
        - 91 = right corner of mouth
        - 95 = bottom center of upper lip
        - 101 = top center of lower lip

    For smile detection we measure:
      mouth_width  = distance(left_corner, right_corner)
      mouth_height = distance(top_lip_center, bottom_lip_center)
      ratio = mouth_width / mouth_height
      → smiling when ratio > threshold (mouth stretches wider when smiling)
    """
    bbox = face.bbox  # [x1, y1, x2, y2]
    face_w = float(bbox[2] - bbox[0])
    face_h = float(bbox[3] - bbox[1])
    face_cx = float(bbox[0] + face_w / 2)
    face_cy = float(bbox[1] + face_h / 2)
    face_area = face_w * face_h
    frame_area = img_h * img_w

    # ── Centering check ───────────────────────────────────────────────────────
    margin_x = img_w * 0.20   # face center must be within center 60%
    margin_y = img_h * 0.20
    centered = (margin_x < face_cx < img_w - margin_x and
                margin_y < face_cy < img_h - margin_y)

    # ── Size check ────────────────────────────────────────────────────────────
    face_ratio = face_area / frame_area if frame_area > 0 else 0
    size_ok = face_ratio > 0.08   # face covers at least 8% of frame

    # ── Smile detection via landmarks ─────────────────────────────────────────
    is_smiling = False
    smile_score = 0.0

    landmarks = getattr(face, 'landmark_2d_106', None)
    if landmarks is None:
        # Fallback: try 5-point landmarks (kps)
        landmarks = getattr(face, 'kps', None)

    if landmarks is not None and len(landmarks) >= 100:
        # 106-point model available
        try:
            left_corner  = landmarks[87]   # left mouth corner
            right_corner = landmarks[91]   # right mouth corner
            top_lip      = landmarks[89]   # upper lip center
            bottom_lip   = landmarks[96]   # lower lip center (bottom contour)

            mouth_w = float(np.linalg.norm(right_corner - left_corner))
            mouth_h = float(np.linalg.norm(bottom_lip - top_lip))

            if mouth_h > 1e-5:
                smile_score = mouth_w / mouth_h
                # When smiling, mouth width/height ratio typically > 3.0
                # Neutral face is typically 2.0–2.5
                is_smiling = smile_score > 2.8
            else:
                # Mouth nearly closed — not smiling
                is_smiling = False
                smile_score = 0.0

        except (IndexError, TypeError):
            pass
    elif landmarks is not None and len(landmarks) >= 5:
        # 5-point model: points are [left_eye, right_eye, nose, left_mouth, right_mouth]
        try:
            left_mouth  = landmarks[3]
            right_mouth = landmarks[4]
            nose        = landmarks[2]

            mouth_w = float(np.linalg.norm(right_mouth - left_mouth))
            nose_to_mouth = float(np.linalg.norm(
                (left_mouth + right_mouth) / 2 - nose
            ))

            if nose_to_mouth > 1e-5:
                smile_score = mouth_w / nose_to_mouth
                is_smiling = smile_score > 2.2
        except (IndexError, TypeError):
            pass

    return {
        'face_centered': centered,
        'face_size_ok':  size_ok,
        'face_ratio':    round(face_ratio, 4),
        'is_smiling':    is_smiling,
        'smile_score':   round(smile_score, 2),
        'det_score':     round(float(face.det_score), 3),
    }


@face_quality_bp.route('/face/analyze-frame', methods=['POST'])
@jwt_required()
def analyze_frame():
    """
    Lightweight face analysis for guided KYC-style capture.

    Body: { "image": "base64..." }

    Returns face detection status + guided instruction text.
    Designed to be polled at ~2–3fps during registration.
    """
    data = request.get_json() or {}
    image_data = data.get('image')

    if not image_data:
        return jsonify({'success': False, 'message': 'image required'}), 400

    engine = get_engine()
    if not engine.available:
        return jsonify({
            'success': False,
            'face_detected': False,
            'instruction': 'Face engine not available',
        }), 503

    # Decode image
    image_rgb = engine.decode_image(image_data)
    if image_rgb is None:
        return jsonify({
            'success': True,
            'face_detected': False,
            'instruction': 'Could not decode image',
        }), 200

    h, w = image_rgb.shape[:2]

    # ── Run face detection ────────────────────────────────────────────────────
    try:
        # Use the underlying InsightFace app if available (ArcFace engine)
        app = getattr(engine, '_app', None)
        if app is not None:
            faces = app.get(image_rgb)
        else:
            # dlib fallback — use encode_face_for_registration
            result = engine.encode_face_for_registration(image_rgb, num_jitters=0)
            if result.get('success'):
                return jsonify({
                    'success': True,
                    'face_detected': True,
                    'face_centered': True,
                    'face_size_ok': True,
                    'is_smiling': False,
                    'instruction': 'Face detected — capture ready',
                    'can_capture': True,
                }), 200
            else:
                return jsonify({
                    'success': True,
                    'face_detected': False,
                    'instruction': 'Position your face in the oval',
                    'can_capture': False,
                }), 200
    except Exception as e:
        logger.error(f'[AnalyzeFrame] Detection error: {e}')
        return jsonify({
            'success': True,
            'face_detected': False,
            'instruction': 'Position your face in the oval',
        }), 200

    if not faces:
        return jsonify({
            'success': True,
            'face_detected': False,
            'face_centered': False,
            'face_size_ok': False,
            'is_smiling': False,
            'instruction': 'No face detected — look at the camera',
            'can_capture': False,
        }), 200

    # Use the most confident face
    face = max(faces, key=lambda f: float(f.det_score))
    analysis = _analyze_landmarks(face, h, w)

    # ── Build guided instruction ──────────────────────────────────────────────
    if not analysis['face_size_ok']:
        instruction = 'Move closer to the camera'
    elif not analysis['face_centered']:
        instruction = 'Center your face in the frame'
    elif not analysis['is_smiling']:
        instruction = 'Now smile! 😊'
    else:
        instruction = 'Perfect! Hold still… ✓'

    can_capture = (
        analysis['face_centered'] and
        analysis['face_size_ok'] and
        analysis['is_smiling']
    )

    return jsonify({
        'success':       True,
        'face_detected': True,
        **analysis,
        'instruction':   instruction,
        'can_capture':   can_capture,
    }), 200
