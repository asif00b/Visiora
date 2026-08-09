from database import db
from datetime import datetime


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(200), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='user')  # admin, user
    student_id = db.Column(db.String(50), unique=True, nullable=True)
    phone = db.Column(db.String(30), nullable=True)
    dept_id = db.Column(db.Integer, db.ForeignKey('departments.id'), nullable=True)
    image_path = db.Column(db.String(500), nullable=True)
    weekly_target_hours = db.Column(db.Float, default=40.0)
    must_check_in_time = db.Column(db.Time, nullable=True)
    must_be_in_start = db.Column(db.Time, nullable=True)
    must_be_in_end = db.Column(db.Time, nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.now)

    # Relationships
    department = db.relationship('Department', backref='users')
    face_encodings = db.relationship('FaceEncoding', backref='user', cascade='all, delete-orphan')
    attendances = db.relationship('Attendance', foreign_keys='Attendance.user_id',
                                  backref='user', cascade='all, delete-orphan')

    def to_dict(self, include_sensitive=False):
        # Get the best encoding quality score for this user
        best_enc = None
        try:
            best_enc = max(self.face_encodings, key=lambda e: e.quality_score or 0) if self.face_encodings else None
        except Exception:
            pass

        # Normalize legacy 'student' role string to 'user'
        normalized_role = 'user' if self.role == 'student' else self.role

        data = {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'role': normalized_role,
            'student_id': self.student_id,
            'phone': self.phone,
            'dept_id': self.dept_id,
            'dept_name': self.department.name if self.department else None,
            'image_path': self.image_path,
            'weekly_target_hours': self.weekly_target_hours or 40.0,
            'must_check_in_time': self.must_check_in_time.strftime('%H:%M:%S') if self.must_check_in_time else None,
            'must_be_in_start': self.must_be_in_start.strftime('%H:%M:%S') if self.must_be_in_start else None,
            'must_be_in_end': self.must_be_in_end.strftime('%H:%M:%S') if self.must_be_in_end else None,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'has_face': len(self.face_encodings) > 0,
            'face_count': len(self.face_encodings),
            'face_quality_score': best_enc.quality_score if best_enc else None,
            'face_encoding_type': best_enc.encoding_type if best_enc else None,
            'face_source_count': best_enc.source_count if best_enc else 0,
            'has_fingerprint': len(self.fingerprints) > 0,
            'fingerprint_count': len(self.fingerprints),
        }
        return data

