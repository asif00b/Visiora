import io
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, make_response
from flask_jwt_extended import jwt_required

from database import db
from models.attendance import Attendance
from models.user import User
from models.session_model import SessionModel
from utils.auth_helpers import require_role, require_auth, get_current_user

attendance_bp = Blueprint('attendance', __name__)


@attendance_bp.route('/attendance/mark', methods=['POST'])
@jwt_required()
@require_role('admin', 'hr')
def mark_attendance():
    """Manually mark attendance for a user."""
    data = request.get_json()
    user_id = data.get('user_id')
    session_id = data.get('session_id')

    if not user_id:
        return jsonify({'success': False, 'message': 'user_id required'}), 400

    User.query.get_or_404(user_id)
    current = get_current_user()

    record = Attendance(
        user_id=user_id,
        session_id=session_id,
        status=data.get('status', 'manual'),
        marked_by_id=current.id,
        note=data.get('note'),
    )
    db.session.add(record)
    db.session.commit()
    return jsonify({'success': True, 'attendance': record.to_dict()}), 201


@attendance_bp.route('/attendance/report', methods=['GET'])
@jwt_required()
@require_role('admin', 'hr')
def attendance_report():
    """
    Filtered attendance report.
    Query params: user_id, session_id, dept_id, date_from, date_to, status
    """
    q = Attendance.query.join(User)

    user_id = request.args.get('user_id', type=int)
    session_id = request.args.get('session_id', type=int)
    dept_id = request.args.get('dept_id', type=int)
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    status = request.args.get('status')

    if user_id:
        q = q.filter(Attendance.user_id == user_id)
    if session_id:
        q = q.filter(Attendance.session_id == session_id)
    if dept_id:
        q = q.filter(User.dept_id == dept_id)
    if status:
        q = q.filter(Attendance.status == status)
    if date_from:
        try:
            dt = datetime.strptime(date_from, '%Y-%m-%d')
            q = q.filter(Attendance.timestamp >= dt)
        except ValueError:
            pass
    if date_to:
        try:
            dt = datetime.strptime(date_to, '%Y-%m-%d') + timedelta(days=1)
            q = q.filter(Attendance.timestamp < dt)
        except ValueError:
            pass

    records = q.order_by(Attendance.timestamp.desc()).limit(1000).all()
    return jsonify({
        'success': True,
        'count': len(records),
        'attendance': [r.to_dict() for r in records]
    }), 200


@attendance_bp.route('/attendance/user/<int:uid>', methods=['GET'])
@jwt_required()
@require_auth
def user_attendance(uid):
    current = get_current_user()
    if current.role == 'student' and current.id != uid:
        return jsonify({'success': False, 'message': 'Access denied'}), 403

    User.query.get_or_404(uid)
    records = (Attendance.query
               .filter_by(user_id=uid)
               .order_by(Attendance.timestamp.desc())
               .limit(200).all())

    return jsonify({
        'success': True,
        'attendance': [r.to_dict() for r in records]
    }), 200


@attendance_bp.route('/attendance/export', methods=['GET'])
@jwt_required()
@require_role('admin', 'hr')
def export_csv():
    """Export filtered attendance as CSV."""
    try:
        import pandas as pd
    except ImportError:
        return jsonify({'success': False, 'message': 'pandas not installed'}), 503

    q = Attendance.query.join(User)

    user_id = request.args.get('user_id', type=int)
    session_id = request.args.get('session_id', type=int)
    dept_id = request.args.get('dept_id', type=int)
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')

    if user_id:
        q = q.filter(Attendance.user_id == user_id)
    if session_id:
        q = q.filter(Attendance.session_id == session_id)
    if dept_id:
        q = q.filter(User.dept_id == dept_id)
    if date_from:
        try:
            q = q.filter(Attendance.timestamp >= datetime.strptime(date_from, '%Y-%m-%d'))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.filter(Attendance.timestamp < datetime.strptime(date_to, '%Y-%m-%d') + timedelta(days=1))
        except ValueError:
            pass

    records = q.order_by(Attendance.timestamp.desc()).all()

    rows = []
    for r in records:
        rows.append({
            'ID': r.id,
            'Student ID': r.user.student_id if r.user else '',
            'Name': r.user.name if r.user else '',
            'Department': r.user.department.name if r.user and r.user.department else '',
            'Session': r.session.name if r.session else 'General',
            'Date': r.timestamp.strftime('%Y-%m-%d') if r.timestamp else '',
            'Time': r.timestamp.strftime('%H:%M:%S') if r.timestamp else '',
            'Status': r.status,
            'Marked By': r.marked_by.name if r.marked_by else 'System',
        })

    df = pd.DataFrame(rows)
    csv_data = df.to_csv(index=False)

    response = make_response(csv_data)
    response.headers['Content-Type'] = 'text/csv'
    response.headers['Content-Disposition'] = (
        f'attachment; filename=attendance_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
    )
    return response


@attendance_bp.route('/attendance/stats', methods=['GET'])
@jwt_required()
@require_role('admin', 'hr')
def attendance_stats():
    """Summary stats for dashboard."""
    from sqlalchemy import func

    total_users = User.query.filter_by(is_active=True, role='student').count()
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = Attendance.query.filter(Attendance.timestamp >= today_start).count()
    total_records = Attendance.query.count()

    # Last 7 days trend
    trend = []
    for i in range(6, -1, -1):
        day = datetime.utcnow() - timedelta(days=i)
        day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        count = Attendance.query.filter(
            Attendance.timestamp >= day_start,
            Attendance.timestamp < day_end
        ).count()
        trend.append({'date': day.strftime('%Y-%m-%d'), 'count': count})

    return jsonify({
        'success': True,
        'stats': {
            'total_users': total_users,
            'today_count': today_count,
            'total_records': total_records,
            'trend': trend,
        }
    }), 200
