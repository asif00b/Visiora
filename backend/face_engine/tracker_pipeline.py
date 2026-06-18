import logging
import os
import time
from collections import Counter

import cv2
import numpy as np

logger = logging.getLogger(__name__)


def compute_iou(box_a, box_b):
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter_area = iw * ih
    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
    denom = area_a + area_b - inter_area
    return inter_area / denom if denom > 0 else 0.0


def compute_dist(box_a, box_b):
    ca = ((box_a[0] + box_a[2]) / 2, (box_a[1] + box_a[3]) / 2)
    cb = ((box_b[0] + box_b[2]) / 2, (box_b[1] + box_b[3]) / 2)
    return ((ca[0] - cb[0]) ** 2 + (ca[1] - cb[1]) ** 2) ** 0.5


def _create_tracker():
    requested = os.environ.get("TRACKER_ALGORITHM", "KCF").upper()
    order = {
        "CSRT": ["TrackerCSRT_create", "TrackerKCF_create", "TrackerMIL_create"],
        "KCF": ["TrackerKCF_create", "TrackerCSRT_create", "TrackerMIL_create"],
        "MIL": ["TrackerMIL_create", "TrackerKCF_create", "TrackerCSRT_create"],
    }.get(requested, ["TrackerKCF_create", "TrackerCSRT_create", "TrackerMIL_create"])

    for name in order:
        creator = getattr(cv2, name, None)
        if creator is None and hasattr(cv2, "legacy"):
            creator = getattr(cv2.legacy, name, None)
        if creator is not None:
            return creator(), name.replace("Tracker", "").replace("_create", "")
    raise RuntimeError("No OpenCV tracker is available. Install opencv-contrib-python-headless.")


class ScannerState:
    def __init__(self, scanner_id):
        self.scanner_id = scanner_id
        self.trackers = {}
        self.track_bboxes = {}
        self.track_kpss = {}
        self.track_rel_kpss = {}
        self.track_ema_kpss = {}
        self.track_cache = {}
        self.next_track_id = 0
        self.frame_idx = 0
        self.last_used = time.time()
        self.track_ear_history = {}
        self.track_liveness_confirmed = {}

    def cleanup_tracker(self, track_id):
        self.trackers.pop(track_id, None)
        self.track_bboxes.pop(track_id, None)
        self.track_kpss.pop(track_id, None)
        self.track_rel_kpss.pop(track_id, None)
        self.track_ema_kpss.pop(track_id, None)
        self.track_cache.pop(track_id, None)
        self.track_ear_history.pop(track_id, None)
        self.track_liveness_confirmed.pop(track_id, None)


class TrackingPipeline:
    _instance = None

    DETECTION_INTERVAL = int(os.environ.get("TRACKER_DETECTION_INTERVAL", "5"))
    STABLE_AGE_REQ = int(os.environ.get("TRACKER_STABLE_AGE", "3"))
    MAX_LOST_FRAMES = int(os.environ.get("TRACKER_MAX_LOST_FRAMES", "4"))
    REC_REFRESH_INTERVAL = int(os.environ.get("TRACKER_RECOGNITION_INTERVAL", "18"))
    IOU_SUPPRESS_THRESH = float(os.environ.get("TRACKER_IOU_SUPPRESS", "0.45"))
    DIST_SUPPRESS_THRESH = int(os.environ.get("TRACKER_DIST_SUPPRESS", "70"))
    MAX_TRACKERS = int(os.environ.get("TRACKER_MAX_TRACKERS", "8"))

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.scanners = {}
        self.last_cleanup = time.time()
        self.tracker_backend = "unknown"

    def process_frame(self, scanner_id, frame_rgb, detector_func, recognizer_func):
        h, w = frame_rgb.shape[:2]

        if scanner_id not in self.scanners:
            self.scanners[scanner_id] = ScannerState(scanner_id)
        state = self.scanners[scanner_id]
        state.last_used = time.time()
        state.frame_idx += 1

        # Fetch liveness configuration
        try:
            from models.unknown_face import SystemConfig
            liveness_enabled = SystemConfig.get('liveness_enabled', 'false').lower() == 'true'
        except Exception:
            liveness_enabled = False

        current_faces = {}
        is_detection_frame = (
            state.frame_idx % self.DETECTION_INTERVAL == 0
        ) or not state.trackers

        self._update_trackers(state, frame_rgb, w, h, current_faces, liveness_enabled)

        if is_detection_frame:
            self._detect_new_tracks(state, frame_rgb, detector_func, current_faces)

        self._recognize_stable_tracks(state, frame_rgb, recognizer_func)
        results = self._package_results(state, current_faces, w, h, liveness_enabled)
        self._cleanup_stale_scanners()
        return results

    def _update_trackers(self, state, frame_rgb, w, h, current_faces, liveness_enabled=False):
        for track_id, tracker in list(state.trackers.items()):
            ok, box = tracker.update(frame_rgb)
            cache = state.track_cache.setdefault(track_id, {})
            if not ok:
                cache["lost_count"] = cache.get("lost_count", 0) + 1
                if cache["lost_count"] > self.MAX_LOST_FRAMES:
                    state.cleanup_tracker(track_id)
                continue

            tx, ty, tw, th = map(int, box)
            tx, ty = max(0, tx), max(0, ty)
            tx2, ty2 = min(w, tx + max(1, tw)), min(h, ty + max(1, th))
            new_box = (tx, ty, tx2, ty2)

            old_box = state.track_bboxes.get(track_id)
            if old_box and compute_dist(old_box, new_box) > 140:
                state.cleanup_tracker(track_id)
                continue

            state.track_bboxes[track_id] = new_box

            # --- EAR Liveness calculation ---
            try:
                from face_engine.liveness import get_eye_aspect_ratio_from_image
                top_b, right_b, bottom_b, left_b = ty, tx2, ty2, tx
                ear = get_eye_aspect_ratio_from_image(frame_rgb, (top_b, right_b, bottom_b, left_b))
                if ear is not None:
                    ear_history = state.track_ear_history.setdefault(track_id, [])
                    ear_history.append(ear)
                    if len(ear_history) > 15:
                        ear_history.pop(0)
                    
                    if len(ear_history) >= 5:
                        ear_var = float(np.var(ear_history))
                        # Variance threshold: 0.00004
                        # Static photo/screen has variance near zero (typically < 1e-6)
                        if ear_var < 0.00004:
                            state.track_liveness_confirmed[track_id] = False
                        else:
                            state.track_liveness_confirmed[track_id] = True
            except Exception as exc:
                logger.debug("[Tracker] EAR check failed: %s", exc)

            rel_pts = state.track_rel_kpss.get(track_id)
            if rel_pts is None:
                prev = state.track_kpss.get(track_id)
                rel_pts = [(p[0] - tx, p[1] - ty) for p in prev] if prev is not None else None

            if rel_pts is not None:
                ema_pts = state.track_ema_kpss.get(track_id)
                if ema_pts is not None and len(ema_pts) == len(rel_pts):
                    alpha = 0.35
                    rel_pts = [
                        (
                            alpha * r[0] + (1 - alpha) * e[0],
                            alpha * r[1] + (1 - alpha) * e[1],
                        )
                        for r, e in zip(rel_pts, ema_pts)
                    ]
                state.track_ema_kpss[track_id] = rel_pts
                state.track_kpss[track_id] = [(tx + r[0], ty + r[1]) for r in rel_pts]

            current_faces[track_id] = (new_box, state.track_kpss.get(track_id))
            cache["lost_count"] = 0

    def _detect_new_tracks(self, state, frame_rgb, detector_func, current_faces):
        try:
            bboxes, kpss = detector_func(frame_rgb)
        except Exception as exc:
            logger.debug("[Tracker] Detection skipped: %s", exc)
            return

        if bboxes is None:
            return

        for idx, det_box in enumerate(bboxes):
            x1, y1, x2, y2 = map(int, det_box[:4])
            clean_det = (x1, y1, x2, y2)
            dw, dh = x2 - x1, y2 - y1
            if dw < 40 or dh < 40:
                continue

            duplicate = any(
                compute_iou(clean_det, trk_box) > self.IOU_SUPPRESS_THRESH
                or compute_dist(clean_det, trk_box) < self.DIST_SUPPRESS_THRESH
                for trk_box in state.track_bboxes.values()
            )
            if duplicate or len(state.trackers) >= self.MAX_TRACKERS:
                continue

            try:
                tracker, backend = _create_tracker()
                tracker.init(frame_rgb, (x1, y1, dw, dh))
                self.tracker_backend = backend
            except Exception as exc:
                logger.debug("[Tracker] Could not create tracker: %s", exc)
                continue

            track_id = state.next_track_id
            state.next_track_id += 1
            cur_kps = kpss[idx] if kpss is not None and idx < len(kpss) else None

            state.trackers[track_id] = tracker
            state.track_bboxes[track_id] = clean_det
            state.track_kpss[track_id] = cur_kps
            if cur_kps is not None:
                state.track_rel_kpss[track_id] = [(p[0] - x1, p[1] - y1) for p in cur_kps]

            state.track_cache[track_id] = {
                "age": 0,
                "lost_count": 0,
                "frames_since_rec": self.REC_REFRESH_INTERVAL,
                "history": [],
            }
            current_faces[track_id] = (clean_det, cur_kps)

    def _recognize_stable_tracks(self, state, frame_rgb, recognizer_func):
        batch_crops = []
        batch_ids = []
        for tid, cache in list(state.track_cache.items()):
            cache["age"] = cache.get("age", 0) + 1
            cache["frames_since_rec"] = cache.get("frames_since_rec", 0) + 1
            if (
                cache["age"] >= self.STABLE_AGE_REQ
                and cache["frames_since_rec"] >= self.REC_REFRESH_INTERVAL
                and tid in state.track_bboxes
                and state.track_kpss.get(tid) is not None
            ):
                batch_crops.append((state.track_bboxes[tid], state.track_kpss[tid]))
                batch_ids.append(tid)
                cache["frames_since_rec"] = 0

        if not batch_crops:
            return

        try:
            rec_results = recognizer_func(frame_rgb, batch_crops)
        except Exception as exc:
            logger.error("[Tracker] Recognition failed: %s", exc)
            return

        for tid, res in zip(batch_ids, rec_results):
            if tid not in state.track_cache:
                continue
            cache = state.track_cache[tid]
            new_uid = res.get("user_id") or "Unknown"
            cache.setdefault("history", []).append(new_uid)
            cache["history"] = cache["history"][-5:]

            votes = Counter(cache["history"])
            best_uid, count = votes.most_common(1)[0]
            is_confirmed = count >= 2 and best_uid != "Unknown"

            if best_uid == "Unknown":
                cache["frames_since_rec"] = max(0, self.REC_REFRESH_INTERVAL // 2)

            cache.update(
                {
                    "user_id": best_uid,
                    "confidence": res.get("confidence", 0),
                    "name": res.get("name") if best_uid == new_uid else cache.get("name", "Unknown"),
                    "distance": res.get("distance", 1.0),
                    "recognition_confirmed": is_confirmed,
                    "_embedding": res.get("_embedding"),
                }
            )

    def _package_results(self, state, current_faces, w, h, liveness_enabled=False):
        results = []
        for tid, (bbox, kps) in current_faces.items():
            cache = state.track_cache.get(tid)
            if not cache:
                continue

            x1, y1, x2, y2 = bbox
            user_id = cache.get("user_id")
            matched = user_id is not None and user_id != "Unknown"
            
            # Restrict recognition confirmation if liveness is required but not confirmed
            liveness_confirmed = state.track_liveness_confirmed.get(tid, True) if liveness_enabled else True
            rec_confirmed = cache.get("recognition_confirmed", False) and liveness_confirmed

            res = {
                "box": {"left": x1 / w, "top": y1 / h, "right": x2 / w, "bottom": y2 / h},
                "matched": matched,
                "recognition_confirmed": rec_confirmed,
                "user_id": user_id,
                "name": cache.get("name", "Unknown"),
                "distance": cache.get("distance", 1.0),
                "track_id": tid,
            }
            if cache.get("_embedding") is not None:
                res["_embedding"] = cache.get("_embedding")

            if kps is not None and len(kps) == 5:
                res["kpss"] = [{"x": float(p[0]) / w, "y": float(p[1]) / h} for p in kps]
                le, re = kps[0], kps[1]
                dx, dy = re[0] - le[0], re[1] - le[1]
                raw_angle = np.degrees(np.arctan2(dy, abs(dx) if dx != 0 else 0.1))
                angle = 0.7 * cache.get("angle", raw_angle) + 0.3 * raw_angle
                cache["angle"] = angle

                status = "FACE_STABLE"
                if cache.get("age", 0) < self.STABLE_AGE_REQ:
                    status = "STABILIZING"
                elif abs(angle) > 20:
                    status = "FACE_ROTATED"

                # Liveness overlay status override
                if liveness_enabled and not liveness_confirmed:
                    if len(state.track_ear_history.get(tid, [])) >= 5:
                        status = "SPOOF_DETECTED"
                    else:
                        status = "LIVENESS_CHECK"

                status_color = "#eab308" if status in ("STABILIZING", "LIVENESS_CHECK") else "#10b981"
                if status == "SPOOF_DETECTED" or (user_id == "Unknown" and cache.get("age", 0) >= self.STABLE_AGE_REQ):
                    status_color = "#ef4444"

                res["debug"] = {
                    "status": status,
                    "status_color": status_color,
                    "tracker_id": tid,
                    "tracker_backend": self.tracker_backend,
                    "eye_angle": float(angle),
                    "stable_frames": cache.get("age", 0),
                    "confidence": cache.get("confidence", 0),
                    "distance": cache.get("distance", 0),
                    "history": cache.get("history", [])[-5:],
                }
            results.append(res)
        return results

    def _cleanup_stale_scanners(self):
        now = time.time()
        if now - self.last_cleanup <= 60:
            return
        stale_sids = [sid for sid, s in self.scanners.items() if now - s.last_used > 120]
        for sid in stale_sids:
            del self.scanners[sid]
        self.last_cleanup = now
