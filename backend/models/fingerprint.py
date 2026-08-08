from database import db
from datetime import datetime


class UserFingerprint(db.Model):
    __tablename__ = 'user_fingerprints'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    finger_name = db.Column(db.String(50), nullable=False, default='Right Thumb')
    template_b64 = db.Column(db.Text, nullable=False)
    quality_score = db.Column(db.Integer, default=80)
    created_at = db.Column(db.DateTime, default=datetime.now)

    user = db.relationship('User', backref=db.backref('fingerprints', cascade='all, delete-orphan'))

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'finger_name': self.finger_name,
            'quality_score': self.quality_score,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
