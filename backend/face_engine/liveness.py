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
      1. Static EAR Eye Aspect Ratio Variance (Catches frozen eyes on static photos across 6+ frames)
      2. Facial Skin Glass Reflection (Evaluates specular glare strictly on upper 75% face skin)
      3. Phone Hardware Rectangular Frame Detection (Detects 4-sided convex phone display bezels)
      4. CLAHE-Normalized Skin Color Spectrum (Normalizes lighting for accurate skin verification)
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
            return {'liveness_passed': True, 'is_spoof': False, 'liveness_score': 0.85, 'reason': 'Small face'}

        # Facial skin ROI: Upper 75% of face box (excludes white shirt collars / clothes at bottom)
        skin_bottom = top + int(fh * 0.75)
        face_skin_crop = image_rgb[top:skin_bottom, left:right]

        # ── Test 1: Static EAR Variance (Across 6+ Scan Frames) ──
        if ear_history and len(ear_history) >= 6:
            ear_var = float(np.var(ear_history))
            if ear_var < 0.000015:  # Static frozen eyes across 6+ frames
                res = {
                    'liveness_passed': False,
                    'is_spoof': True,
                    'liveness_score': 0.1,
                    'reason': 'Spoof Attack Blocked: Static photo detected (frozen eyes)'
                }
                logger.info(f"[Liveness] SPOOF DETECTED: {res['reason']}")
                return res

        # ── Test 2: Phone Glass Specular Reflection on Upper Face Skin ──
        # Check specular glare strictly on facial skin (excluding white shirts)
        hsv_skin = cv2.cvtColor(face_skin_crop, cv2.COLOR_RGB2HSV)
        v_skin = hsv_skin[:, :, 2]
        specular_mask = (v_skin >= 253)
        specular_pct = float(np.mean(specular_mask) * 100.0)

        # Phone glass screen reflection produces flat clipped patches (std dev < 1.0) over > 10% of facial skin
        if specular_pct > 10.0:
            glare_pixels = v_skin[specular_mask]
            if len(glare_pixels) > 0 and float(np.std(glare_pixels)) < 1.0:
                res = {
                    'liveness_passed': False,
                    'is_spoof': True,
                    'liveness_score': 0.15,
                    'specular_pct': round(specular_pct, 1),
                    'reason': 'Spoof Attack Blocked: Phone screen glass glare reflection'
                }
                logger.info(f"[Liveness] SPOOF DETECTED: {res['reason']}")
                return res

        # ── Test 3: Phone Hardware Rectangular Bezel Border ──
        # Expanded crop (20% margin around face to check for phone body edges)
        exp_top = max(0, top - int(fh * 0.20))
        exp_left = max(0, left - int(fw * 0.20))
        exp_bottom = min(h, bottom + int(fh * 0.20))
        exp_right = min(w, right + int(fw * 0.20))
        exp_crop = image_rgb[exp_top:exp_bottom, exp_left:exp_right]

        if exp_crop.shape[0] > 60 and exp_crop.shape[1] > 60:
            gray_exp = cv2.cvtColor(exp_crop, cv2.COLOR_RGB2GRAY)
            blur_exp = cv2.GaussianBlur(gray_exp, (5, 5), 0)
            _, thresh_exp = cv2.threshold(blur_exp, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            contours, _ = cv2.findContours(thresh_exp, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

            rect_phone_detected = False
            exp_area = exp_crop.shape[0] * exp_crop.shape[1]
            for cnt in contours:
                area = cv2.contourArea(cnt)
                if 0.25 * exp_area < area < 0.85 * exp_area:
                    peri = cv2.arcLength(cnt, True)
                    approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)
                    if len(approx) == 4 and cv2.isContourConvex(approx):
                        x_r, y_r, w_r, h_r = cv2.boundingRect(approx)
                        aspect_ratio = float(h_r) / w_r if w_r > 0 else 0
                        if 1.3 <= aspect_ratio <= 2.5:
                            rect_phone_detected = True
                            break

            if rect_phone_detected:
                res = {
                    'liveness_passed': False,
                    'is_spoof': True,
                    'liveness_score': 0.1,
                    'reason': 'Spoof Attack Blocked: Phone rectangular hardware frame detected'
                }
                logger.info(f"[Liveness] SPOOF DETECTED: {res['reason']}")
                return res

        # ── Test 4: CLAHE-Normalized Skin Tone Spectrum ──
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        v_norm = clahe.apply(v_skin)
        h_ch, s_ch = hsv_skin[:, :, 0], hsv_skin[:, :, 1]

        # Warm skin hue: 0 <= Hue <= 30 or 150 <= Hue <= 180, Saturation >= 10
        skin_mask = ((h_ch <= 30) | (h_ch >= 150)) & (s_ch >= 10) & (s_ch <= 245) & (v_norm >= 20)
        skin_pct = float(np.mean(skin_mask) * 100.0)

        if skin_pct < 3.0:
            res = {
                'liveness_passed': False,
                'is_spoof': True,
                'liveness_score': round(skin_pct / 100.0, 2),
                'skin_pct': round(skin_pct, 1),
                'reason': 'Spoof Attack Blocked: Unnatural color spectrum (LED backlight screen)'
            }
            logger.info(f"[Liveness] SPOOF DETECTED: {res['reason']}")
            return res

        # Real Human Verified!
        res = {
            'liveness_passed': True,
            'is_spoof': False,
            'liveness_score': 0.95,
            'skin_pct': round(skin_pct, 1),
            'reason': 'Real human liveness verified'
        }
        logger.debug(f"[Liveness] PASSED: real human verified (skin={round(skin_pct, 1)}%)")
        return res

    except Exception as e:
        logger.error(f"[AntiSpoof] Multi-spectrum liveness error: {e}")
        return {'liveness_passed': True, 'is_spoof': False, 'liveness_score': 0.85, 'reason': 'Liveness fallback'}
