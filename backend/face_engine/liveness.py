"""
Liveness Detection
------------------
Detects blink events using Eye Aspect Ratio (EAR).
Used during face registration to prevent photo/video spoofing.

Requires: dlib shape predictor model
Download: http://dlib.net/files/shape_predictor_68_face_landmarks.dat.bz2
Place decompressed .dat file in: backend/face_engine/

Falls back gracefully if dlib landmarks not available.
"""

import os
import logging
import numpy as np

logger = logging.getLogger(__name__)

LANDMARK_MODEL = os.path.join(
    os.path.dirname(__file__),
    'shape_predictor_68_face_landmarks.dat'
)

# Try to load dlib predictor
try:
    import dlib
    if os.path.exists(LANDMARK_MODEL):
        _detector = dlib.get_frontal_face_detector()
        _predictor = dlib.shape_predictor(LANDMARK_MODEL)
        LIVENESS_AVAILABLE = True
        logger.info('[Liveness] dlib landmark predictor loaded.')
    else:
        LIVENESS_AVAILABLE = False
        logger.warning(
            '[Liveness] shape_predictor_68_face_landmarks.dat not found. '
            'Liveness detection disabled. Download from: '
            'http://dlib.net/files/shape_predictor_68_face_landmarks.dat.bz2'
        )
except ImportError:
    LIVENESS_AVAILABLE = False
    logger.warning('[Liveness] dlib not installed. Liveness detection disabled.')


# dlib 68-point landmark indices
LEFT_EYE_IDXS  = list(range(36, 42))
RIGHT_EYE_IDXS = list(range(42, 48))
EAR_THRESHOLD  = 0.25   # Below this = eye closed
CONSEC_FRAMES  = 2       # Frames eye must be closed to count as blink


def _eye_aspect_ratio(eye_points) -> float:
    """Compute Eye Aspect Ratio."""
    a = np.linalg.norm(eye_points[1] - eye_points[5])
    b = np.linalg.norm(eye_points[2] - eye_points[4])
    c = np.linalg.norm(eye_points[0] - eye_points[3])
    return (a + b) / (2.0 * c + 1e-6)


def _landmarks_to_np(shape, dtype='int'):
    coords = np.zeros((68, 2), dtype=dtype)
    for i in range(68):
        coords[i] = (shape.part(i).x, shape.part(i).y)
    return coords


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
        """
        Process a single RGB frame and update blink count.
        Returns status dict.
        """
        result = {
            'blink_count': self.blink_count,
            'required': self.required_blinks,
            'passed': self.passed,
            'liveness_available': LIVENESS_AVAILABLE,
        }

        if not LIVENESS_AVAILABLE:
            # If liveness not available, auto-pass
            result['passed'] = True
            result['message'] = 'Liveness not available — auto-approved'
            return result

        try:
            gray = _to_gray(image_rgb)
            faces = _detector(gray, 0)

            if not faces:
                result['message'] = 'No face detected'
                return result

            # Use first face
            shape = _predictor(gray, faces[0])
            coords = _landmarks_to_np(shape)

            left_eye  = coords[LEFT_EYE_IDXS]
            right_eye = coords[RIGHT_EYE_IDXS]

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
            result['message'] = (
                f'Blinked {self.blink_count}/{self.required_blinks} times'
            )
        except Exception as e:
            logger.error(f'Liveness frame error: {e}')
            result['message'] = f'Error: {e}'

        return result


def _to_gray(image_rgb: np.ndarray) -> np.ndarray:
    try:
        import cv2
        return cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    except ImportError:
        # Fallback: simple luminance
        return np.dot(image_rgb[..., :3], [0.2989, 0.5870, 0.1140]).astype(np.uint8)


def check_liveness_frame(image_rgb: np.ndarray, session_data: dict, required_blinks: int = 2) -> dict:
    """
    Stateless wrapper — pass session_data dict across requests.
    session_data is mutated in place and should be stored in Flask session or client.
    """
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
