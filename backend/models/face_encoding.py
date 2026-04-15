from database import db
from datetime import datetime
import json


class FaceEncoding(db.Model):
    __tablename__ = 'face_encodings'

    id            = db.Column(db.Integer, primary_key=True)
    user_id       = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    # LONGTEXT for MySQL — a 128-float JSON array needs ~2 KB; TEXT (65 KB) is fine
    # but LONGTEXT future-proofs for extended descriptors.
    encoding_data = db.Column(db.Text(length=4294967295), nullable=False)
    image_path    = db.Column(db.String(500), nullable=True)
    quality_score = db.Column(db.Float, nullable=True)   # 0–1, higher is better
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)

    def get_encoding(self):
        """Return encoding as a list (ready to convert to numpy)."""
        return json.loads(self.encoding_data)

    def set_encoding(self, encoding_array):
        """Store numpy array or list as JSON."""
        if hasattr(encoding_array, 'tolist'):
            self.encoding_data = json.dumps(encoding_array.tolist())
        else:
            self.encoding_data = json.dumps(list(encoding_array))

    def to_dict(self):
        return {
            'id':            self.id,
            'user_id':       self.user_id,
            'image_path':    self.image_path,
            'quality_score': self.quality_score,
            'created_at':    self.created_at.isoformat() if self.created_at else None,
        }
