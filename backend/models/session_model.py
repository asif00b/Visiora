from database import db
from datetime import datetime


class SessionModel(db.Model):
    __tablename__ = 'sessions'

    id          = db.Column(db.Integer, primary_key=True)
    name        = db.Column(db.String(150), nullable=False)
    description = db.Column(db.String(400), nullable=True)

    # Daily time window
    start_time  = db.Column(db.Time, nullable=True)   # e.g., 09:00
    end_time    = db.Column(db.Time, nullable=True)   # e.g., 12:00

    # Date range (optional – for one-time sessions)
    valid_from  = db.Column(db.Date, nullable=True)
    valid_to    = db.Column(db.Date, nullable=True)

    # Rules
    allow_multiple   = db.Column(db.Boolean, default=False)
    cooldown_minutes = db.Column(db.Integer, default=10)

    is_active  = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationship - keep lazy loading predictable for existing routes.
    attendances = db.relationship(
        'Attendance',
        backref='session',
        cascade='all, delete-orphan',
        lazy='select',
    )

    def is_currently_active(self):
        """Check if this session is within its time window right now."""
        now = datetime.now()

        if self.valid_from and now.date() < self.valid_from:
            return False
        if self.valid_to and now.date() > self.valid_to:
            return False

        if self.start_time and self.end_time:
            current_time = now.time().replace(second=0, microsecond=0)
            return self.start_time <= current_time <= self.end_time

        return self.is_active

    def to_dict(self):
        return {
            'id':                   self.id,
            'name':                 self.name,
            'description':          self.description,
            'start_time':           self.start_time.strftime('%H:%M') if self.start_time else None,
            'end_time':             self.end_time.strftime('%H:%M') if self.end_time else None,
            'valid_from':           self.valid_from.isoformat() if self.valid_from else None,
            'valid_to':             self.valid_to.isoformat() if self.valid_to else None,
            'allow_multiple':       self.allow_multiple,
            'cooldown_minutes':     self.cooldown_minutes,
            'is_active':            self.is_active,
            'is_currently_active':  self.is_currently_active(),
            'created_at':           self.created_at.isoformat() if self.created_at else None,
        }
