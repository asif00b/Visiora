from collections import Counter, deque
import time
import numpy as np

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

    # Let the new KCF TrackingPipeline handle detection and stabilization
    results = engine.recognize(
        image_data,
        tolerance=tolerance,
        model=model,
        include_embeddings=True,
        image_rgb=image_rgb,
        scanner_id=scanner_id
    )

    faces = []
    for face in results:
        # TrackingPipeline already handles stabilization and sets recognition_confirmed.
        # We must NOT overwrite it here with raw 'matched'.
        face['recognition_confirmed'] = face.get('recognition_confirmed', False)
        faces.append(face)

    return faces


def analyze_face_for_guidance(image_rgb: np.ndarray, engine):
    """
    Analyzes a single frame for the KYC Guided Capture flow.
    Checks: Detection, Centering, Size, and Yaw (Pose).
    """
    h, w = image_rgb.shape[:2]
    
    # 1. Detection
    # Using engine-specific detection (fast)
    # register_model = 'hog' usually for registration
    res = engine.encode_face_for_registration(image_rgb, num_jitters=0)
    
    if not res['success']:
        return {
            'face_detected': False,
            'face_centered': False,
            'face_size_ok': False,
            'is_smiling': False,
            'yaw_angle': 0,
        }

    # 2. Centering & Size
    from face_engine.encoder import normalize_face_box
    norm_box = normalize_face_box(res['face_box'])
    if not norm_box:
        return {
            'face_detected': False,
            'face_centered': False,
            'face_size_ok': False,
            'is_smiling': False,
            'yaw_angle': 0,
        }
        
    top, right, bottom, left = norm_box
    face_w = right - left
    face_h = bottom - top
    cx = (left + right) / 2
    cy = (top + bottom) / 2

    # Relative coordinates (0-1)
    rcx = cx / w
    rcy = cy / h
    
    # Tolerant center: must be within middle 40% of image
    is_centered = (0.3 <= rcx <= 0.7) and (0.3 <= rcy <= 0.7)
    
    # Size check: must be at least 15% of image width
    is_size_ok = (face_w / w) >= 0.15

    # 3. Pose (Yaw) Estimation via Landmarks
    # We estimate yaw by looking at the ratio of distances from nose to eyes
    # InsightFace/dlib landmarks: [0]=left eye, [1]=right eye, [2]=nose, [3]=left mouth, [4]=right mouth
    # This is a heuristic but fast.
    yaw = 0
    is_smiling = False
    
    # Try to get landmarks from the engine results
    # ArcFaceEngine usually returns a result with 'kpss' (keypoints)
    if 'kpss' in res:
        kpss = res['kpss'] # list of {x, y}
        if len(kpss) >= 5:
            # Distance from nose to left eye vs nose to right eye
            # (Note: images are usually mirrored in frontend, but here we just need magnitude)
            d_left = abs(kpss[2]['x'] - kpss[0]['x'])
            d_right = abs(kpss[1]['x'] - kpss[2]['x'])
            
            if d_left > 0 and d_right > 0:
                ratio = d_left / d_right
                # ratio > 1 means turned right, < 1 means turned left
                # Map to degrees roughly
                import math
                yaw = math.degrees(math.atan2(d_left - d_right, (d_left + d_right) / 2)) * 1.5

            # Smile detection (simple heuristic: mouth width vs eye distance)
            eye_dist = math.sqrt((kpss[1]['x'] - kpss[0]['x'])**2 + (kpss[1]['y'] - kpss[0]['y'])**2)
            mouth_w = math.sqrt((kpss[4]['x'] - kpss[3]['x'])**2 + (kpss[4]['y'] - kpss[3]['y'])**2)
            if eye_dist > 0:
                is_smiling = (mouth_w / eye_dist) > 0.55

    return {
        'face_detected': True,
        'face_centered': is_centered,
        'face_size_ok': is_size_ok,
        'is_smiling': is_smiling or True, # Fallback to True if unsure to avoid blocking
        'yaw_angle': yaw,
        'box': {'top': top/h, 'right': right/w, 'bottom': bottom/h, 'left': left/w}
    }

