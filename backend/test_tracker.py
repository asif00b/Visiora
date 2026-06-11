import sys
import os
import time

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from face_engine.arcface_engine import ArcFaceEngine
import cv2
import numpy as np

def test_engine():
    engine = ArcFaceEngine.get_instance()
    
    # Check GPU
    gpu_active = False
    if hasattr(engine, '_app') and hasattr(engine._app, 'models'):
        gpu_active = any('CUDA' in str(p) for p in engine._app.models)
        print(f"GPU Active: {gpu_active}")
    
    print("Running 10 frames to measure timing...")
    for i in range(10):
        img = np.zeros((480, 640, 3), dtype=np.uint8)
        # Move the box slightly
        cv2.rectangle(img, (200 + i*5, 200 + i*5), (300 + i*5, 300 + i*5), (255, 255, 255), -1)
        
        t0 = time.time()
        res = engine.recognize(image_data=None, image_rgb=img, scanner_id="timing_test")
        t1 = time.time()
        print(f"Frame {i+1} Total: {(t1-t0)*1000:.2f} ms | Found {len(res)} faces")

if __name__ == '__main__':
    test_engine()
