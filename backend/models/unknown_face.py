from database import db
from datetime import datetime


class UnknownFace(db.Model):
    __tablename__ = 'unknown_faces'

    id = db.Column(db.Integer, primary_key=True)
    image_path = db.Column(db.String(500), nullable=False)
    captured_at = db.Column(db.DateTime, default=datetime.utcnow)
    confidence_score = db.Column(db.Float, nullable=True)   # Distance from nearest match
    assigned_to_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    assigned_to = db.relationship('User', foreign_keys=[assigned_to_id])

    def to_dict(self):
        return {
            'id': self.id,
            'image_path': self.image_path,
            'captured_at': self.captured_at.isoformat() if self.captured_at else None,
            'confidence_score': self.confidence_score,
            'assigned_to_id': self.assigned_to_id,
            'assigned_to_name': self.assigned_to.name if self.assigned_to else None,
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
