"""
Liveness Detection
------------------
Detects blink events using Eye Aspect Ratio (EAR).
Used to prevent photo/video spoofing.

Uses face_recognition's built-in 68-point landmark predictor.
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

EAR_THRESHOLD  = 0.25   # Below this = eye closed
CONSEC_FRAMES  = 2       # Frames eye must be closed to count as blink


def _eye_aspect_ratio(eye_points) -> float:
    """Compute Eye Aspect Ratio."""
    if len(eye_points) < 6:
        return 0.0
    a = np.linalg.norm(eye_points[1] - eye_points[5])
    b = np.linalg.norm(eye_points[2] - eye_points[4])
    c = np.linalg.norm(eye_points[0] - eye_points[3])
    return (a + b) / (2.0 * c + 1e-6)


def get_eye_aspect_ratio_from_image(image_rgb: np.ndarray, face_location=None) -> float | None:
    """
    Calculate the Eye Aspect Ratio (EAR) for a face in an image.
    Uses face_locations to speed up shape prediction.
    """
    if not LIVENESS_AVAILABLE:
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
            landmarks_list = face_recognition.face_landmarks(image_rgb)

            if not landmarks_list:
                result['message'] = 'No face detected'
                return result

            # Use first face
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
                result['message'] = (
                    f'Blinked {self.blink_count}/{self.required_blinks} times'
                )
            else:
                result['message'] = 'Could not resolve eye landmarks'
        except Exception as e:
            logger.error(f'[Liveness] frame error: {e}')
            result['message'] = f'Error: {e}'

        return result


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


def evaluate_real_human_liveness(image_rgb: np.ndarray, face_box=None, ear_history=None) -> dict:
    """
    Evaluates whether a detected face image is a real, live human or a photo/screen spoof.
    Performs multi-layer anti-spoofing checks:
      1. Static EAR Eye Aspect Ratio Variance (Catches frozen eyes on static photos across stream)
      2. Specular Glare & Phone Glass Reflection Analysis
      3. Phone Bezel & Straight Edge Detection (Hough line transform on expanded ROI)
      4. Skin Color Spectrum Distribution (YCrCb color space LED backlight reflection)
    Returns:
      {
        'liveness_passed': bool,
        'is_spoof': bool,
        'liveness_score': float,
        'reason': str
      }
    """
    import cv2
    import numpy as np

    if image_rgb is None or image_rgb.size == 0:
        return {'liveness_passed': False, 'is_spoof': True, 'liveness_score': 0.0, 'reason': 'Invalid image'}

    try:
        h, w = image_rgb.shape[:2]
        
        # Parse face bounding box coordinates accurately
        if face_box is not None and isinstance(face_box, (list, tuple)) and len(face_box) == 4:
            b = [int(v) for v in face_box]
            # Standard location format: [top, right, bottom, left]
            top = max(0, min(h - 1, b[0]))
            right = max(1, min(w, b[1]))
            bottom = max(top + 1, min(h, b[2]))
            left = max(0, min(right - 1, b[3]))
        else:
            top, right, bottom, left = 0, w, h, 0

        fw = max(1, right - left)
        fh = max(1, bottom - top)

        if fw < 25 or fh < 25:
            return {'liveness_passed': False, 'is_spoof': True, 'liveness_score': 0.0, 'reason': 'Face box too small'}

        face_crop = image_rgb[top:bottom, left:right]

        # Expanded crop (20% margin around face to inspect phone bezels & screen background)
        exp_top = max(0, top - int(fh * 0.2))
        exp_left = max(0, left - int(fw * 0.2))
        exp_bottom = min(h, bottom + int(fh * 0.2))
        exp_right = min(w, right + int(fw * 0.2))
        exp_crop = image_rgb[exp_top:exp_bottom, exp_left:exp_right]

        # ── Test 1: Static EAR Variance (Across Scan Stream) ──
        if ear_history and len(ear_history) >= 4:
            ear_var = float(np.var(ear_history))
            if ear_var < 0.000025:  # Static frozen eyes across consecutive frames
                return {
                    'liveness_passed': False,
                    'is_spoof': True,
                    'liveness_score': 0.1,
                    'reason': 'Spoof Attack Blocked: Static photo detected (frozen eyes)'
                }

        # ── Test 2: Specular Glare & Phone Glass Reflection ──
        # Phone glass screens reflect room lights producing clipped highlight patches (RGB >= 250)
        hsv_face = cv2.cvtColor(face_crop, cv2.COLOR_RGB2HSV)
        v_channel = hsv_face[:, :, 2]
        specular_mask = (v_channel >= 250)
        specular_pct = float(np.mean(specular_mask) * 100.0)

        # Check if there are flat specular glare patches (typical on phone screen glass)
        if specular_pct > 5.0:
            glare_pixels = v_channel[specular_mask]
            if len(glare_pixels) > 0 and float(np.std(glare_pixels)) < 2.0:
                return {
                    'liveness_passed': False,
                    'is_spoof': True,
                    'liveness_score': 0.15,
                    'specular_pct': round(specular_pct, 1),
                    'reason': 'Spoof Attack Blocked: Phone screen glass glare reflection'
                }

        # ── Test 3: Screen Bezel & Straight Edge Detection ──
        if exp_crop.shape[0] > 30 and exp_crop.shape[1] > 30:
            gray_exp = cv2.cvtColor(exp_crop, cv2.COLOR_RGB2GRAY)
            edges = cv2.Canny(gray_exp, 50, 150)
            lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=45, minLineLength=35, maxLineGap=4)
            
            long_straight_lines = 0
            if lines is not None:
                for line in lines:
                    lx1, ly1, lx2, ly2 = line[0]
                    ldx, ldy = abs(lx2 - lx1), abs(ly2 - ly1)
                    if (ldx < 3 and ldy > 30) or (ldy < 3 and ldx > 30):
                        long_straight_lines += 1

            if long_straight_lines >= 4:
                return {
                    'liveness_passed': False,
                    'is_spoof': True,
                    'liveness_score': 0.1,
                    'straight_lines': long_straight_lines,
                    'reason': 'Spoof Attack Blocked: Phone hardware bezel / screen edge detected'
                }

        # ── Test 4: YCrCb Human Skin Spectrum Reflection ──
        ycrcb = cv2.cvtColor(face_crop, cv2.COLOR_RGB2YCrCb)
        cr = ycrcb[:, :, 1]
        cb = ycrcb[:, :, 2]
        skin_mask = (cr >= 133) & (cr <= 173) & (cb >= 77) & (cb <= 127)
        skin_pct = float(np.mean(skin_mask) * 100.0)

        if skin_pct < 10.0:
            return {
                'liveness_passed': False,
                'is_spoof': True,
                'liveness_score': round(skin_pct / 100.0, 2),
                'skin_pct': round(skin_pct, 1),
                'reason': 'Spoof Attack Blocked: Unnatural skin spectrum (LED backlight screen)'
            }

        # Real Human Verified!
        return {
            'liveness_passed': True,
            'is_spoof': False,
            'liveness_score': 0.95,
            'skin_pct': round(skin_pct, 1),
            'reason': 'Real human liveness verified'
        }

    except Exception as e:
        logger.error(f"[AntiSpoof] Multi-spectrum liveness error: {e}")
        return {'liveness_passed': True, 'is_spoof': False, 'liveness_score': 0.85, 'reason': 'Liveness fallback'}
