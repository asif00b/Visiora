from collections import Counter, deque
import time

import numpy as np

MIN_STABLE_FRAMES = 5
EMBEDDING_WINDOW = 5
IDENTITY_RATIO = 0.80
POSITION_THRESHOLD = 0.04
BLUR_VARIANCE_THRESHOLD = 80.0
EYE_ALIGNMENT_THRESHOLD = 0.12
TRACK_TTL_SECONDS = 30

_tracks = {}


def recognize_and_validate(
    image_data,
    engine,
    tolerance,
    model='hog',
    scanner_id='default',
    min_face_size=50,
):
    image_rgb = engine.decode_image(image_data)
    if image_rgb is None:
        return []

    _cleanup_tracks()
    results = engine.recognize(
        image_data,
        tolerance=tolerance,
        model=model,
        include_embeddings=True,
        image_rgb=image_rgb,
    )

    faces = []
    for face in results:
        if not _passes_quality(image_rgb, face, min_face_size):
            continue

        face['recognition_confirmed'] = False
        face['stable_frames'] = 0
        face['validation_votes'] = 0

        if face.get('matched') and face.get('_embedding') is not None:
            _validate_identity(face, scanner_id)

        faces.append(face)

    return faces


def _passes_quality(image_rgb, face, min_face_size):
    box = face.get('box') or {}
    h_img, w_img = image_rgb.shape[:2]

    left = int(max(0, min(1, float(box.get('left', 0)))) * w_img)
    right = int(max(0, min(1, float(box.get('right', 0)))) * w_img)
    top = int(max(0, min(1, float(box.get('top', 0)))) * h_img)
    bottom = int(max(0, min(1, float(box.get('bottom', 0)))) * h_img)

    width = right - left
    height = bottom - top
    if width < min_face_size or height < min_face_size:
        return False

    crop = image_rgb[top:bottom, left:right]
    if crop.size == 0 or _blur_variance(crop) < BLUR_VARIANCE_THRESHOLD:
        return False

    return _eyes_aligned(face.get('landmarks'))


def _blur_variance(crop):
    try:
        import cv2
        gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())
    except Exception:
        return 999.0


def _eyes_aligned(landmarks):
    if not landmarks:
        return False
    left = landmarks.get('left_eye')
    right = landmarks.get('right_eye')
    if not left or not right:
        return False

    eye_dx = abs(float(right['x']) - float(left['x']))
    if eye_dx <= 0:
        return False
    eye_dy = abs(float(right['y']) - float(left['y']))
    return (eye_dy / eye_dx) <= EYE_ALIGNMENT_THRESHOLD


def _validate_identity(face, scanner_id):
    user_id = int(face['user_id'])
    key = f'{scanner_id}:{user_id}'
    box_sig = _box_signature(face.get('box') or {})
    now = time.monotonic()

    track = _tracks.get(key)
    if not track or not _is_stable(track.get('box'), box_sig):
        track = {
            'box': box_sig,
            'stable_frames': 1,
            'history': deque(maxlen=EMBEDDING_WINDOW),
            'updated_at': now,
        }
        _tracks[key] = track
    else:
        track['box'] = box_sig
        track['stable_frames'] += 1
        track['updated_at'] = now

    track['history'].append({
        'user_id': user_id,
        'embedding': np.array(face['_embedding']),
    })

    votes = Counter(item['user_id'] for item in track['history'])
    best_user, best_count = votes.most_common(1)[0]

    face['stable_frames'] = track['stable_frames']
    face['validation_votes'] = best_count
    face['recognition_confirmed'] = (
        track['stable_frames'] >= MIN_STABLE_FRAMES
        and len(track['history']) == EMBEDDING_WINDOW
        and best_user == user_id
        and best_count / EMBEDDING_WINDOW >= IDENTITY_RATIO
    )


def _box_signature(box):
    return (
        float(box.get('left', 0)),
        float(box.get('top', 0)),
        float(box.get('right', 0)),
        float(box.get('bottom', 0)),
    )


def _is_stable(previous, current):
    if previous is None:
        return False
    return max(abs(a - b) for a, b in zip(previous, current)) <= POSITION_THRESHOLD


def _cleanup_tracks():
    now = time.monotonic()
    stale = [key for key, item in _tracks.items() if now - item.get('updated_at', now) > TRACK_TTL_SECONDS]
    for key in stale:
        _tracks.pop(key, None)
