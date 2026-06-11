"""
face_engine/engine_factory.py  —  Select the best available face recognition engine.

Priority order:
    1. ArcFace (InsightFace buffalo_l) — 99.83% LFW accuracy
    2. dlib / face_recognition        — 99.38% LFW accuracy (fallback)

The active engine is determined by:
    a) SystemConfig key 'face_engine_backend'  (admin can override)
    b) Auto-detect: try ArcFace first, fall back to dlib if unavailable

All routes call get_engine() — never import FaceEngine or ArcFaceEngine directly.
"""

import logging

logger = logging.getLogger(__name__)

_cached_engine = None   # module-level singleton (reset on config change)


def get_engine():
    """
    Return the best available face recognition engine, using SystemConfig
    if the DB is reachable (otherwise auto-detect).
    """
    global _cached_engine
    if _cached_engine is not None:
        return _cached_engine

    backend = _read_config()

    if backend == 'dlib':
        _cached_engine = _load_dlib()
    elif backend == 'arcface':
        eng = _load_arcface()
        _cached_engine = eng if eng is not None else _load_dlib()
    else:
        # 'auto' — prefer ArcFace
        eng = _load_arcface()
        _cached_engine = eng if eng is not None else _load_dlib()

    logger.info(f'[EngineFactory] Active engine: {_cached_engine.__class__.__name__}')
    return _cached_engine


def reset_engine():
    """Force re-selection on next call (e.g. after config change)."""
    global _cached_engine
    _cached_engine = None


def engine_info() -> dict:
    """Return metadata about the active engine for API responses."""
    eng = get_engine()
    name = eng.__class__.__name__
    return {
        'engine':             name,
        'backend':            getattr(eng, 'backend', 'dlib'),
        'available':          eng.available,
        'recommended_model':  eng.recommended_model,
        'embedding_dim':      512 if 'ArcFace' in name else 128,
        'accuracy_lfw':       '99.83%' if 'ArcFace' in name else '99.38%',
        'similarity_metric':  'cosine' if 'ArcFace' in name else 'euclidean',
        'max_per_user':       eng.MAX_ENCODINGS_PER_USER,
    }


def compare_encodings(known_list: list, probe) -> 'np.ndarray':
    """
    Proxy to the active engine's compare_encodings().
    Returns distance array suitable for deduplication.
    Use this everywhere instead of importing face_recognition directly.
    """
    import numpy as np
    eng = get_engine()
    if not eng.available or not known_list:
        return np.array([])
    return eng.compare_encodings(known_list, probe)


# ── Internal loaders ──────────────────────────────────────────────────────────

def _read_config() -> str:
    try:
        from models.unknown_face import SystemConfig
        val = SystemConfig.get('face_engine_backend', 'auto')
        return val or 'auto'
    except Exception:
        return 'auto'


def _load_arcface():
    try:
        from face_engine.arcface_engine import ArcFaceEngine, ARCFACE_AVAILABLE
        if not ARCFACE_AVAILABLE:
            return None
        eng = ArcFaceEngine.get_instance()
        if eng.available:
            return eng
        logger.warning('[EngineFactory] ArcFace installed but model not ready — trying dlib')
        return None
    except Exception as e:
        logger.warning(f'[EngineFactory] ArcFace load error: {e}')
        return None


def _load_dlib():
    from face_engine.encoder import FaceEngine
    return FaceEngine.get_instance()
