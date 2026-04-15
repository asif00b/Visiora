from database import db
from datetime import datetime


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(200), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='student')  # admin, hr, student
    student_id = db.Column(db.String(50), unique=True, nullable=True)
    phone = db.Column(db.String(30), nullable=True)
    dept_id = db.Column(db.Integer, db.ForeignKey('departments.id'), nullable=True)
    image_path = db.Column(db.String(500), nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    department = db.relationship('Department', backref='users')
    face_encodings = db.relationship('FaceEncoding', backref='user', cascade='all, delete-orphan')
    attendances = db.relationship('Attendance', foreign_keys='Attendance.user_id',
                                  backref='user', cascade='all, delete-orphan')

    def to_dict(self, include_sensitive=False):
        data = {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'role': self.role,
            'student_id': self.student_id,
            'phone': self.phone,
            'dept_id': self.dept_id,
            'dept_name': self.department.name if self.department else None,
            'image_path': self.image_path,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'has_face': len(self.face_encodings) > 0,
            'face_count': len(self.face_encodings),
        }
        return data
