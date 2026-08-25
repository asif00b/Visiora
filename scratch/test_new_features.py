import os
import sys
import unittest
import numpy as np

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../backend')))

from app import create_app
app = create_app()
from database import db
from models.user import User
from models.attendance import Attendance
from face_engine.liveness import evaluate_real_human_liveness


class TestNewFeatures(unittest.TestCase):
    def setUp(self):
        self.app = app
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
        self.ctx = self.app.app_context()
        self.ctx.push()

    def tearDown(self):
        self.ctx.pop()

    def test_evaluate_real_human_liveness(self):
        # 1. Test invalid / blank image
        res_blank = evaluate_real_human_liveness(None)
        self.assertFalse(res_blank['liveness_passed'])
        self.assertTrue(res_blank['is_spoof'])

        # 2. Test synthetic blur image (simulating blurry static photo)
        blurry_img = np.zeros((100, 100, 3), dtype=np.uint8)
        res_blurry = evaluate_real_human_liveness(blurry_img)
        self.assertFalse(res_blurry['liveness_passed'])
        self.assertTrue(res_blurry['is_spoof'])

    def test_manual_attendance_model(self):
        with app.app_context():
            user = User.query.filter_by(role='admin').first()
            if not user:
                return
            att = Attendance(
                user_id=user.id,
                method='manual',
                marked_by_id=user.id,
                note='Testing manual record'
            )
            d = att.to_dict()
            self.assertTrue(d['is_manual'])
            self.assertEqual(d['method'], 'manual')


if __name__ == '__main__':
    unittest.main()
