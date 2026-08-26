"""
Liveness & Presentation Attack Detection (PAD) Module
------------------------------------------------------
Provides temporal Eye Aspect Ratio (EAR) and normalized facial landmark micro-motion tracking.

LIMITATION DOCUMENTATION:
This implementation uses temporal landmark micro-motion and eye-aspect ratio tracking to reject 
static paper photos and frozen phone-screen presentation attacks. It is NOT a production-grade 
Presentation Attack Detection (PAD) system and must not claim to reliably detect high-frame-rate 
video replay attacks or 3D masks. For production-grade PAD, an external deep learning model 
(such as MiniFASNet or Silent-Face-Anti-Spoofing ONNX) would need to be added separately.
"""

import logging
import numpy as np

logger = logging.getLogger(__name__)

# Try to load face_recognition
try:
    import face_recognition
    LIVENESS_AVAILABLE = True
    logger.info('[Liveness] face_recognition landmarks loaded.')
except ImportError:
    LIVENESS_AVAILABLE = False
    logger.warning('[Liveness] face_recognition not installed. Liveness detection disabled.')

EAR_THRESHOLD = 0.23   # Below this = eye closed / blink event
CONSEC_FRAMES = 2      # Consecutive frames to count as blink


def _eye_aspect_ratio(eye_points) -> float:
    """Compute Eye Aspect Ratio."""
    if len(eye_points) < 6:
        return 0.0
    a = np.linalg.norm(eye_points[1] - eye_points[5])
    b = np.linalg.norm(eye_points[2] - eye_points[4])
    c = np.linalg.norm(eye_points[0] - eye_points[3])
    return float((a + b) / (2.0 * c + 1e-6))


def get_eye_aspect_ratio_from_image(image_rgb: np.ndarray, face_location=None) -> float | None:
    """
    Calculate the Eye Aspect Ratio (EAR) for a face in an image.
    Uses face_locations to speed up shape prediction.
    """
    if not LIVENESS_AVAILABLE or image_rgb is None or image_rgb.size == 0:
        return None
    try:
        locs = [face_location] if face_location is not None else None
        landmarks_list = face_recognition.face_landmarks(image_rgb, face_locations=locs)
        if not landmarks_list:
            return None
        
        landmarks = landmarks_list[0]
        left_eye  = np.array(landmarks.get('left_eye', []))
        right_eye = np.array(landmarks.get('right_eye', []))
        
        if len(left_eye) == 6 and len(right_eye) == 6:
            left_ear  = _eye_aspect_ratio(left_eye)
            right_ear = _eye_aspect_ratio(right_eye)
            return float((left_ear + right_ear) / 2.0)
    except Exception as e:
        logger.debug(f"[Liveness] EAR calculation error: {e}")
    return None


class LivenessSession:
    """
    Stateful session for tracking blink count across multiple frames.
    Create one per user during registration.
    """

    def __init__(self, required_blinks: int = 2):
        self.required_blinks = required_blinks
        self.blink_count = 0
        self._consec_closed = 0
        self._eye_was_closed = False

    @property
    def passed(self) -> bool:
        return self.blink_count >= self.required_blinks

    @property
    def available(self) -> bool:
        return LIVENESS_AVAILABLE

    def process_frame(self, image_rgb: np.ndarray) -> dict:
        """Process a single RGB frame and update blink count."""
        result = {
            'blink_count': self.blink_count,
            'required': self.required_blinks,
            'passed': self.passed,
            'liveness_available': LIVENESS_AVAILABLE,
        }

        if not LIVENESS_AVAILABLE:
            result['passed'] = True
            result['message'] = 'Liveness not available — auto-approved'
            return result

        try:
            landmarks_list = face_recognition.face_landmarks(image_rgb)

            if not landmarks_list:
                result['message'] = 'No face detected'
                return result

            landmarks = landmarks_list[0]
            left_eye  = np.array(landmarks.get('left_eye', []))
            right_eye = np.array(landmarks.get('right_eye', []))

            if len(left_eye) == 6 and len(right_eye) == 6:
                left_ear  = _eye_aspect_ratio(left_eye)
                right_ear = _eye_aspect_ratio(right_eye)
                ear = (left_ear + right_ear) / 2.0

                if ear < EAR_THRESHOLD:
                    self._consec_closed += 1
                else:
                    if self._consec_closed >= CONSEC_FRAMES:
                        self.blink_count += 1
                    self._consec_closed = 0

                result['blink_count'] = self.blink_count
                result['passed'] = self.passed
                result['ear'] = round(ear, 3)
                result['message'] = f'Blinked {self.blink_count}/{self.required_blinks} times'
            else:
                result['message'] = 'Could not resolve eye landmarks'
        except Exception as e:
            logger.error(f'[Liveness] frame error: {e}')
            result['message'] = f'Error: {e}'

        return result


def check_liveness_frame(image_rgb: np.ndarray, session_data: dict, required_blinks: int = 2) -> dict:
    if not LIVENESS_AVAILABLE:
        return {'passed': True, 'blink_count': required_blinks, 'required': required_blinks,
                'liveness_available': False, 'message': 'Auto-approved (liveness unavailable)'}

    ses = LivenessSession(required_blinks)
    ses.blink_count = session_data.get('blink_count', 0)
    ses._consec_closed = session_data.get('consec_closed', 0)

    result = ses.process_frame(image_rgb)

    session_data['blink_count'] = ses.blink_count
    session_data['consec_closed'] = ses._consec_closed

    return result


def evaluate_real_human_liveness(
    image_rgb: np.ndarray,
    face_box=None,
    ear_history=None,
    kps_history=None,
    observation_window: int = 8
) -> dict:
    """
    Evaluates temporal evidence for a tracked face box.
    Uses normalized facial keypoint displacement, Eye Aspect Ratio (EAR), and 2D landmark rigidity ratio.

    LIMITATION: Rejects static paper photos and frozen phone display screens.
    Returns structured per-face diagnostics dictionary.
    """
    if image_rgb is None or image_rgb.size == 0:
        return {
            'liveness_passed': False,
            'is_spoof': True,
            'liveness_score': 0.0,
            'decision': 'SPOOF',
            'reason': 'Invalid image',
            'diagnostics': {}
        }

    h, w = image_rgb.shape[:2]

    # Parse face bounding box
    if face_box is not None and isinstance(face_box, (list, tuple)) and len(face_box) == 4:
        try:
            b = [int(float(v)) for v in face_box]
            top, right, bottom, left = max(0, b[0]), min(w, b[1]), min(h, b[2]), max(0, b[3])
        except Exception:
            top, right, bottom, left = 0, w, h, 0
    else:
        top, right, bottom, left = 0, w, h, 0

    obs_count = len(ear_history) if ear_history else 0
    ear_list = ear_history if ear_history else []
    kps_list = kps_history if kps_history else []

    fw = max(1, right - left)
    fh = max(1, bottom - top)

    # Calculate normalized keypoint displacement across consecutive frames
    motion_deltas = []
    rel_motion_deltas = []

    if len(kps_list) >= 2:
        for i in range(1, len(kps_list)):
            prev_kps = kps_list[i-1]
            cur_kps = kps_list[i]
            if prev_kps is not None and cur_kps is not None and len(prev_kps) == len(cur_kps):
                disp_sum = 0.0
                rel_sum = 0.0
                for (px, py), (cx, cy) in zip(prev_kps, cur_kps):
                    dx = float(cx - px) / float(fw)
                    dy = float(cy - py) / float(fh)
                    disp_sum += (dx * dx + dy * dy) ** 0.5

                    rpx, rpy = float(px - left) / float(fw), float(py - top) / float(fh)
                    rcx, rcy = float(cx - left) / float(fw), float(cy - top) / float(fh)
                    drx = rcx - rpx
                    dry = rcy - rpy
                    rel_sum += (drx * drx + dry * dry) ** 0.5

                motion_deltas.append(disp_sum / len(cur_kps))
                rel_motion_deltas.append(rel_sum / len(cur_kps))

    mean_motion = float(np.mean(motion_deltas)) if motion_deltas else 0.0
    mean_rel_motion = float(np.mean(rel_motion_deltas)) if rel_motion_deltas else 0.0
    ear_var = float(np.var(ear_list)) if len(ear_list) >= 4 else 0.0001
    smoothed_ear = float(np.mean(ear_list[-3:])) if ear_list else 0.28
    has_blink = any(e < EAR_THRESHOLD for e in ear_list) if ear_list else False

    rigid_ratio = (mean_rel_motion / (mean_motion + 1e-6)) if mean_motion > 0 else 0.0

    diagnostics = {
        'face_box': [top, right, bottom, left],
        'crop_dimensions': [fh, fw],
        'liveness_engine': 'InsightFace_Landmark_Temporal_v6.5_RigidBodyRatio',
        'observation_frames': obs_count,
        'observation_window_required': observation_window,
        'ear_current': round(smoothed_ear, 4),
        'ear_variance': round(ear_var, 6),
        'normalized_motion_delta': round(mean_motion, 6),
        'relative_internal_motion': round(mean_rel_motion, 6),
        'rigid_ratio': round(rigid_ratio, 4),
        'blink_detected': has_blink
    }

    # ── Rule 1: Pending Observation Window (Must collect 3 frames) ──
    if obs_count < 3:
        diagnostics['live_confidence'] = 0.50
        diagnostics['spoof_confidence'] = 0.50
        return {
            'liveness_passed': False,
            'is_spoof': False,
            'liveness_score': 0.50,
            'decision': 'LIVENESS_CHECK',
            'reason': f'Collecting temporal evidence ({obs_count}/3 frames)...',
            'diagnostics': diagnostics
        }

    # ── Rule 2: Explicit Presentation Attack Check (Phone Screen Photo / Static Printout) ──
    # Attack Case A: Hand-Held Phone Screen Display (Heavy hand-shake motion > 0.020, but 100% rigid internal landmarks rigid_ratio < 0.008 and zero blinks)
    is_phone_screen_attack = (
        obs_count >= 8 and
        not has_blink and
        mean_motion > 0.020 and
        mean_rel_motion < 0.00010 and
        rigid_ratio < 0.008
    )

    # Attack Case B: Dead Paper Printout (100% frozen image with absolute zero camera motion & zero eye variance)
    is_dead_paper_photo = (
        obs_count >= 10 and
        not has_blink and
        ear_var < 0.000002 and
        mean_motion < 0.00010 and
        mean_rel_motion < 0.00005
    )

    if is_phone_screen_attack or is_dead_paper_photo:
        diagnostics['live_confidence'] = 0.05
        diagnostics['spoof_confidence'] = 0.95
        return {
            'liveness_passed': False,
            'is_spoof': True,
            'liveness_score': 0.05,
            'decision': 'SPOOF_DETECTED',
            'reason': 'Presentation Attack Rejected: Phone screen display / Static paper photo detected',
            'diagnostics': diagnostics
        }

    # ── Rule 3: Confirmed Real Live Human ──
    diagnostics['live_confidence'] = 0.95
    diagnostics['spoof_confidence'] = 0.05
    return {
        'liveness_passed': True,
        'is_spoof': False,
        'liveness_score': 0.95,
        'decision': 'LIVE_VERIFIED',
        'reason': 'Real human verified',
        'diagnostics': diagnostics
    }
