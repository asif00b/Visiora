"""
Face Recognition Engine
-----------------------
Singleton with in-memory encoding cache for fast recognition.

Key design decisions:
  - Registration uses HOG (not CNN) for webcam images — CNN is too resource-heavy
    and unreliable on compressed browser JPEG frames.
  - HOG with 2x upsample catches small/angled faces very well.
  - Image preprocessing (CLAHE + upscale) done before detection.
  - Blur detection and face-size validation give clear user feedback.
  - num_jitters=1 for speed; accuracy comes from taking multiple photos.
"""

import os
import base64
import json
import logging
from io import BytesIO
from datetime import datetime

import numpy as np

logger = logging.getLogger(__name__)

# ── Graceful imports ──────────────────────────────────────────────────────────
try:
    import face_recognition
    FACE_RECOGNITION_AVAILABLE = True
except ImportError:
    FACE_RECOGNITION_AVAILABLE = False
    logger.warning('face_recognition not installed. Face features disabled.')

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    logger.warning('opencv not installed. Image preprocessing disabled.')


# ── Quality helpers ───────────────────────────────────────────────────────────

def _blur_score(gray_crop: np.ndarray) -> float:
    """Laplacian variance — higher = sharper."""
    if not CV2_AVAILABLE:
        return 999.0
    return float(cv2.Laplacian(gray_crop, cv2.CV_64F).var())


def _preprocess_for_detection(image_rgb: np.ndarray) -> np.ndarray:
    """
    Pre-process a webcam frame for better face detection:
      1. Upscale if smaller than 640px wide
      2. CLAHE contrast boost on luminance channel only
    Returns processed RGB image.
    """
    if not CV2_AVAILABLE:
        return image_rgb

    h, w = image_rgb.shape[:2]

    # Upscale small frames (most webcams @ 640×480 are OK, but boost small ones)
    if w < 640:
        scale = 640 / w
        image_rgb = cv2.resize(
            image_rgb, (640, int(h * scale)), interpolation=cv2.INTER_CUBIC
        )

    # CLAHE on L channel only (doesn't shift hue, just boosts contrast)
    lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_ch = clahe.apply(l_ch)
    lab = cv2.merge([l_ch, a_ch, b_ch])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)


def _resize_for_speed(image_rgb: np.ndarray, max_w: int = 800):
    """Downscale large images for speed. Returns (image, scale)."""
    if not CV2_AVAILABLE:
        return image_rgb, 1.0
    h, w = image_rgb.shape[:2]
    if w <= max_w:
        return image_rgb, 1.0
    scale = max_w / w
    resized = cv2.resize(image_rgb, (max_w, int(h * scale)), interpolation=cv2.INTER_AREA)
    return resized, scale


def _confidence_label(pct: float) -> str:
    if pct >= 85:  return 'High'
    if pct >= 65:  return 'Medium'
    return 'Low'


# ── Image quality scoring ─────────────────────────────────────────────────────

def score_image_quality(image_rgb: np.ndarray, face_location: tuple) -> float:
    """
    Compute a composite quality score [0.0 – 1.0] for a detected face.

    Components (all normalised to 0-1, then averaged):
      • sharpness  — Laplacian variance of the face crop
      • face_size  — bounding-box area relative to image area
      • brightness — grayscale mean of the face crop (penalises dark frames)

    Args:
        image_rgb:     Full RGB image as numpy array.
        face_location: (top, right, bottom, left) from face_recognition.

    Returns:
        float in [0.0, 1.0]  (higher = better)
    """
    if not CV2_AVAILABLE:
        return 0.5  # neutral fallback when opencv unavailable

    top, right, bottom, left = face_location
    h_img, w_img = image_rgb.shape[:2]

    # Guard against degenerate boxes
    if bottom <= top or right <= left:
        return 0.0

    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    face_crop = gray[top:bottom, left:right]

    # 1. Sharpness (Laplacian variance) — normalised; ~200+ is sharp for a webcam
    sharpness_raw = float(cv2.Laplacian(face_crop, cv2.CV_64F).var())
    sharpness = min(1.0, sharpness_raw / 200.0)

    # 2. Face size — ratio of face area to total image area
    face_area  = (bottom - top) * (right - left)
    image_area = h_img * w_img
    face_size  = min(1.0, (face_area / image_area) * 10.0)  # scale so 10 % = 1.0

    # 3. Brightness — mean pixel value in [0, 255], ideal ≈ 100–180
    mean_brightness = float(np.mean(face_crop))
    # Map [0,255] → [0,1] with peak at ~140
    brightness = 1.0 - abs(mean_brightness - 140.0) / 140.0
    brightness = max(0.0, brightness)

    return round((sharpness + face_size + brightness) / 3.0, 4)


def select_best_image(candidates: list) -> dict | None:
    """
    Given a list of candidate dicts (each with 'quality_score' key),
    return the one with the highest quality_score, or None if empty.

    Each candidate dict is expected to contain at minimum:
        {'image_rgb': np.ndarray, 'quality_score': float,
         'encoding': np.ndarray, 'b64': str, 'face_box': tuple}
    """
    if not candidates:
        return None
    return max(candidates, key=lambda c: c['quality_score'])


# ── Result container ──────────────────────────────────────────────────────────

class FaceResult:
    def __init__(self, user_id, name, box, distance, attendance_marked=False):
        self.user_id           = user_id
        self.name              = name
        self.box               = box
        self.distance          = distance
        self.attendance_marked = attendance_marked

    def to_dict(self):
        confidence = round((1 - self.distance) * 100, 1)
        return {
            'user_id':           self.user_id,
            'name':              self.name,
            'box':               self.box,
            'confidence':        confidence,
            'confidence_label':  _confidence_label(confidence),
            'distance':          round(self.distance, 4),
            'attendance_marked': self.attendance_marked,
        }


# ── Main engine ───────────────────────────────────────────────────────────────

class FaceEngine:
    """
    Singleton face recognition engine.
    Call FaceEngine.get_instance() to get the shared instance.
    """
    _instance = None
    _cache: dict = {}   # {user_id: {'name': str, 'encodings': [np.array]}}

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def available(self):
        return FACE_RECOGNITION_AVAILABLE

    # ── Cache ─────────────────────────────────────────────────────────────────

    def load_from_db(self):
        """
        Load face encodings from DB into memory.
        One encoding per user is sufficient for recognition — load the
        highest-quality one (quality_score DESC, then newest first).
        """
        if not FACE_RECOGNITION_AVAILABLE:
            return
        from models.face_encoding import FaceEncoding
        from models.user import User

        self._cache.clear()

        # Load all active encodings (ordered: best quality first)
        all_encodings = (
            FaceEncoding.query
            .join(User)
            .filter(User.is_active == True)
            .order_by(
                FaceEncoding.quality_score.desc().nullslast(),
                FaceEncoding.created_at.desc(),
            )
            .all()
        )

        loaded = 0
        for enc in all_encodings:
            uid = enc.user_id
            # Keep only the BEST encoding per user in the recognition cache
            if uid in self._cache:
                continue
            self._cache[uid] = {
                'name':      enc.user.name if enc.user else f'User {uid}',
                'encodings': [],
            }
            try:
                arr = np.array(enc.get_encoding())
                self._cache[uid]['encodings'].append(arr)
                loaded += 1
            except Exception as e:
                logger.error(f'Error loading encoding {enc.id}: {e}')

        logger.info(
            f'[FaceEngine] Loaded best encoding for {loaded}/{len(self._cache)} users.'
        )

    def add_to_cache(self, user_id: int, name: str, encoding_array):
        """
        Replace (not append) the encoding for this user.
        We store exactly ONE encoding per user for fast, clean recognition.
        """
        self._cache[user_id] = {
            'name':      name,
            'encodings': [np.array(encoding_array)],
        }

    def remove_from_cache(self, user_id: int):
        self._cache.pop(user_id, None)

    def cache_size(self):
        return sum(len(v['encodings']) for v in self._cache.values())

    # ── Image Decoding ────────────────────────────────────────────────────────

    def decode_image(self, image_data) -> np.ndarray:
        """Decode base64 string or raw bytes to RGB numpy array."""
        try:
            if isinstance(image_data, str):
                if ',' in image_data:
                    image_data = image_data.split(',', 1)[1]
                image_bytes = base64.b64decode(image_data)
            else:
                image_bytes = image_data

            if not CV2_AVAILABLE:
                from PIL import Image
                img = Image.open(BytesIO(image_bytes)).convert('RGB')
                return np.array(img)

            nparr   = np.frombuffer(image_bytes, np.uint8)
            img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img_bgr is None:
                return None
            return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        except Exception as e:
            logger.error(f'Image decode error: {e}')
            return None

    # ── Registration ──────────────────────────────────────────────────────────

    def encode_face_for_registration(
        self,
        image_rgb: np.ndarray,
        model: str = 'hog',      # HOG is fast & reliable for webcam images
        min_face_size: int = 50, # Smaller minimum for typical webcam distance
    ) -> dict:
        """
        Encode exactly ONE face for student registration.

        Strategy:
          1. Pre-process image (CLAHE + upscale)
          2. Try HOG with 2x upsample (catches small/angled faces)
          3. If still no face, try HOG with 1x upsample on original
          4. Validate: exactly 1 face, not too small, not too blurry
          5. Encode with num_jitters=1 (fast; accuracy from multiple photos)

        Returns dict with keys: success, encoding, message, face_count,
                                quality_score, face_box
        """
        if not FACE_RECOGNITION_AVAILABLE:
            return {
                'success': False,
                'message': 'face_recognition library not installed.',
                'encoding': None, 'face_count': 0,
                'quality_score': 0.0, 'face_box': None,
            }

        # ── Step 1: Pre-process ───────────────────────────────────────────────
        processed = _preprocess_for_detection(image_rgb)

        # ── Step 2: Detect face (HOG is better for compressed webcam JPEG) ───
        locations = face_recognition.face_locations(
            processed, model='hog', number_of_times_to_upsample=2
        )

        # Fallback: try original image un-preprocessed
        if not locations:
            locations = face_recognition.face_locations(
                image_rgb, model='hog', number_of_times_to_upsample=2
            )

        # Second fallback: try with 1x upsample (sometimes 2x over-detects nothing)
        if not locations:
            locations = face_recognition.face_locations(
                processed, model='hog', number_of_times_to_upsample=1
            )

        # ── Step 3: Validate face count ───────────────────────────────────────
        if len(locations) == 0:
            return {
                'success': False,
                'message': (
                    'No face detected. Tips: '
                    '(1) Look directly at the camera, '
                    '(2) Ensure good lighting — face the light source, '
                    '(3) Move closer to the camera, '
                    '(4) Avoid dark backgrounds.'
                ),
                'encoding': None, 'face_count': 0,
                'quality_score': 0.0, 'face_box': None,
            }

        if len(locations) > 1:
            return {
                'success': False,
                'message': (
                    f'{len(locations)} faces detected. '
                    'Please ensure only ONE person is in the frame.'
                ),
                'encoding': None, 'face_count': len(locations),
                'quality_score': 0.0, 'face_box': None,
            }

        top, right, bottom, left = locations[0]
        face_h = bottom - top
        face_w = right  - left

        # ── Step 4: Size check ────────────────────────────────────────────────
        if face_h < min_face_size or face_w < min_face_size:
            return {
                'success': False,
                'message': (
                    f'Face is too small ({face_w}x{face_h}px). '
                    'Please move closer to the camera.'
                ),
                'encoding': None, 'face_count': 1,
                'quality_score': 0.0, 'face_box': locations[0],
            }

        # ── Step 5: Blur check ────────────────────────────────────────────────
        quality_score = 1.0
        if CV2_AVAILABLE:
            gray   = cv2.cvtColor(processed, cv2.COLOR_RGB2GRAY)
            crop   = gray[top:bottom, left:right]
            blur   = _blur_score(crop)
            quality_score = min(1.0, blur / 150.0)

            if blur < 20:   # Very blurry (threshold lowered from 30 → 20)
                return {
                    'success': False,
                    'message': (
                        'Image is too blurry. '
                        'Hold still, ensure good lighting, and try again.'
                    ),
                    'encoding': None, 'face_count': 1,
                    'quality_score': round(quality_score, 3),
                    'face_box': locations[0],
                }

        # ── Step 6: Encode ────────────────────────────────────────────────────
        # num_jitters=1 for speed. Multiple photos are better than more jitters.
        try:
            encodings = face_recognition.face_encodings(
                processed, [locations[0]], num_jitters=1
            )
        except Exception as e:
            return {
                'success': False,
                'message': f'Encoding error: {str(e)}',
                'encoding': None, 'face_count': 1,
                'quality_score': 0.0, 'face_box': locations[0],
            }

        if not encodings:
            return {
                'success': False,
                'message': 'Could not compute face encoding. Try a clearer photo.',
                'encoding': None, 'face_count': 1,
                'quality_score': 0.0, 'face_box': locations[0],
            }

        return {
            'success':       True,
            'message':       f'Face captured (quality: {round(quality_score * 100)}%)',
            'encoding':      encodings[0],
            'face_count':    1,
            'quality_score': round(quality_score, 3),
            'face_box':      locations[0],
        }

    def encode_face(self, image_rgb: np.ndarray, model: str = 'hog') -> list:
        """Legacy: encode all faces in image. Returns list of encoding arrays."""
        if not FACE_RECOGNITION_AVAILABLE:
            raise RuntimeError('face_recognition library not installed.')
        small, _ = _resize_for_speed(image_rgb, max_w=800)
        locations = face_recognition.face_locations(small, model=model)
        if not locations:
            return []
        return list(face_recognition.face_encodings(small, locations))

    # ── Real-time Recognition ─────────────────────────────────────────────────

    def recognize(self, image_data, tolerance: float = 0.50, model: str = 'hog') -> list:
        """
        Recognize all faces in image_data.

        Performance strategy:
          1. Decode frame
          2. Resize to 0.25x for fast face detection
          3. Run HOG detection on small frame
          4. Compute encodings on small frame
          5. Match against in-memory cache (1 encoding per user)

        Returns list of dicts: user_id, name, box (normalised 0-1), distance, matched.
        """
        if not FACE_RECOGNITION_AVAILABLE:
            return []

        image_rgb = self.decode_image(image_data)
        if image_rgb is None:
            return []

        # ── Resize to 0.25x for fast detection ───────────────────────────────
        if CV2_AVAILABLE:
            small = cv2.resize(image_rgb, (0, 0), fx=0.25, fy=0.25)
        else:
            small, _ = _resize_for_speed(image_rgb, max_w=320)

        sh, sw = small.shape[:2]

        locations = face_recognition.face_locations(small, model=model)
        if not locations:
            return []

        # num_jitters=1: fast, good enough when cache has quality encodings
        encodings = face_recognition.face_encodings(small, locations, num_jitters=1)

        results = []
        for enc, loc in zip(encodings, locations):
            top, right, bottom, left = loc
            box = {
                'top':    top    / sh,
                'right':  right  / sw,
                'bottom': bottom / sh,
                'left':   left   / sw,
            }
            match_result = self._find_best_match(enc, tolerance)
            results.append({**match_result, 'box': box})

        return results

    def _find_best_match(self, encoding, tolerance: float) -> dict:
        """Find best matching user for a face encoding."""
        best_uid      = None
        best_name     = 'Unknown'
        best_distance = float('inf')

        for uid, data in self._cache.items():
            known = data['encodings']
            if not known:
                continue
            distances = face_recognition.face_distance(known, encoding)
            min_dist  = float(np.min(distances))
            if min_dist < best_distance:
                best_distance = min_dist
                best_uid      = uid
                best_name     = data['name']

        matched = best_distance <= tolerance
        return {
            'user_id':  best_uid  if matched else None,
            'name':     best_name if matched else 'Unknown',
            'distance': best_distance if best_distance != float('inf') else 1.0,
            'matched':  matched,
        }
