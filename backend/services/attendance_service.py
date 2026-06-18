import time
from datetime import datetime, timedelta
from threading import Lock

from sqlalchemy.exc import IntegrityError

from database import db
from models.attendance import Attendance


DEFAULT_COOLDOWN_SECONDS = 60
_last_marked_at = {}
_marked_day_cache = set()
_locks = {}
_locks_guard = Lock()
_cache_guard = Lock()
_cache_day = None


def today_bounds(now=None):
    now = now or datetime.now()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def attendance_for_session(user_id, session_id, now=None):
    day = (now or datetime.now()).date()
    if session_id is None:
        return Attendance.query.filter(
            Attendance.user_id == int(user_id),
            Attendance.attendance_date == day,
            Attendance.session_id.is_(None)
        ).first()
    else:
        return Attendance.query.filter(
            Attendance.user_id == int(user_id),
            Attendance.attendance_date == day,
            Attendance.session_id == int(session_id)
        ).first()


def mark_attendance_once(
    user_id,
    session_id=None,
    status="present",
    marked_by_id=None,
    note=None,
    cooldown_seconds=None,
):
    user_id = int(user_id)
    if session_id is not None and str(session_id).strip() not in ('', '0', 'null', 'None'):
        session_id = int(session_id)
    else:
        session_id = None

    now = datetime.now()
    day = now.date()
    cooldown = _configured_cooldown(cooldown_seconds)

    _reset_daily_cache_if_needed(day)
    cache_key = (user_id, session_id, day)
    cooldown_key = (user_id, session_id)

    with _user_lock(user_id):
        if cache_key in _marked_day_cache:
            return {"marked": False, "reason": "already_marked_today", "attendance": None}

        now_mono = time.monotonic()
        last_mono = _last_marked_at.get(cooldown_key)
        if last_mono and now_mono - last_mono < cooldown:
            return {"marked": False, "reason": "cooldown", "attendance": None}

        existing = attendance_for_session(user_id, session_id, now=now)
        if existing:
            _marked_day_cache.add(cache_key)
            return {
                "marked": False,
                "reason": "already_marked_today",
                "attendance": existing,
            }

        record = Attendance(
            user_id=user_id,
            session_id=session_id,
            attendance_date=day,
            timestamp=now,
            status=status,
            marked_by_id=marked_by_id,
            note=note,
        )
        try:
            db.session.add(record)
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            existing = attendance_for_session(user_id, session_id, now=now)
            _marked_day_cache.add(cache_key)
            return {
                "marked": False,
                "reason": "already_marked_today",
                "attendance": existing,
            }
        except Exception:
            db.session.rollback()
            raise

        _last_marked_at[cooldown_key] = now_mono
        _marked_day_cache.add(cache_key)
        _prune_cooldown_cache(now_mono, cooldown)
        return {"marked": True, "reason": "marked", "attendance": record}


def _configured_cooldown(override):
    if override is not None:
        return int(override)
    try:
        from models.unknown_face import SystemConfig

        return int(SystemConfig.get("attendance_cooldown_seconds", DEFAULT_COOLDOWN_SECONDS))
    except Exception:
        return DEFAULT_COOLDOWN_SECONDS


def _reset_daily_cache_if_needed(day):
    global _cache_day
    with _cache_guard:
        if _cache_day != day:
            _marked_day_cache.clear()
            _cache_day = day


def _prune_cooldown_cache(now_mono, cooldown):
    stale = [
        uid
        for uid, last in _last_marked_at.items()
        if now_mono - last > max(cooldown * 4, 3600)
    ]
    for uid in stale:
        _last_marked_at.pop(uid, None)


def _user_lock(user_id):
    with _locks_guard:
        if user_id not in _locks:
            _locks[user_id] = Lock()
        return _locks[user_id]
