import sys
import os
import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app import create_app
from database import db
from face_engine.engine_factory import get_engine
from face_engine.liveness import evaluate_real_human_liveness

app = create_app()
with app.app_context():
    engine = get_engine()
    print("Engine loaded:", engine)

    # Create dummy RGB face image (RGB: Red=210, Green=160, Blue=130)
    face_img = np.zeros((200, 200, 3), dtype=np.uint8)
    face_img[:, :] = (210, 160, 130)

    liveness_res = evaluate_real_human_liveness(face_img, [10, 190, 190, 10])
    print("Liveness test result on dummy RGB face:", liveness_res)
