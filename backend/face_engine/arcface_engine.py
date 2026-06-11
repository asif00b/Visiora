"""
face_engine/arcface_engine.py  —  ArcFace (InsightFace) recognition engine.

Accuracy comparison:
    Dlib (current)       128-d Euclidean       99.38% LFW
    ArcFace buffalo_l    512-d cosine          99.83% LFW  ← this module
    Apple Face ID        proprietary depth     99.9999% (hardware-assisted)

ArcFace uses "Additive Angular Margin" metric learning — the same family of
technology that powers production face recognition at Google, Microsoft, Baidu,
and Apple.  The buffalo_l model is pre-trained on WebFace600K (600K identities).

Key improvements over dlib:
    1. 4× larger embedding space (512-d vs 128-d)
    2. RetinaFace detector — more accurate face bounding boxes
    3. 5-point landmark alignment — normalises pose/angle before encoding
    4. Cosine similarity — invariant to embedding magnitude
    5. Significantly better on non-frontal faces (angled, looking away)

First use downloads ~180 MB of ONNX models to ~/.insightface/models/buffalo_l/
"""

import io
import base64
import importlib.util
import logging
import numpy as np

logger = logging.getLogger(__name__)

# ── Availability check ────────────────────────────────────────────────────────
ARCFACE_AVAILABLE = False
_INIT_ERROR: str  = ''

try:
    from insightface.app import FaceAnalysis
    import onnxruntime  # noqa: F401 — ensure present
    ARCFACE_AVAILABLE = True
except ImportError as _e:
    _INIT_ERROR = str(_e)

CV2_AVAILABLE = importlib.util.find_spec('cv2') is not None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalise(emb: np.ndarray) -> np.ndarray:
    """L2-normalise to unit vector (safe)."""
    n = float(np.linalg.norm(emb))
    return emb / n if n > 1e-10 else emb


def _cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
    """1 - cosine-similarity.  0 = identical, ~1.4 = completely different."""
    return float(1.0 - np.dot(_normalise(a), _normalise(b)))


def _batch_cosine_distance(knowns: list, probe: np.ndarray) -> np.ndarray:
    """Vectorised cosine distances: probe vs all knowns."""
    if not knowns:
        return np.array([])
    K = np.vstack([_normalise(k) for k in knowns])   # (N, 512)
    p = _normalise(probe)                              # (512,)
    return 1.0 - (K @ p)                              # (N,)


def _box_to_dict(b, image_shape=None) -> dict:
    if image_shape:
        h, w = image_shape[:2]
        return {
            'left':   float(b[0]) / w,
            'top':    float(b[1]) / h,
            'right':  float(b[2]) / w,
            'bottom': float(b[3]) / h,
        }
    return {'left': float(b[0]), 'top': float(b[1]),
            'right': float(b[2]), 'bottom': float(b[3])}


def _landmarks_to_dict(face, image_shape) -> dict:
    kps = getattr(face, 'kps', None)
    if kps is None or len(kps) < 2:
        return {}
    h, w = image_shape[:2]
    return {
        'left_eye':  {'x': float(kps[0][0]) / w, 'y': float(kps[0][1]) / h},
        'right_eye': {'x': float(kps[1][0]) / w, 'y': float(kps[1][1]) / h},
    }


def _decode_b64_to_rgb(image_data: str):
    """Decode base64 JPEG/PNG to RGB numpy array (H,W,3)."""
    if image_data.startswith('data:'):
        image_data = image_data.split(',', 1)[1]
    raw = base64.b64decode(image_data)
    if CV2_AVAILABLE:
        import cv2
        nparr = np.frombuffer(raw, np.uint8)
        bgr   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if bgr is None:
            return None
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    else:
        from PIL import Image
        img = Image.open(io.BytesIO(raw)).convert('RGB')
        return np.array(img)


# ── ArcFace Engine ────────────────────────────────────────────────────────────

class ArcFaceEngine:
    """
    Drop-in replacement for FaceEngine (dlib) using InsightFace ArcFace.

    Public interface is identical to FaceEngine so no route changes are needed.
    """

    _instance: 'ArcFaceEngine | None' = None

    # Matches dlib engine class-level constant
    MAX_ENCODINGS_PER_USER: int = 15

    # ArcFace recommended default thresholds (cosine distance)
    # Lower = stricter (fewer false positives, more false negatives)
    DEFAULT_TOLERANCE: float = 0.40   # equivalent to ~90% cosine similarity

    @classmethod
    def get_instance(cls) -> 'ArcFaceEngine':
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self._cache: dict = {}   # {user_id: {'name': str, 'encodings': [np512]}}
        self._app   = None
        self._ready = False
        self._model_name = 'buffalo_l'

        if not ARCFACE_AVAILABLE:
            logger.warning(f'[ArcFace] InsightFace not available: {_INIT_ERROR}')
            return

        try:
            # Try GPU first (CUDA), fall back to CPU automatically
            providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
            self._app = FaceAnalysis(name=self._model_name, providers=providers)
            # ctx_id=0 = GPU, ctx_id=-1 = CPU
            self._app.prepare(ctx_id=0, det_size=(640, 640))
            self._ready = True
            gpu = any('CUDA' in str(p) for p in self._app.models)
            logger.info(f'[ArcFace] buffalo_l loaded | GPU={gpu} | det_size=640')
        except Exception as e:
            logger.error(f'[ArcFace] Init failed: {e}')
            self._ready = False

    # ── Properties ────────────────────────────────────────────────────────────

    @property
    def available(self) -> bool:
        return self._ready

    @property
    def gpu_available(self) -> bool:
        return False  # actual GPU detection done in _init

    @property
    def recommended_model(self) -> str:
        return 'arcface-buffalo_l'

    @property
    def backend(self) -> str:
        return 'arcface'

    def cache_size(self) -> int:
        return len([uid for uid, v in self._cache.items() if v['encodings']])

    # ── Image decoding ────────────────────────────────────────────────────────

    def decode_image(self, image_data: str):
        return _decode_b64_to_rgb(image_data)

    # ── Core: single-face encoding ────────────────────────────────────────────

    def _get_face_embedding(self, image_rgb: np.ndarray):
        """
        Detect the largest / most confident face and return (embedding, bbox).
        embedding: normalised 512-d numpy array
        bbox:      [x1, y1, x2, y2]
        Returns (None, None) if no face found.
        """
        if not self._ready:
            return None, None
        faces = self._app.get(image_rgb)
        if not faces:
            return None, None
        # Pick the most confident detection
        face = max(faces, key=lambda f: float(f.det_score))
        return np.array(face.normed_embedding), face.bbox

    # ── Registration encoding ─────────────────────────────────────────────────

    def encode_face_for_registration(
        self,
        image_rgb: np.ndarray,
        model: str = 'hog',          # ignored — ArcFace uses RetinaFace
        min_face_size: int = 40,
        num_jitters: int = 2,        # ignored — ONNX is deterministic
    ) -> dict:
        """
        Encode a single image for registration storage.
        Returns dict matching FaceEngine.encode_face_for_registration().
        """
        if not self._ready:
            return {'success': False, 'message': 'ArcFace engine not initialised', 'encoding': None, 'face_box': None}

        faces = self._app.get(image_rgb)
        if not faces:
            return {'success': False, 'message': 'No face detected in image', 'encoding': None, 'face_box': None}

        h, w = image_rgb.shape[:2]
        # Filter by minimum face size
        faces = [f for f in faces
                 if (f.bbox[2] - f.bbox[0]) >= min_face_size
                 and (f.bbox[3] - f.bbox[1]) >= min_face_size]
        if not faces:
            return {'success': False, 'message': f'Face too small (min {min_face_size}px)', 'encoding': None, 'face_box': None}

        if len(faces) > 1:
            return {'success': False, 'message': f'{len(faces)} faces detected — use single-person images', 'encoding': None, 'face_box': None}

        face     = faces[0]
        emb      = np.array(face.normed_embedding)   # already L2-normalised
        bbox     = face.bbox                          # [x1,y1,x2,y2]
        det_conf = float(face.det_score)

        return {
            'success':    True,
            'encoding':   emb,
            'face_box':   _box_to_dict(bbox),
            'message':    f'ArcFace OK (det_score={det_conf:.3f})',
        }

    # ── Cache management ──────────────────────────────────────────────────────

    def load_from_db(self):
        """Load ALL face encodings (512-d ArcFace) from the database into memory."""
        if not self._ready:
            return
        from models.face_encoding import FaceEncoding
        from models.user import User
        from sqlalchemy import case

        self._cache.clear()

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

        loaded = user_count = skipped = 0
        for enc in all_encodings:
            uid = enc.user_id
            raw = enc.get_encoding()
            if raw is None:
                continue

            arr = np.array(raw)

            # ── Dimension check ─────────────────────────────────────────────
            # ArcFace = 512-d, dlib = 128-d.  Skip mismatched encodings.
            if arr.shape[0] != 512:
                skipped += 1
                continue

            if uid not in self._cache:
                self._cache[uid] = {
                    'name':      enc.user.name if enc.user else f'User {uid}',
                    'encodings': [],
                }
                user_count += 1

            if len(self._cache[uid]['encodings']) >= self.MAX_ENCODINGS_PER_USER:
                continue

            self._cache[uid]['encodings'].append(arr)
            loaded += 1

        logger.info(
            f'[ArcFace] Cache loaded — {loaded} 512-d encoding(s) for '
            f'{user_count} user(s). Skipped {skipped} incompatible (128-d) encoding(s).'
        )

    def add_to_cache(self, user_id: int, name: str, encoding_array):
        """Replace cache for one user with a single encoding."""
        self._cache[user_id] = {
            'name':      name,
            'encodings': [np.array(encoding_array)],
        }

    def add_encodings_to_cache(self, user_id: int, name: str, encoding_arrays: list) -> int:
        """Append new encodings (with dedup) to existing cache entry."""
        if user_id not in self._cache:
            self._cache[user_id] = {'name': name, 'encodings': []}
        existing = self._cache[user_id]['encodings']
        added = 0
        for arr in encoding_arrays:
            narr = _normalise(np.array(arr))
            if existing:
                dists = _batch_cosine_distance(existing, narr)
                if float(np.min(dists)) < 0.30:   # very tight dedup for ArcFace
                    continue
            if len(existing) < self.MAX_ENCODINGS_PER_USER:
                existing.append(narr)
                added += 1
        return added

    def compare_encodings(self, known_list: list, probe) -> np.ndarray:
        """
        Engine-agnostic comparison: returns cosine distances between
        each known encoding and the probe.

        Args:
            known_list: list of numpy arrays (512-d ArcFace embeddings)
            probe:      numpy array (512-d)

        Returns:
            numpy array of distances (0 = identical, 1 = opposite)
        """
        if not known_list:
            return np.array([])
        probe_arr = _normalise(np.array(probe))
        return _batch_cosine_distance(known_list, probe_arr)

    def remove_from_cache(self, user_id: int):
        self._cache.pop(user_id, None)

    # ── Recognition ──────────────────────────────────────────────────────────

    def recognize(
        self,
        image_data: str,
        tolerance: float = 0.40,
        model: str = 'hog',
        include_embeddings: bool = False,
        image_rgb=None,
    ) -> list:
        """
        Detect and identify all faces in an image.

        Returns list of dicts identical to FaceEngine.recognize():
            {
                'matched':   bool,
                'user_id':   int | None,
                'name':      str,
                'distance':  float,   # cosine distance (0 = perfect match)
                'box':       dict,
            }
        """
        if not self._ready:
            return []

        image_rgb = image_rgb if image_rgb is not None else self.decode_image(image_data)
        if image_rgb is None:
            logger.warning('[ArcFace] recognize: image decode failed')
            return []

        faces = self._app.get(image_rgb)
        if not faces:
            return []

        # Prepare known encodings for vectorised comparison
        user_ids   = sorted(self._cache.keys())
        known_vecs = []
        uid_map    = []   # parallel list: which user_id each vector belongs to

        for uid in user_ids:
            for enc in self._cache[uid]['encodings']:
                known_vecs.append(_normalise(enc))
                uid_map.append(uid)

        results = []

        for face in faces:
            probe    = _normalise(np.array(face.normed_embedding))
            det_conf = float(face.det_score)
            bbox     = face.bbox

            if not known_vecs:
                result = {
                    'matched':  False,
                    'user_id':  None,
                    'name':     'Unknown',
                    'distance': 1.0,
                    'box':      _box_to_dict(bbox, image_rgb.shape),
                    'det_score': det_conf,
                }
                if include_embeddings:
                    result['_embedding'] = probe
                    result['landmarks'] = _landmarks_to_dict(face, image_rgb.shape)
                results.append(result)
                continue

            # Vectorised cosine distances
            all_dists = _batch_cosine_distance(known_vecs, probe)

            best_idx  = int(np.argmin(all_dists))
            best_dist = float(all_dists[best_idx])
            best_uid  = uid_map[best_idx]

            if best_dist <= tolerance:
                result = {
                    'matched':   True,
                    'user_id':   best_uid,
                    'name':      self._cache[best_uid]['name'],
                    'distance':  round(best_dist, 4),
                    'box':       _box_to_dict(bbox, image_rgb.shape),
                    'det_score': round(det_conf, 3),
                }
            else:
                result = {
                    'matched':   False,
                    'user_id':   None,
                    'name':      'Unknown',
                    'distance':  round(best_dist, 4),
                    'box':       _box_to_dict(bbox, image_rgb.shape),
                    'det_score': round(det_conf, 3),
                }

            if include_embeddings:
                result['_embedding'] = probe
                result['landmarks'] = _landmarks_to_dict(face, image_rgb.shape)
            results.append(result)

        return results

    # ── Unknown face deduplication ────────────────────────────────────────────

    def is_duplicate_unknown(self, encoding_array, threshold: float = 0.45) -> bool:
        """Check if an encoding is too similar to any cached known face."""
        if not self._cache:
            return False
        probe = _normalise(np.array(encoding_array))
        all_known = [e for v in self._cache.values() for e in v['encodings']]
        if not all_known:
            return False
        dists = _batch_cosine_distance(all_known, probe)
        return bool(np.min(dists) < threshold)

    def get_unknown_encoding(self, image_data: str):
        """Encode an unknown face image for deduplication storage."""
        image_rgb = self.decode_image(image_data)
        if image_rgb is None:
            return None
        emb, _ = self._get_face_embedding(image_rgb)
        return emb.tolist() if emb is not None else None


# ── Convenience: check if arcface is set up ───────────────────────────────────

def arcface_available() -> bool:
    return ARCFACE_AVAILABLE


def arcface_ready() -> bool:
    """Returns True only if the model files are downloaded and loaded."""
    if not ARCFACE_AVAILABLE:
        return False
    try:
        eng = ArcFaceEngine.get_instance()
        return eng.available
    except Exception:
        return False
