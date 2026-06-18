from datetime import datetime
import json

from database import db
from db_types import VectorEmbedding


class FaceEncoding(db.Model):
    __tablename__ = "face_encodings"
    __table_args__ = (
        db.Index("ix_face_encodings_user_id", "user_id"),
        db.Index("ix_face_encodings_quality", "user_id", "quality_score"),
        db.Index("ix_face_encodings_embedding_dim", "embedding_dim"),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    encoding_data = db.Column(db.Text, nullable=False)
    embedding_dim = db.Column(db.Integer, nullable=True)
    embedding_vector = db.Column(VectorEmbedding(512), nullable=True)
    image_path = db.Column(db.String(500), nullable=True)
    quality_score = db.Column(db.Float, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.now)
    encoding_type = db.Column(db.String(20), default="single", nullable=True)
    source_count = db.Column(db.Integer, default=1, nullable=True)

    def get_encoding(self):
        return json.loads(self.encoding_data)

    def set_encoding(self, encoding_array):
        if hasattr(encoding_array, "tolist"):
            values = encoding_array.tolist()
        else:
            values = list(encoding_array)
        values = [float(v) for v in values]
        self.encoding_data = json.dumps(values)
        self.embedding_dim = len(values)
        self.embedding_vector = values if len(values) == 512 else None

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "image_path": self.image_path,
            "quality_score": self.quality_score,
            "embedding_dim": self.embedding_dim,
            "encoding_type": self.encoding_type,
            "source_count": self.source_count,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
