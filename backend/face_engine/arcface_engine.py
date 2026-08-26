"""InsightFace ArcFace engine with an in-memory FAISS cosine index."""

import base64
import io
import logging
import os
from threading import RLock

import numpy as np

logger = logging.getLogger(__name__)

ARCFACE_AVAILABLE = False
_INIT_ERROR = ""
# ── Register Nvidia CUDA/cuDNN DLL paths for Windows ──────────────────────────
import sys
if sys.platform == 'win32':
    for path in sys.path:
        abs_path = os.path.abspath(path)
        if 'site-packages' in abs_path:
            # 1. Register nvidia CUDA/cuDNN DLLs
            nvidia_base = os.path.join(abs_path, 'nvidia')
            if os.path.exists(nvidia_base):
                for root, dirs, files in os.walk(nvidia_base):
                    if 'bin' in dirs:
                        bin_dir = os.path.abspath(os.path.join(root, 'bin'))
                        if any(f.endswith('.dll') for f in os.listdir(bin_dir)):
                            try:
                                os.add_dll_directory(bin_dir)
                            except Exception:
                                pass
            # 2. Register onnxruntime/capi DLLs in PATH and DLL directory (for dynamic cuDNN sub-DLL loading)
            ort_capi = os.path.abspath(os.path.join(abs_path, 'onnxruntime', 'capi'))
            if os.path.exists(ort_capi):
                os.environ['PATH'] = ort_capi + os.pathsep + os.environ['PATH']
                try:
                    os.add_dll_directory(ort_capi)
                except Exception:
                    pass

try:
    from insightface.app import FaceAnalysis
    from insightface.utils import face_align
    import onnxruntime as ort

    ARCFACE_AVAILABLE = True
except ImportError as exc:
    _INIT_ERROR = str(exc)

try:
    import cv2

    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

try:
    import faiss

    FAISS_AVAILABLE = True
except ImportError:
    faiss = None
    FAISS_AVAILABLE = False


def _normalise(emb: np.ndarray) -> np.ndarray:
    emb = np.asarray(emb, dtype=np.float32)
    norm = float(np.linalg.norm(emb))
    return emb / norm if norm > 1e-10 else emb


def _box_to_dict(b, image_shape=None) -> dict:
    if image_shape:
        h, w = image_shape[:2]
        return {
            "left": float(b[0]) / w,
            "top": float(b[1]) / h,
            "right": float(b[2]) / w,
            "bottom": float(b[3]) / h,
        }
    return {
        "left": float(b[0]),
        "top": float(b[1]),
        "right": float(b[2]),
        "bottom": float(b[3]),
    }


def _decode_b64_to_rgb(image_data: str):
    if image_data.startswith("data:"):
        image_data = image_data.split(",", 1)[1]
    raw = base64.b64decode(image_data)
    if CV2_AVAILABLE:
        nparr = np.frombuffer(raw, np.uint8)
        bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if bgr is None:
            return None
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    from PIL import Image

    img = Image.open(io.BytesIO(raw)).convert("RGB")
    return np.array(img)


class EmbeddingsDB:
    def __init__(self):
        self.known_matrix = None
        self.known_ids = np.array([], dtype=object)
        self.index = None
        self.lock = RLock()

    def build_index(self, cache_dict):
        vecs, ids = [], []
        for uid, user_data in cache_dict.items():
            for emb in user_data["encodings"]:
                vec = _normalise(emb)
                if vec.shape[0] != 512:
                    continue
                vecs.append(vec)
                ids.append(int(uid))

        with self.lock:
            if not vecs:
                self.known_matrix = None
                self.known_ids = np.array([], dtype=object)
                self.index = None
                return

            matrix = np.ascontiguousarray(np.vstack(vecs).astype("float32"))
            self.known_matrix = matrix
            self.known_ids = np.array(ids, dtype=object)

            if FAISS_AVAILABLE:
                idx = faiss.IndexFlatIP(matrix.shape[1])
                idx.add(matrix)
                self.index = idx
            else:
                self.index = None

    def match(self, probe_emb, tolerance=0.40):
        probe = _normalise(probe_emb)
        with self.lock:
            if self.known_matrix is None or len(self.known_ids) == 0:
                return "Unknown", 0.0, 1.0

            probe_matrix = np.ascontiguousarray(probe.reshape(1, -1).astype("float32"))
            if self.index is not None:
                similarities, indexes = self.index.search(probe_matrix, 1)
                best_idx = int(indexes[0][0])
                best_sim = float(similarities[0][0])
            else:
                similarities = np.dot(self.known_matrix, probe)
                best_idx = int(np.argmax(similarities))
                best_sim = float(similarities[best_idx])

            best_dist = 1.0 - best_sim
            if best_dist <= tolerance:
                return int(self.known_ids[best_idx]), best_sim * 100, best_dist
            return "Unknown", best_sim * 100, best_dist

    def find_matches(self, probe_emb, tolerance=0.40, top_k=3):
        uid, conf, dist = self.match(probe_emb, tolerance=tolerance)
        if uid != "Unknown":
            return [{"user_id": uid, "confidence": conf, "distance": dist}]
        return []

    def compare(self, known_list, probe):
        if not known_list:
            return np.array([])
        probe = _normalise(probe)
        known = np.asarray([_normalise(k) for k in known_list], dtype=np.float32)
        if known.ndim != 2 or known.shape[1] != probe.shape[0]:
            return np.array([])
        return 1.0 - np.dot(known, probe)


class ArcFaceEngine:
    _instance = None
    MAX_ENCODINGS_PER_USER = int(os.environ.get("MAX_ENCODINGS_PER_USER", "15"))
    DEFAULT_TOLERANCE = float(os.environ.get("ARCFACE_TOLERANCE", "0.40"))

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self._cache = {}
        self._db = EmbeddingsDB()
        self._app = None
        self._ready = False
        self._provider = "unavailable"
        self._model_name = os.environ.get("INSIGHTFACE_MODEL", "buffalo_s")
        self._det_size = int(os.environ.get("INSIGHTFACE_DET_SIZE", "640"))

        if not ARCFACE_AVAILABLE:
            logger.warning("[ArcFace] Not available: %s", _INIT_ERROR)
            return

        self._ready = self._init_model()

    def _init_model(self):
        force_cpu = os.environ.get("ARCFACE_FORCE_CPU", "false").lower() == "true"
        available = set(ort.get_available_providers())
        use_cuda = "CUDAExecutionProvider" in available and not force_cpu
        providers = (
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
            if use_cuda
            else ["CPUExecutionProvider"]
        )
        ctx_id = 0 if use_cuda else -1

        det_thresh = float(os.environ.get("INSIGHTFACE_DET_THRESH", "0.45"))
        try:
            self._app = FaceAnalysis(
                name=self._model_name,
                providers=providers,
                allowed_modules=["detection", "recognition", "landmark_2d_106"],
            )
            self._app.prepare(ctx_id=ctx_id, det_thresh=det_thresh, det_size=(self._det_size, self._det_size))
        except Exception as exc:
            if use_cuda:
                logger.warning("[ArcFace] CUDA init failed, retrying CPU: %s", exc)
                self._app = FaceAnalysis(
                    name=self._model_name,
                    providers=["CPUExecutionProvider"],
                    allowed_modules=["detection", "recognition", "landmark_2d_106"],
                )
                self._app.prepare(ctx_id=-1, det_thresh=det_thresh, det_size=(self._det_size, self._det_size))
            else:
                logger.error("[ArcFace] Init failed: %s", exc)
                return False

        self._provider = self._active_provider()
        self._warmup()
        logger.info(
            "[ArcFace] %s ready | provider=%s | det_size=%s | faiss=%s",
            self._model_name,
            self._provider,
            self._det_size,
            FAISS_AVAILABLE,
        )
        return True

    def _active_provider(self):
        try:
            providers = set()
            for model in self._app.models.values():
                session = getattr(model, "session", None)
                if session is not None:
                    providers.update(session.get_providers())
            if "CUDAExecutionProvider" in providers:
                return "CUDAExecutionProvider"
            if providers:
                return sorted(providers)[0]
        except Exception:
            pass
        return "CPUExecutionProvider"

    def _warmup(self):
        try:
            dummy = np.zeros((self._det_size, self._det_size, 3), dtype=np.uint8)
            self._app.det_model.detect(dummy, max_num=1)
        except Exception:
            pass

    @property
    def available(self):
        return self._ready

    @property
    def gpu_available(self):
        return self._provider == "CUDAExecutionProvider"

    @property
    def recommended_model(self):
        return f"arcface-{self._model_name}"

    @property
    def backend(self):
        return "arcface"

    def cache_size(self):
        return sum(len(v["encodings"]) for v in self._cache.values())

    def decode_image(self, image_data: str):
        return _decode_b64_to_rgb(image_data)

    def _get_face_embedding(self, image_rgb: np.ndarray):
        if not self._ready:
            return None, None
        faces = self._app.get(image_rgb)
        if not faces:
            return None, None
        face = max(faces, key=lambda f: float(f.det_score))
        return np.array(face.normed_embedding, dtype=np.float32), face.bbox

    def encode_face_for_registration(
        self, image_rgb: np.ndarray, model="hog", min_face_size=40, num_jitters=2
    ):
        if not self._ready:
            return {
                "success": False,
                "message": "Engine not ready",
                "encoding": None,
                "face_box": None,
            }

        faces = self._app.get(image_rgb)
        if not faces:
            return {
                "success": False,
                "message": "No face detected",
                "encoding": None,
                "face_box": None,
            }

        faces = [
            f
            for f in faces
            if (f.bbox[2] - f.bbox[0]) >= min_face_size
            and (f.bbox[3] - f.bbox[1]) >= min_face_size
        ]
        if not faces:
            return {
                "success": False,
                "message": "Face too small",
                "encoding": None,
                "face_box": None,
            }
        if len(faces) > 1:
            return {
                "success": False,
                "message": "Multiple faces detected",
                "encoding": None,
                "face_box": None,
            }

        face = faces[0]
        # Convert InsightFace kps (keypoints) to a serializable list of dicts
        kpss = [{"x": float(p[0]), "y": float(p[1])} for p in face.kps] if hasattr(face, 'kps') else []

        return {
            "success": True,
            "encoding": np.array(face.normed_embedding, dtype=np.float32),
            "face_box": _box_to_dict(face.bbox),
            "kpss": kpss,
            "message": f"ArcFace OK (det_score={float(face.det_score):.3f})",
        }

    def load_from_db(self):
        if not self._ready:
            return
        from models.face_encoding import FaceEncoding
        from models.user import User
        from sqlalchemy import case

        self._cache.clear()
        all_encodings = (
            FaceEncoding.query.join(User)
            .filter(User.is_active == True)
            .order_by(
                case((FaceEncoding.quality_score == None, 1), else_=0).asc(),
                FaceEncoding.quality_score.desc(),
                FaceEncoding.created_at.desc(),
            )
            .all()
        )

        loaded = user_count = skipped = 0
        for enc in all_encodings:
            uid = int(enc.user_id)
            try:
                arr = np.array(enc.get_encoding(), dtype=np.float32)
            except Exception:
                skipped += 1
                continue

            if arr.shape[0] != 512:
                skipped += 1
                continue

            if uid not in self._cache:
                self._cache[uid] = {
                    "name": enc.user.name if enc.user else f"User {uid}",
                    "encodings": [],
                }
                user_count += 1
            if len(self._cache[uid]["encodings"]) >= self.MAX_ENCODINGS_PER_USER:
                continue

            self._cache[uid]["encodings"].append(_normalise(arr))
            loaded += 1

        self._db.build_index(self._cache)
        logger.info(
            "[ArcFace] DB loaded: %s encodings | %s users | skipped %s",
            loaded,
            user_count,
            skipped,
        )

    def add_to_cache(self, user_id: int, name: str, encoding_array):
        self._cache[int(user_id)] = {
            "name": name,
            "encodings": [_normalise(np.array(encoding_array))],
        }
        self._db.build_index(self._cache)

    def add_encodings_to_cache(self, user_id: int, name: str, encoding_arrays: list) -> int:
        user_id = int(user_id)
        if user_id not in self._cache:
            self._cache[user_id] = {"name": name, "encodings": []}
        existing = self._cache[user_id]["encodings"]
        added = 0
        for arr in encoding_arrays:
            narr = _normalise(np.array(arr))
            if narr.shape[0] != 512:
                continue
            if existing:
                dists = self.compare_encodings(existing, narr)
                if len(dists) and float(np.min(dists)) < 0.12:
                    continue
            if len(existing) < self.MAX_ENCODINGS_PER_USER:
                existing.append(narr)
                added += 1
        self._db.build_index(self._cache)
        return added

    def remove_from_cache(self, user_id: int):
        self._cache.pop(int(user_id), None)
        self._db.build_index(self._cache)

    def recognize(
        self,
        image_data: str,
        tolerance: float = 0.40,
        model: str = "hog",
        include_embeddings: bool = False,
        image_rgb=None,
        scanner_id="default",
    ) -> list:
        if not self._ready:
            return []
        image_rgb = image_rgb if image_rgb is not None else self.decode_image(image_data)
        if image_rgb is None:
            return []

        from face_engine.tracker_pipeline import TrackingPipeline

        pipeline = TrackingPipeline.get_instance()

        def detector_func(frame):
            faces = self._app.get(frame)
            bboxes = []
            kpss = []
            for f in faces:
                score = float(getattr(f, 'det_score', 0.99))
                b = [float(f.bbox[0]), float(f.bbox[1]), float(f.bbox[2]), float(f.bbox[3]), score]
                bboxes.append(b)
                c5 = getattr(f, 'kps', None)
                l106 = getattr(f, 'landmark_2d_106', c5)
                if c5 is not None:
                    kpss.append({'canonical_5': c5, 'landmarks_106': l106 if l106 is not None else c5})
                else:
                    kpss.append(None)
            if bboxes:
                bboxes = np.array(bboxes, dtype=np.float32)
            else:
                bboxes = np.empty((0, 5), dtype=np.float32)
            return bboxes, kpss

        def recognizer_func(frame, crops_info):
            results = []
            for bbox, kps_data in crops_info:
                if kps_data is None:
                    results.append(_unknown_result())
                    continue

                try:
                    align_kps = kps_data.get('canonical_5') if isinstance(kps_data, dict) else kps_data
                    if align_kps is None:
                        results.append(_unknown_result())
                        continue

                    aligned = face_align.norm_crop(frame, landmark=np.asarray(align_kps[:5], dtype=np.float32), image_size=112)
                    if CV2_AVAILABLE and cv2.Laplacian(aligned, cv2.CV_64F).var() < 45:
                        results.append(_unknown_result())
                        continue

                    emb = self._app.models["recognition"].get_feat(aligned)[0]
                    uid, conf, dist = self._db.match(emb, tolerance)
                    name = self._cache[int(uid)]["name"] if uid != "Unknown" else "Unknown"
                    result = {
                        "user_id": uid,
                        "confidence": conf,
                        "name": name,
                        "distance": dist,
                    }
                    if include_embeddings:
                        result["_embedding"] = np.asarray(emb, dtype=np.float32).tolist()
                    results.append(result)
                except Exception as exc:
                    logger.debug("[ArcFace] Recognition crop skipped: %s", exc)
                    results.append(_unknown_result())
            return results

        return pipeline.process_frame(scanner_id, image_rgb, detector_func, recognizer_func)

    def compare_encodings(self, known_list: list, probe) -> np.ndarray:
        return self._db.compare(known_list, probe)

    def find_matches(self, probe_emb, tolerance=0.40, top_k=3):
        return self._db.find_matches(probe_emb, tolerance=tolerance, top_k=top_k)

    def is_duplicate_unknown(
        self,
        new_encoding: np.ndarray,
        existing_encodings: list,
        threshold: float = 0.45,
    ) -> bool:
        """Check if new_encoding is a duplicate of any in existing_encodings.

        Matches the dlib FaceEngine signature so callers (e.g. admin cleanup)
        can use either engine interchangeably.
        """
        if not existing_encodings:
            return False
        dists = self.compare_encodings(existing_encodings, new_encoding)
        if len(dists) == 0:
            return False
        return float(np.min(dists)) < threshold

    def get_unknown_encoding(self, image_data: str):
        image_rgb = self.decode_image(image_data)
        if image_rgb is None:
            return None
        emb, _ = self._get_face_embedding(image_rgb)
        return emb.tolist() if emb is not None else None


def _unknown_result():
    return {
        "user_id": "Unknown",
        "confidence": 0,
        "name": "Unknown",
        "distance": 1.0,
    }


def arcface_available() -> bool:
    return ARCFACE_AVAILABLE


def arcface_ready() -> bool:
    return ARCFACE_AVAILABLE and ArcFaceEngine.get_instance().available
