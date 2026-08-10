from datetime import datetime

from sqlalchemy import text

from database import db


class Attendance(db.Model):
    __tablename__ = "attendance"
    __table_args__ = (
        db.Index("ix_attendance_user_timestamp", "user_id", "timestamp"),
        db.Index("ix_attendance_timestamp", "timestamp"),
        db.Index("ix_attendance_session_id", "session_id"),
        db.Index("ix_attendance_user_date", "user_id", "attendance_date"),
        # Unique index for session attendance (when session_id is not null)
        db.Index(
            "uq_attendance_user_session_day",
            "user_id",
            "attendance_date",
            "session_id",
            unique=True,
            postgresql_where=text("session_id IS NOT NULL")
        ),
        # Unique index for general attendance (when session_id is null)
        db.Index(
            "uq_attendance_user_general_day",
            "user_id",
            "attendance_date",
            unique=True,
            postgresql_where=text("session_id IS NULL")
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    session_id = db.Column(db.Integer, db.ForeignKey("sessions.id"), nullable=True)
    attendance_date = db.Column(
        db.Date,
        nullable=False,
        default=lambda: datetime.now().date(),
        server_default=text("CURRENT_DATE"),
    )
    timestamp = db.Column(db.DateTime, default=datetime.now, nullable=False)
    status = db.Column(db.String(20), default="present")
    marked_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    note = db.Column(db.String(300), nullable=True)
    punch_out = db.Column(db.DateTime, nullable=True)
    hours_worked = db.Column(db.Float, default=0.0)
    is_core_hours_satisfied = db.Column(db.Boolean, default=True, server_default=text('TRUE'))

    marked_by = db.relationship("User", foreign_keys=[marked_by_id])

    def to_dict(self):
        u_name = self.user.name if self.user else None
        u_img = self.user.image_path if self.user else None
        d_name = self.user.department.name if (self.user and self.user.department) else None
        return {
            "id": self.id,
            "user_id": self.user_id,
            "user_name": u_name,
            "user_student_id": self.user.student_id if self.user else None,
            "user_image": u_img,
            "dept_name": d_name,
            "user": {
                "id": self.user_id,
                "name": u_name,
                "student_id": self.user.student_id if self.user else None,
                "image_path": u_img,
                "department": {"name": d_name} if d_name else None,
            } if self.user else None,
            "session_id": self.session_id,
            "session_name": self.session.name if self.session else "General",
            "attendance_date": self.attendance_date.isoformat()
            if self.attendance_date
            else None,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "status": self.status,
            "marked_by": self.marked_by.name if self.marked_by else "System",
            "note": self.note,
            "punch_out": self.punch_out.isoformat() if self.punch_out else None,
            "hours_worked": self.hours_worked or 0.0,
            "is_core_hours_satisfied": self.is_core_hours_satisfied,
        }

    def safe_to_dict(self):
        try:
            return self.to_dict()
        except Exception:
            return {
                "id": self.id,
                "user_id": self.user_id,
                "timestamp": self.timestamp.isoformat() if self.timestamp else None,
                "status": self.status,
                "punch_out": self.punch_out.isoformat() if self.punch_out else None,
                "hours_worked": self.hours_worked or 0.0,
                "is_core_hours_satisfied": self.is_core_hours_satisfied,
                "error": "serialization_error",
            }
