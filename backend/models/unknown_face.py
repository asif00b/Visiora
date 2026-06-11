from database import db
from datetime import datetime


class UnknownFace(db.Model):
    __tablename__ = 'unknown_faces'
    __table_args__ = (
        db.Index('ix_unknown_faces_captured_at', 'captured_at'),
        db.Index('ix_unknown_faces_cluster_id', 'cluster_id'),
    )

    id               = db.Column(db.Integer, primary_key=True)
    image_path       = db.Column(db.String(500), nullable=False)
    captured_at      = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    confidence_score = db.Column(db.Float, nullable=True)       # Distance from nearest match
    assigned_to_id   = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    # Deduplication support — stores the 128-d face encoding as JSON text
    encoding_data    = db.Column(db.Text(length=65535), nullable=True)
    # Groups visually similar unknown faces (e.g. same person at different times)
    cluster_id       = db.Column(db.String(64), nullable=True)

    assigned_to = db.relationship('User', foreign_keys=[assigned_to_id])

    def get_encoding(self):
        """Return encoding as a list, or None if not stored."""
        if not self.encoding_data:
            return None
        import json
        try:
            return json.loads(self.encoding_data)
        except Exception:
            return None

    def set_encoding(self, encoding_array):
        """Store numpy array or list as JSON."""
        import json
        if encoding_array is None:
            self.encoding_data = None
            return
        if hasattr(encoding_array, 'tolist'):
            self.encoding_data = json.dumps(encoding_array.tolist())
        else:
            self.encoding_data = json.dumps(list(encoding_array))

    def to_dict(self):
        return {
            'id':               self.id,
            'image_path':       self.image_path,
            'captured_at':      self.captured_at.isoformat() if self.captured_at else None,
            'confidence_score': self.confidence_score,
            'assigned_to_id':   self.assigned_to_id,
            'assigned_to_name': self.assigned_to.name if self.assigned_to else None,
            'cluster_id':       self.cluster_id,
            'has_encoding':     self.encoding_data is not None,
        }

    def safe_to_dict(self):
        """to_dict with per-field error recovery — never raises."""
        try:
            return self.to_dict()
        except Exception:
            return {
                'id':          self.id,
                'image_path':  self.image_path,
                'captured_at': None,
            }


class SystemConfig(db.Model):
    __tablename__ = 'system_config'

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.String(500), nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    @classmethod
    def get(cls, key, default=None):
        """Get config value by key."""
        record = cls.query.filter_by(key=key).first()
        return record.value if record else default

    @classmethod
    def set(cls, key, value):
        """Set config value."""
        from database import db
        record = cls.query.filter_by(key=key).first()
        if record:
            record.value = str(value)
            record.updated_at = datetime.utcnow()
        else:
            db.session.add(cls(key=key, value=str(value)))
        db.session.commit()

    def to_dict(self):
        return {
            'key': self.key,
            'value': self.value,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
