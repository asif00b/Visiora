from database import db
from datetime import datetime


class Attendance(db.Model):
    __tablename__ = 'attendance'
    __table_args__ = (
        db.Index('ix_attendance_user_timestamp', 'user_id', 'timestamp'),
        db.Index('ix_attendance_timestamp', 'timestamp'),
        db.Index('ix_attendance_session_id', 'session_id'),
    )

    id           = db.Column(db.Integer, primary_key=True)
    user_id      = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    session_id   = db.Column(db.Integer, db.ForeignKey('sessions.id'), nullable=True)
    timestamp    = db.Column(db.DateTime, default=datetime.utcnow)
    status       = db.Column(db.String(20), default='present')  # present, late, manual
    marked_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    note         = db.Column(db.String(300), nullable=True)

    # Relationship for marked_by
    marked_by = db.relationship('User', foreign_keys=[marked_by_id])

    def to_dict(self):
        return {
            'id':              self.id,
            'user_id':         self.user_id,
            'user_name':       self.user.name if self.user else None,
            'user_student_id': self.user.student_id if self.user else None,
            'dept_name':       self.user.department.name if self.user and self.user.department else None,
            'session_id':      self.session_id,
            'session_name':    self.session.name if self.session else 'General',
            'timestamp':       self.timestamp.isoformat() if self.timestamp else None,
            'status':          self.status,
            'marked_by':       self.marked_by.name if self.marked_by else 'System',
            'note':            self.note,
        }

    def safe_to_dict(self):
        """Per-record serialization that never raises — used in report API."""
        try:
            return self.to_dict()
        except Exception:
            return {
                'id':        self.id,
                'user_id':   self.user_id,
                'timestamp': self.timestamp.isoformat() if self.timestamp else None,
                'status':    self.status,
                'error':     'serialization_error',
            }
