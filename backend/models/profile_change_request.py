from database import db
from datetime import datetime

class ProfileChangeRequest(db.Model):
    __tablename__ = 'profile_change_requests'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    requested_name = db.Column(db.String(120), nullable=True)
    requested_phone = db.Column(db.String(30), nullable=True)
    requested_image_path = db.Column(db.String(500), nullable=True)
    status = db.Column(db.String(20), default='pending')  # pending, approved, rejected
    created_at = db.Column(db.DateTime, default=datetime.now)
    reviewed_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    rejection_reason = db.Column(db.String(255), nullable=True)

    # Relationships
    user = db.relationship('User', foreign_keys=[user_id], backref='profile_requests')
    reviewer = db.relationship('User', foreign_keys=[reviewed_by])

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_name': self.user.name if self.user else None,
            'user_email': self.user.email if self.user else None,
            'user_student_id': self.user.student_id if self.user else None,
            'current_name': self.user.name if self.user else None,
            'current_phone': self.user.phone if self.user else None,
            'current_image_path': self.user.image_path if self.user else None,
            'requested_name': self.requested_name,
            'requested_phone': self.requested_phone,
            'requested_image_path': self.requested_image_path,
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'reviewed_by': self.reviewed_by,
            'reviewed_at': self.reviewed_at.isoformat() if self.reviewed_at else None,
            'rejection_reason': self.rejection_reason
        }
