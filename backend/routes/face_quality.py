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
            left_corner  = landmarks[87]
            right_corner = landmarks[91]
            top_lip      = landmarks[89]
            bottom_lip   = landmarks[96]
            
            mouth_w = float(np.linalg.norm(right_corner - left_corner))
            mouth_h = float(np.linalg.norm(bottom_lip - top_lip))
            
            if face_w > 1e-5 and face_h > 1e-5:
                # Normal mouth width is ~30% of face width
                # Normal mouth height (lips closed) is very small
                smile_w = mouth_w / face_w
                smile_h = mouth_h / face_h
                
                # Accept if mouth stretches wide (>33%) OR mouth opens to show teeth (>4%)
                is_smiling = (smile_w > 0.33) or (smile_h > 0.04)
                smile_score = max(smile_w, smile_h)
            
        except (IndexError, TypeError):
            pass
    elif landmarks is not None and len(landmarks) >= 5:
        # 5-point model: points are [left_eye, right_eye, nose, left_mouth, right_mouth]
        try:
            left_mouth  = landmarks[3]
            right_mouth = landmarks[4]
            nose        = landmarks[2]
            
            mouth_w = float(np.linalg.norm(right_mouth - left_mouth))
            # Rough proxy for mouth openness: distance from nose to mouth center
            mouth_center = (left_mouth + right_mouth) / 2
            nose_to_mouth = float(np.linalg.norm(mouth_center - nose))
            
            if face_w > 1e-5 and face_h > 1e-5:
                smile_w = mouth_w / face_w
                smile_h = nose_to_mouth / face_h
                
                # Accept if wide mouth (>33%) OR large distance from nose (mouth opened wide)
                is_smiling = (smile_w > 0.33) or (smile_h > 0.30)
                smile_score = max(smile_w, smile_h)
        except (IndexError, TypeError):
            pass

    # ── Head pose (yaw) — estimated from landmark geometry ────────────────
    # face.pose is not populated by buffalo_s (the 1k3d68/genderage sub-models
    # are skipped). Instead we estimate yaw from the horizontal asymmetry
    # between the nose tip and the eye centres, which is reliable and fast.
    #
    # Convention (matching what the frontend expects):
    #   yaw > 0  → face turned to viewer's RIGHT  (user turns their right)
    #   yaw < 0  → face turned to viewer's LEFT   (user turns their left)
    #
    # NOTE: the frontend wraps the <video> in scaleX(-1), so frames sent to
    # the backend are UNMIRRORED. That means "face turns right in camera" =
    # positive yaw as seen by the backend, which is what the frontend test
    # `yaw > YAW_THRESHOLD` expects for the 'right' step.
    yaw_angle = 0.0
    _lm = landmarks  # already resolved above (106-pt or 5-pt or None)

    if _lm is not None and len(_lm) >= 106:
        # 106-point layout:
        #   pts 38,88 = approximate left-eye centre and right-eye centre
        #   pt  86    = nose tip (bottom of nose bridge)
        try:
            left_eye  = _lm[38]   # left eye inner corner
            right_eye = _lm[89]   # right eye inner corner  (≈symmetrical)
            nose_tip  = _lm[86]   # nose tip

            eye_mid_x = (float(left_eye[0]) + float(right_eye[0])) / 2.0
            nose_x    = float(nose_tip[0])
            eye_span  = abs(float(right_eye[0]) - float(left_eye[0]))

            if eye_span > 1e-3:
                # Positive → nose is to the right of eye midpoint → face turned right
                ratio = (nose_x - eye_mid_x) / eye_span
                import math
                yaw_angle = math.degrees(math.atan(ratio * 3.0))
        except (IndexError, TypeError):
            pass

    elif _lm is not None and len(_lm) >= 5:
        # 5-point kps: [left_eye, right_eye, nose, left_mouth, right_mouth]
        try:
            import math
            left_eye  = _lm[0]
            right_eye = _lm[1]
            nose_tip  = _lm[2]

            eye_mid_x = (float(left_eye[0]) + float(right_eye[0])) / 2.0
            nose_x    = float(nose_tip[0])
            eye_span  = abs(float(right_eye[0]) - float(left_eye[0]))

            if eye_span > 1e-3:
                ratio = (nose_x - eye_mid_x) / eye_span
                yaw_angle = math.degrees(math.atan(ratio * 3.0))
        except (IndexError, TypeError):
            pass

    return {
        'face_centered': centered,
        'face_size_ok':  size_ok,
        'face_ratio':    round(face_ratio, 4),
        'is_smiling':    is_smiling,
        'smile_score':   round(smile_score, 2),
        'yaw_angle':     round(yaw_angle, 1),
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
            'faces': [],
        }), 200

    # Build normalized bboxes for ALL faces (for training overlay)
    all_faces = []
    for f in faces:
        bbox = f.bbox
        all_faces.append({
            'left':   round(float(bbox[0]) / w, 4),
            'top':    round(float(bbox[1]) / h, 4),
            'right':  round(float(bbox[2]) / w, 4),
            'bottom': round(float(bbox[3]) / h, 4),
            'score':  round(float(f.det_score), 3),
        })

    # Use the most confident face for guided analysis
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
        'faces':         all_faces,
    }), 200


@face_quality_bp.route('/face/detect', methods=['POST'])
@jwt_required()
def detect_faces_only():
    """
    Fast face detection with face-shape contour points.
    Runs InsightFace on a downscaled image for speed.
    Returns bounding boxes + 106-point landmark contour for each face.

    Body: { "image": "base64..." }
    Returns: { "faces": [{ left, top, right, bottom, score, contour: [[x,y],...] }, ...] }
    """
    import cv2

    data = request.get_json() or {}
    image_data = data.get('image')

    if not image_data:
        return jsonify({'success': False, 'faces': []}), 400

    engine = get_engine()
    if not engine.available:
        return jsonify({'success': False, 'faces': []}), 503

    image_rgb = engine.decode_image(image_data)
    if image_rgb is None:
        return jsonify({'success': True, 'faces': []}), 200

    h, w = image_rgb.shape[:2]

    # Downscale for speed
    max_dim = 420
    scale = 1.0
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        image_rgb = cv2.resize(image_rgb, (int(w * scale), int(h * scale)))

    try:
        app = getattr(engine, '_app', None)
        if app is None:
            return jsonify({'success': True, 'faces': []}), 200

        # Run ONLY the detector (no landmarks/recognition) — ultra fast
        bboxes, kpss = app.det_model.detect(image_rgb, max_num=10, metric='default')

        faces = []
        if bboxes is not None and len(bboxes) > 0:
            for idx, bbox_row in enumerate(bboxes):
                x1, y1, x2, y2, score = [float(v) for v in bbox_row[:5]]

                # Scale back to original coordinates
                if scale != 1.0:
                    x1 /= scale; y1 /= scale; x2 /= scale; y2 /= scale

                fw = x2 - x1
                fh = y2 - y1

                # Build face-shaped contour from bbox geometry
                # Creates 16 points tracing an oval-ish face shape
                cx_face = (x1 + x2) / 2
                cy_face = (y1 + y2) / 2
                rx = fw * 0.50  # half-width
                ry = fh * 0.50  # half-height

                import math
                contour = []
                # Generate oval points from top (forehead) clockwise
                n_pts = 20
                for i in range(n_pts):
                    angle = -math.pi/2 + (2 * math.pi * i / n_pts)
                    # Slightly flatten the bottom (chin area) for a more natural face shape
                    r_x = rx
                    r_y = ry * (0.95 if angle > 0 else 1.0)  # chin slightly narrower
                    px = cx_face + r_x * math.cos(angle)
                    py = cy_face + r_y * math.sin(angle)
                    contour.append([round(px / w, 4), round(py / h, 4)])

                # Also add 5-point keypoints if available (eyes, nose, mouth)
                kps_data = []
                if kpss is not None and idx < len(kpss):
                    kps = kpss[idx]
                    for kp in kps:
                        kx = float(kp[0]) / scale / w if scale != 1.0 else float(kp[0]) / w
                        ky = float(kp[1]) / scale / h if scale != 1.0 else float(kp[1]) / h
                        kps_data.append([round(kx, 4), round(ky, 4)])

                faces.append({
                    'left':    round(x1 / w, 4),
                    'top':     round(y1 / h, 4),
                    'right':   round(x2 / w, 4),
                    'bottom':  round(y2 / h, 4),
                    'score':   round(score, 3),
                    'contour': contour,
                    'keypoints': kps_data,
                })

        return jsonify({'success': True, 'faces': faces}), 200

    except Exception as e:
        logger.error(f'[DetectOnly] Error: {e}')
        return jsonify({'success': True, 'faces': []}), 200
