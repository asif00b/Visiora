import time
from datetime import datetime, timedelta
from threading import Lock

from database import db
from models.attendance import Attendance


COOLDOWN_SECONDS = 60
_last_marked_at = {}
_locks = {}
_locks_guard = Lock()


def today_bounds(now=None):
    now = now or datetime.utcnow()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def attendance_today(user_id):
    start, end = today_bounds()
    return (
        Attendance.query
        .filter(
            Attendance.user_id == user_id,
            Attendance.timestamp >= start,
            Attendance.timestamp < end,
        )
        .first()
    )


def mark_attendance_once(user_id, session_id=None, status='present', marked_by_id=None, note=None):
    user_id = int(user_id)
    with _user_lock(user_id):
        now_mono = time.monotonic()
        last_mono = _last_marked_at.get(user_id)
        if last_mono and now_mono - last_mono < COOLDOWN_SECONDS:
            return {'marked': False, 'reason': 'cooldown', 'attendance': None}

        existing = attendance_today(user_id)
        if existing:
            return {'marked': False, 'reason': 'already_marked_today', 'attendance': existing}

        record = Attendance(
            user_id=user_id,
            session_id=session_id,
            status=status,
            marked_by_id=marked_by_id,
            note=note,
        )
        try:
            db.session.add(record)
            db.session.commit()
        except Exception:
            db.session.rollback()
            raise
        _last_marked_at[user_id] = now_mono
        return {'marked': True, 'reason': 'marked', 'attendance': record}


def _user_lock(user_id):
    with _locks_guard:
        if user_id not in _locks:
            _locks[user_id] = Lock()
        return _locks[user_id]
