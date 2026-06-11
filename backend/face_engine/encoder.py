"""
Face Recognition Engine — v6.1
--------------------------------
Singleton with in-memory encoding cache for fast recognition.

Key design decisions:
  - Registration uses HOG by default (reliable on webcam JPEG frames).
    CNN is used if GPU is detected (admin-configurable).
  - Multi-angle merged encoding: takes all valid registration photos,
    produces a WEIGHTED-AVERAGE encoding (weight = quality_score).
    This single merged encoding is far more robust than any single photo.
  - num_jitters=3 for registration (quality), =1 for recognition (speed).
  - Image preprocessing (CLAHE + upscale) before detection.
  - Blur detection and face-size validation provide clear user feedback.
  - Structured logging: every recognition logged with distance + timing.
"""

import os
import base64
import time
import logging
from io import BytesIO

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

# ── GPU / model detection ─────────────────────────────────────────────────────

def _detect_gpu() -> bool:
    """Return True if a CUDA-capable GPU is available for dlib/CNN."""
    try:
        import dlib
        return dlib.DLIB_USE_CUDA
    except Exception:
        return False

GPU_AVAILABLE = _detect_gpu()
BEST_MODEL    = 'cnn' if GPU_AVAILABLE else 'hog'

logger.info(
    f'[FaceEngine] GPU detected: {GPU_AVAILABLE} — '
    f'default model: {BEST_MODEL.upper()}'
)


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

    # Upscale small frames
    if w < 640:
        scale = 640 / w
        image_rgb = cv2.resize(
            image_rgb, (640, int(h * scale)), interpolation=cv2.INTER_CUBIC
        )

    # CLAHE on L channel only (doesn't shift hue, just boosts contrast)
    lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_ch  = clahe.apply(l_ch)
    lab   = cv2.merge([l_ch, a_ch, b_ch])
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


def normalize_face_box(face_box) -> tuple | None:
    """
    Convert a face bounding box from any engine format to a
    consistent (top, right, bottom, left) tuple.

    Accepts:
        - tuple/list (top, right, bottom, left)  — dlib / face_recognition
        - dict {left, top, right, bottom}         — ArcFace / InsightFace
        - dict {top, right, bottom, left}         — normalised dict

    Returns (top, right, bottom, left) tuple, or None on failure.
    """
    if face_box is None:
        return None
    try:
        if isinstance(face_box, dict):
            # ArcFace uses absolute pixel coords: {left, top, right, bottom}
            top    = face_box.get('top',    face_box.get('y1', 0))
            right  = face_box.get('right',  face_box.get('x2', 0))
            bottom = face_box.get('bottom', face_box.get('y2', 0))
            left   = face_box.get('left',   face_box.get('x1', 0))
            return (int(float(top)), int(float(right)), int(float(bottom)), int(float(left)))
            
        if isinstance(face_box, (tuple, list)) and len(face_box) == 4:
            return tuple(int(float(v)) for v in face_box)  # already (top,right,bottom,left)
    except Exception as e:
        logger.error(f"Error in normalize_face_box: {e}")
    return None


def _eye_centers(landmarks: dict, width: int, height: int) -> dict:
    def center(points):
        if not points:
            return None
        arr = np.array(points, dtype=float)
        return {
            'x': float(np.mean(arr[:, 0]) / width),
            'y': float(np.mean(arr[:, 1]) / height),
        }

    left = center(landmarks.get('left_eye', []))
    right = center(landmarks.get('right_eye', []))
    return {'left_eye': left, 'right_eye': right} if left and right else {}


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

    gray      = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    face_crop = gray[top:bottom, left:right]

    # 1. Sharpness (Laplacian variance) — normalised; ~200+ is sharp for a webcam
    sharpness_raw = float(cv2.Laplacian(face_crop, cv2.CV_64F).var())
    sharpness     = min(1.0, sharpness_raw / 200.0)

    # 2. Face size — ratio of face area to total image area
    face_area  = (bottom - top) * (right - left)
    image_area = h_img * w_img
    face_size  = min(1.0, (face_area / image_area) * 10.0)  # scale so 10% = 1.0

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
    """
    if not candidates:
        return None
    return max(candidates, key=lambda c: c['quality_score'])


def merge_encodings(candidates: list) -> np.ndarray | None:
    """
    Produce a weighted-average encoding from all valid candidates.
    Weight = quality_score of each candidate.

    This merged encoding is far more robust than any single photo because
    it captures multiple angles/lighting conditions in one vector.

    Args:
        candidates: list of dicts with 'encoding' (np.ndarray) and
                    'quality_score' (float).

    Returns:
        numpy array (128-d) or None if no candidates.
    """
    if not candidates:
        return None

    if len(candidates) == 1:
        return np.array(candidates[0]['encoding'])

    weights   = np.array([max(c['quality_score'], 0.01) for c in candidates])
    encodings = np.array([c['encoding'] for c in candidates])

    # Weighted average across the 128 dimensions
    merged = np.average(encodings, axis=0, weights=weights)

    # L2-normalize for consistent distance comparisons
    norm = np.linalg.norm(merged)
    if norm > 0:
        merged = merged / norm

    logger.debug(
        f'[FaceEngine] Merged {len(candidates)} encodings '
        f'(weights: {[round(float(w),3) for w in weights]})'
    )
    return merged


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

    @property
    def gpu_available(self):
        return GPU_AVAILABLE

    @property
    def recommended_model(self):
        return BEST_MODEL

    # ── Cache ─────────────────────────────────────────────────────────────────

    # Maximum encodings stored per user in the recognition cache.
    # More = better accuracy at different angles, but slightly more memory.
    MAX_ENCODINGS_PER_USER = 15

    def load_from_db(self):
        """
        Load ALL face encodings from DB into memory (all per-user records).

        Recognition then compares the probe against EVERY stored encoding and
        takes the closest distance — much more accurate than a single merged
        encoding because each stored vector captures a different pose/lighting.
        """
        if not FACE_RECOGNITION_AVAILABLE:
            return
        from models.face_encoding import FaceEncoding
        from models.user import User

        self._cache.clear()

        # SQLAlchemy 2.0+ case() syntax: case(condition, value=...) or case((when, then), ...)
        from sqlalchemy import case, null
        all_encodings = (
            FaceEncoding.query
            .join(User)
            .filter(User.is_active == True)
            .order_by(
                case(
                    (FaceEncoding.quality_score == None, 1),
                    else_=0
                ).asc(),
                FaceEncoding.quality_score.desc(),
                FaceEncoding.created_at.desc(),
            )
            .all()
        )

        loaded     = 0
        user_count = 0
        for enc in all_encodings:
            uid = enc.user_id
            if uid not in self._cache:
                self._cache[uid] = {
                    'name':      enc.user.name if enc.user else f'User {uid}',
                    'encodings': [],
                }
                user_count += 1

            # Honour per-user cap
            if len(self._cache[uid]['encodings']) >= self.MAX_ENCODINGS_PER_USER:
                continue

            try:
                arr = np.array(enc.get_encoding())
                self._cache[uid]['encodings'].append(arr)
                loaded += 1
            except Exception as e:
                logger.error(f'Error loading encoding id={enc.id}: {e}')

        logger.info(
            f'[FaceEngine] Cache loaded — {loaded} encoding(s) for {user_count} user(s). '
            f'GPU={GPU_AVAILABLE}, Model={BEST_MODEL.upper()}'
        )

    def add_to_cache(self, user_id: int, name: str, encoding_array):
        """
        Set / replace the cache for one user with a single encoding.
        Called after a fresh registration that wiped old encodings.
        """
        self._cache[user_id] = {
            'name':      name,
            'encodings': [np.array(encoding_array)],
        }
        logger.debug(f'[FaceEngine] Cache reset for user_id={user_id} ({name})')

    def add_encodings_to_cache(self, user_id: int, name: str, encoding_arrays: list):
        """
        APPEND multiple new encodings to an existing user's cache entry.
        Used after a dataset upload to extend (not replace) the stored vectors.
        Automatically deduplicates against what is already cached.
        """
        if user_id not in self._cache:
            self._cache[user_id] = {'name': name, 'encodings': []}
        existing = self._cache[user_id]['encodings']
        added = 0
        for arr in encoding_arrays:
            narr = np.array(arr)
            # Skip if too similar to an already-cached encoding
            if existing:
                dists = self.compare_encodings(existing, narr)
                if float(np.min(dists)) < 0.35:   # very tight threshold for cache dedup
                    continue
            if len(existing) < self.MAX_ENCODINGS_PER_USER:
                existing.append(narr)
                added += 1
        logger.debug(
            f'[FaceEngine] Cache extended for user_id={user_id}: +{added} encoding(s) '
            f'(total {len(existing)})'
        )
        return added

    def remove_from_cache(self, user_id: int):
        self._cache.pop(user_id, None)
        logger.debug(f'[FaceEngine] Cache removed for user_id={user_id}')

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
        model: str = 'hog',
        min_face_size: int = 50,
        num_jitters: int = 3,    # Higher = better quality encoding
    ) -> dict:
        """
        Encode exactly ONE face for student registration.

        Strategy:
          1. Pre-process image (CLAHE + upscale)
          2. Try HOG with 2x upsample (catches small/angled faces)
          3. If still no face, try HOG with 1x upsample on original
          4. Validate: exactly 1 face, not too small, not too blurry
          5. Encode with num_jitters=3 (better quality for registration)

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

        # Second fallback: try with 1x upsample
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
            gray          = cv2.cvtColor(processed, cv2.COLOR_RGB2GRAY)
            crop          = gray[top:bottom, left:right]
            blur          = _blur_score(crop)
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

        # ── Step 6: Encode & Landmarks ────────────────────────────────────────
        try:
            encodings = face_recognition.face_encodings(
                processed, [locations[0]], num_jitters=num_jitters
            )
            # Get landmarks for pose/smile
            landmarks = face_recognition.face_landmarks(processed, [locations[0]])
            
            # Map dlib landmarks to our 5-point kpss format:
            # 0: left eye, 1: right eye, 2: nose, 3: left mouth, 4: right mouth
            kpss = []
            if landmarks:
                m = landmarks[0]
                # Helper to get center of a list of points
                def center(pts):
                    return {"x": float(np.mean([p[0] for p in pts])), "y": float(np.mean([p[1] for p in pts]))}
                
                kpss = [
                    center(m.get('left_eye', [])),
                    center(m.get('right_eye', [])),
                    center(m.get('nose_bridge', [])[-1:]), # tip of nose
                    center(m.get('top_lip', [])[:1]),     # left corner
                    center(m.get('top_lip', [])[6:7]),    # right corner
                ]

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
            'kpss':          kpss,
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

    def recognize(
        self,
        image_data,
        tolerance: float = 0.50,
        model: str = 'hog',
        include_embeddings: bool = False,
        image_rgb=None,
        scanner_id: str = 'default',
    ) -> list:
        """
        Recognize all faces in image_data.

        Performance strategy:
          1. Decode frame
          2. Resize to 0.25x for fast face detection
          3. Run HOG detection on small frame
          4. Compute encodings on small frame
          5. Match against in-memory cache (1 merged encoding per user)

        Logs every recognition result (distance, match, timing).

        Returns list of dicts: user_id, name, box (normalised 0-1), distance, matched.
        """
        if not FACE_RECOGNITION_AVAILABLE:
            return []

        t0 = time.monotonic()
        image_rgb = image_rgb if image_rgb is not None else self.decode_image(image_data)
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

        # num_jitters=1: fast (accuracy comes from stored multi-angle encodings)
        encodings = face_recognition.face_encodings(small, locations, num_jitters=1)
        landmarks = (
            face_recognition.face_landmarks(small, locations)
            if include_embeddings else [{} for _ in locations]
        )

        results = []
        for enc, loc, marks in zip(encodings, locations, landmarks):
            top, right, bottom, left = loc
            box = {
                'top':    top    / sh,
                'right':  right  / sw,
                'bottom': bottom / sh,
                'left':   left   / sw,
            }
            match_result = self._find_best_match(enc, tolerance)

            # Structured confidence log
            elapsed_ms = round((time.monotonic() - t0) * 1000, 1)
            logger.debug(
                f'[Recognize] matched={match_result["matched"]} '
                f'user={match_result.get("user_id")} '
                f'distance={round(match_result["distance"], 4)} '
                f'model={model} '
                f'time={elapsed_ms}ms'
            )

            result = {**match_result, 'box': box}
            if include_embeddings:
                result['_embedding'] = enc
                result['landmarks'] = _eye_centers(marks, sw, sh)

            results.append(result)

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

    # ── Unknown face similarity ───────────────────────────────────────────────

    def is_duplicate_unknown(
        self,
        new_encoding: np.ndarray,
        existing_encodings: list,
        threshold: float = 0.6,
    ) -> bool:
        """
        Check if a new unknown-face encoding is a duplicate of any
        already-stored unknown face.

        Args:
            new_encoding:       128-d numpy array of the new face.
            existing_encodings: list of 128-d numpy arrays to compare against.
            threshold:          if distance < threshold, consider duplicate.

        Returns:
            True if a duplicate is found (do NOT save), False if new.
        """
        if not FACE_RECOGNITION_AVAILABLE or not existing_encodings:
            return False

        try:
            existing_arr = np.array(existing_encodings)
            distances    = face_recognition.face_distance(existing_arr, new_encoding)
            min_dist     = float(np.min(distances))
            is_dup       = min_dist < threshold
            logger.debug(
                f'[UnknownDedup] min_distance={round(min_dist, 4)} '
                f'threshold={threshold} duplicate={is_dup}'
            )
            return is_dup
        except Exception as e:
            logger.error(f'[UnknownDedup] Error during comparison: {e}')
            return False

    def compare_encodings(self, known_list: list, probe) -> np.ndarray:
        """
        Engine-agnostic comparison: returns Euclidean face distances between
        each known encoding and the probe.

        Args:
            known_list: list of numpy arrays (128-d dlib embeddings)
            probe:      numpy array (128-d)

        Returns:
            numpy array of distances (0 = identical match)
        """
        if not FACE_RECOGNITION_AVAILABLE or not known_list:
            return np.array([])
        try:
            known_arr = np.array([np.array(k) for k in known_list])
            return face_recognition.face_distance(known_arr, np.array(probe))
        except Exception as e:
            logger.error(f'[FaceEngine] compare_encodings error: {e}')
            return np.array([])
