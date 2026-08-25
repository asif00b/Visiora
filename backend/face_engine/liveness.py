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
      1. Static EAR Eye Aspect Ratio Variance (Catches frozen eyes on static photos)
      2. Specular Glare & Phone Glass Reflection Analysis
      3. 3D Surface Shading Gradient Contrast (Differentiates 3D real face from flat 2D screen)
      4. Screen Bezel & Straight Edge Detection (Hough line transform)
      5. Skin Color Spectrum Distribution (YCrCb color space LED backlight reflection)
    Returns:
      {
        'liveness_passed': bool,
        'is_spoof': bool,
        'liveness_score': float,
        'reason': str
      }
    """
    import cv2
    if image_rgb is None or image_rgb.size == 0:
        return {'liveness_passed': False, 'is_spoof': True, 'liveness_score': 0.0, 'reason': 'Invalid image'}

    try:
        h, w = image_rgb.shape[:2]
        
        # Crop face region if bounding box provided
        if face_box:
            try:
                top, right, bottom, left = [int(v) for v in face_box]
                top_crop = max(0, top - int((bottom - top) * 0.15))
                left_crop = max(0, left - int((right - left) * 0.15))
                bottom_crop = min(h, bottom + int((bottom - top) * 0.15))
                right_crop = min(w, right + int((right - left) * 0.15))

                top_inner = max(0, top)
                left_inner = max(0, left)
                bottom_inner = min(h, bottom)
                right_inner = min(w, right)

                if right_inner - left_inner > 20 and bottom_inner - top_inner > 20:
                    face_crop = image_rgb[top_inner:bottom_inner, left_inner:right_inner]
                else:
                    face_crop = image_rgb
                expanded_crop = image_rgb[top_crop:bottom_crop, left_crop:right_crop]
            except Exception:
                face_crop = image_rgb
                expanded_crop = image_rgb
        else:
            face_crop = image_rgb
            expanded_crop = image_rgb

        gray_face = cv2.cvtColor(face_crop, cv2.COLOR_RGB2GRAY)

        # ── Test 1: Static EAR Variance (Across Scan Stream) ──
        if ear_history and len(ear_history) >= 4:
            ear_var = float(np.var(ear_history))
            if ear_var < 0.00003:  # Completely static eyes across consecutive frames
                return {
                    'liveness_passed': False,
                    'is_spoof': True,
                    'liveness_score': 0.1,
                    'reason': 'Spoof Attack Blocked: Static eyes detected (Photo / Screen display)'
                }

        # ── Test 2: Specular Glare & Phone Glass Reflection ──
        # Phone glass screens reflect room lights producing clipped highlight patches (RGB >= 248)
        hsv_face = cv2.cvtColor(face_crop, cv2.COLOR_RGB2HSV)
        v_channel = hsv_face[:, :, 2]
        specular_mask = (v_channel >= 248)
        specular_pct = float(np.mean(specular_mask) * 100.0)

        # Check if there are flat specular glare patches (typical on phone screen glass)
        if specular_pct > 3.2:
            glare_pixels = v_channel[specular_mask]
            if len(glare_pixels) > 0 and float(np.std(glare_pixels)) < 2.5:
                return {
                    'liveness_passed': False,
                    'is_spoof': True,
                    'liveness_score': 0.15,
                    'specular_pct': round(specular_pct, 1),
                    'reason': 'Spoof Attack Blocked: Phone screen glass glare detected'
                }

        # ── Test 3: 3D Surface Shading & Contrast Variance ──
        # 3D human face under ambient light has rich 3D shading gradients across nose, cheeks, chin.
        # 2D photo on a screen has flat 2D luminance illumination.
        sobelx = cv2.Sobel(gray_face, cv2.CV_64F, 1, 0, ksize=3)
        sobely = cv2.Sobel(gray_face, cv2.CV_64F, 0, 1, ksize=3)
        gradient_mag = np.sqrt(sobelx**2 + sobely**2)
        grad_std = float(np.std(gradient_mag))

        if grad_std < 7.5:
            return {
                'liveness_passed': False,
                'is_spoof': True,
                'liveness_score': 0.2,
                'grad_std': round(grad_std, 2),
                'reason': 'Spoof Attack Blocked: Flat 2D photo surface detected'
            }

        # ── Test 4: Screen Bezel & Straight Edge Detection ──
        gray_exp = cv2.cvtColor(expanded_crop, cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(gray_exp, 50, 150)
        lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=45, minLineLength=40, maxLineGap=5)
        
        long_straight_lines = 0
        if lines is not None:
            for line in lines:
                x1, y1, x2, y2 = line[0]
                dx, dy = abs(x2 - x1), abs(y2 - y1)
                if (dx < 4 and dy > 35) or (dy < 4 and dx > 35):
                    long_straight_lines += 1

        if long_straight_lines >= 3:
            return {
                'liveness_passed': False,
                'is_spoof': True,
                'liveness_score': 0.1,
                'straight_lines': long_straight_lines,
                'reason': 'Spoof Attack Blocked: Phone hardware bezel / screen edge detected'
            }

        # ── Test 5: YCrCb Human Skin Spectrum Reflection ──
        ycrcb = cv2.cvtColor(face_crop, cv2.COLOR_RGB2YCrCb)
        cr = ycrcb[:, :, 1]
        cb = ycrcb[:, :, 2]
        skin_mask = (cr >= 133) & (cr <= 173) & (cb >= 77) & (cb <= 127)
        skin_pct = float(np.mean(skin_mask) * 100.0)

        if skin_pct < 18.0:
            return {
                'liveness_passed': False,
                'is_spoof': True,
                'liveness_score': round(skin_pct / 100.0, 2),
                'skin_pct': round(skin_pct, 1),
                'reason': 'Spoof Attack Blocked: Unnatural skin spectrum (Mobile screen LED backlight)'
            }

        # Overall Liveness Score calculation
        score = min(1.0, round((grad_std / 25.0) * 0.5 + (skin_pct / 60.0) * 0.5, 2))

        return {
            'liveness_passed': True,
            'is_spoof': False,
            'liveness_score': score,
            'grad_std': round(grad_std, 2),
            'skin_pct': round(skin_pct, 1),
            'reason': 'Real human liveness verified'
        }

    except Exception as e:
        logger.error(f"[AntiSpoof] Multi-spectrum liveness error: {e}")
        return {'liveness_passed': True, 'is_spoof': False, 'liveness_score': 0.8, 'reason': 'Liveness fallback'}
