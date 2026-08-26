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
      3. Phone Bezel & Screen Border Contrast Detection (Validates screen-to-casing contrast boundary)
      4. CLAHE-Normalized Skin Color Spectrum (Normalizes low-light images for accurate skin verification)
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

        if fw < 30 or fh < 30:
            return {'liveness_passed': True, 'is_spoof': False, 'liveness_score': 0.8, 'reason': 'Small face'}

        face_crop = image_rgb[top:bottom, left:right]

        # ── Test 1: Static EAR Variance (Across 5+ Scan Frames) ──
        if ear_history and len(ear_history) >= 6:
            ear_var = float(np.var(ear_history))
            if ear_var < 0.000015:  # Static frozen eyes across 6+ frames
                return {
                    'liveness_passed': False,
                    'is_spoof': True,
                    'liveness_score': 0.1,
                    'reason': 'Spoof Attack Blocked: Static photo detected (frozen eyes)'
                }

        # ── Test 2: Phone Glass Specular Reflection & Flat Highlight Glare ──
        hsv_face = cv2.cvtColor(face_crop, cv2.COLOR_RGB2HSV)
        v_channel = hsv_face[:, :, 2]
        specular_mask = (v_channel >= 252)
        specular_pct = float(np.mean(specular_mask) * 100.0)

        if specular_pct > 6.0:
            glare_pixels = v_channel[specular_mask]
            if len(glare_pixels) > 0 and float(np.std(glare_pixels)) < 1.5:
                return {
                    'liveness_passed': False,
                    'is_spoof': True,
                    'liveness_score': 0.15,
                    'specular_pct': round(specular_pct, 1),
                    'reason': 'Spoof Attack Blocked: Phone screen glass glare reflection'
                }

        # ── Test 3: Phone Screen Bezel Frame (Screen-to-Bezel Contrast Boundary) ──
        # Expanded crop (15% margin around face)
        exp_top = max(0, top - int(fh * 0.15))
        exp_left = max(0, left - int(fw * 0.15))
        exp_bottom = min(h, bottom + int(fh * 0.15))
        exp_right = min(w, right + int(fw * 0.15))
        exp_crop = image_rgb[exp_top:exp_bottom, exp_left:exp_right]

        if exp_crop.shape[0] > 50 and exp_crop.shape[1] > 50:
            gray_exp = cv2.cvtColor(exp_crop, cv2.COLOR_RGB2GRAY)
            edges = cv2.Canny(gray_exp, 80, 200)
            lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=50, minLineLength=45, maxLineGap=3)
            
            phone_bezel_lines = 0
            if lines is not None:
                for line in lines:
                    lx1, ly1, lx2, ly2 = line[0]
                    ldx, ldy = abs(lx2 - lx1), abs(ly2 - ly1)
                    # Check for straight vertical or horizontal border lines
                    if (ldx < 2 and ldy > 40) or (ldy < 2 and ldx > 40):
                        # Verify line has sharp Screen (Bright > 140) vs Bezel (Dark < 70) contrast step
                        mid_x, mid_y = (lx1 + lx2) // 2, (ly1 + ly2) // 2
                        if 5 <= mid_x < gray_exp.shape[1] - 5 and 5 <= mid_y < gray_exp.shape[0] - 5:
                            inner_p = float(gray_exp[mid_y, mid_x - 3]) if ldx < 2 else float(gray_exp[mid_y - 3, mid_x])
                            outer_p = float(gray_exp[mid_y, mid_x + 3]) if ldx < 2 else float(gray_exp[mid_y + 3, mid_x])
                            contrast = abs(inner_p - outer_p)
                            if contrast > 80 and (inner_p > 130 or outer_p > 130) and (inner_p < 75 or outer_p < 75):
                                phone_bezel_lines += 1

            if phone_bezel_lines >= 3:
                return {
                    'liveness_passed': False,
                    'is_spoof': True,
                    'liveness_score': 0.1,
                    'bezel_lines': phone_bezel_lines,
                    'reason': 'Spoof Attack Blocked: Phone screen bezel border detected'
                }

        # ── Test 4: CLAHE-Normalized Skin Tone Spectrum ──
        # Apply CLAHE to Value channel to handle low ambient room lighting cleanly
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        v_norm = clahe.apply(v_channel)
        hsv_norm = cv2.cvtColor(face_crop, cv2.COLOR_RGB2HSV)
        h_ch, s_ch = hsv_norm[:, :, 0], hsv_norm[:, :, 1]

        # Warm skin hue: 0 <= Hue <= 28 or 155 <= Hue <= 180, Saturation >= 12
        skin_mask = ((h_ch <= 28) | (h_ch >= 155)) & (s_ch >= 12) & (s_ch <= 235) & (v_norm >= 25)
        skin_pct = float(np.mean(skin_mask) * 100.0)

        if skin_pct < 4.0:
            return {
                'liveness_passed': False,
                'is_spoof': True,
                'liveness_score': round(skin_pct / 100.0, 2),
                'skin_pct': round(skin_pct, 1),
                'reason': 'Spoof Attack Blocked: Unnatural color spectrum (LED backlight screen)'
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
