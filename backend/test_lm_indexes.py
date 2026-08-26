import sys, os
sys.path.insert(0, '.')
from app import create_app
from face_engine.engine_factory import get_engine
import numpy as np

app = create_app()

with app.app_context():
    engine = get_engine()
    # Find a test image
    p = 'storage/known_faces/profile_6.jpg'
    if os.path.exists(p):
        img = engine.decode_image('data:image/jpeg;base64,' + __import__('base64').b64encode(open(p,'rb').read()).decode())
        faces = engine._app.get(img)
        if faces:
            f = faces[0]
            lm = f.landmark_2d_106
            print(f"[TEST] Total landmarks: {len(lm)}")

            # Let's inspect eye landmarks in 2D-106
            # In standard 106-point:
            # 33..51 = left eye / eyebrow, 52..71 = right eye, 72..86 = nose, 87..105 = mouth
            # Let's print nose points 72..86
            for idx in [54, 72, 74, 80, 86]:
                print(f"  Pt {idx}: {lm[idx]}")

            # Let's compute centroid of left eye (points 33..42) and right eye (points 43..52)
            left_eye_pts = lm[33:43]
            right_eye_pts = lm[43:53]
            nose_pts = lm[72:86]

            left_eye_center = np.mean(left_eye_pts, axis=0)
            right_eye_center = np.mean(right_eye_pts, axis=0)
            nose_tip = lm[86] if len(lm) > 86 else np.mean(nose_pts, axis=0)

            print(f"Left Eye Center: {left_eye_center}")
            print(f"Right Eye Center: {right_eye_center}")
            print(f"Nose Tip: {nose_tip}")

            eye_mid_x = (left_eye_center[0] + right_eye_center[0]) / 2.0
            eye_span = abs(right_eye_center[0] - left_eye_center[0])
            nose_x = nose_tip[0]

            ratio = (nose_x - eye_mid_x) / (eye_span + 1e-6)
            import math
            yaw = math.degrees(math.atan(ratio * 3.0))
            print(f"Calculated Yaw: {yaw:.2f}°")
