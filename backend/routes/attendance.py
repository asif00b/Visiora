import logging
import csv
import io
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, make_response
from flask_jwt_extended import jwt_required

from database import db
from models.attendance import Attendance
from models.user import User
from services.attendance_service import mark_attendance_once
from utils.auth_helpers import require_role, require_auth, get_current_user

attendance_bp = Blueprint('attendance', __name__)
logger        = logging.getLogger(__name__)


@attendance_bp.route('/attendance/mark', methods=['POST'])
@jwt_required()
@require_role('admin', 'hr')
def mark_attendance():
    """Manually mark attendance for a user."""
    try:
        data       = request.get_json() or {}
        user_id    = data.get('user_id')
        session_id = data.get('session_id')

        if not user_id:
            return jsonify({'success': False, 'message': 'user_id required'}), 400

        User.query.get_or_404(user_id)
        current = get_current_user()

        result = mark_attendance_once(
            user_id=user_id,
            session_id=session_id,
            status=data.get('status', 'manual'),
            marked_by_id=current.id,
            note=data.get('note'),
        )
        record = result.get('attendance')
        return jsonify({
            'success': True,
            'marked': result['marked'],
            'reason': result['reason'],
            'attendance': record.safe_to_dict() if record else None,
        }), 201 if result['marked'] else 200

    except Exception as e:
        db.session.rollback()
        logger.error(f'[Attendance] Mark error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@attendance_bp.route('/attendance/report', methods=['GET'])
@jwt_required()
@require_role('admin', 'hr')
def attendance_report():
    """
    Filtered attendance report.
    Query params: user_id, session_id, dept_id, date_from, date_to, status

    Always returns { success: true, attendance: [...], count: N }
    — never raises an unhandled exception.
    """
    try:
        q = Attendance.query.join(User, Attendance.user_id == User.id)

        user_id    = request.args.get('user_id',    type=int)
        session_id = request.args.get('session_id', type=int)
        dept_id    = request.args.get('dept_id',    type=int)
        date_from  = request.args.get('date_from')
        date_to    = request.args.get('date_to')
        status     = request.args.get('status')

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
                q  = q.filter(Attendance.timestamp >= dt)
            except ValueError:
                logger.warning(f'[Report] Invalid date_from: {date_from}')
        if date_to:
            try:
                dt = datetime.strptime(date_to, '%Y-%m-%d') + timedelta(days=1)
                q  = q.filter(Attendance.timestamp < dt)
            except ValueError:
                logger.warning(f'[Report] Invalid date_to: {date_to}')

        records = q.order_by(Attendance.timestamp.desc()).limit(1000).all()

        # Use safe_to_dict — never raises even on null relationships
        attendance_list = []
        for r in records:
            try:
                attendance_list.append(r.safe_to_dict())
            except Exception as re:
                logger.warning(f'[Report] Skipping record {r.id}: {re}')

        return jsonify({
            'success':    True,
            'count':      len(attendance_list),
            'attendance': attendance_list,
        }), 200

    except Exception as e:
        logger.error(f'[Report] Unexpected error: {e}')
        # Always return valid structured data — never a 500 to the frontend
        return jsonify({
            'success':    True,
            'count':      0,
            'attendance': [],
            'warning':    f'Report error: {str(e)}',
        }), 200


@attendance_bp.route('/attendance/user/<int:uid>', methods=['GET'])
@jwt_required()
@require_auth
def user_attendance(uid):
    try:
        current = get_current_user()
        if current.role in ['student', 'user'] and current.id != uid:
            return jsonify({'success': False, 'message': 'Access denied'}), 403

        User.query.get_or_404(uid)
        
        q = Attendance.query.filter_by(user_id=uid)

        session_id = request.args.get('session_id', type=int)
        date_from  = request.args.get('date_from')
        date_to    = request.args.get('date_to')
        status     = request.args.get('status')

        if session_id:
            q = q.filter(Attendance.session_id == session_id)
        if status:
            q = q.filter(Attendance.status == status)
        if date_from:
            try:
                dt = datetime.strptime(date_from, '%Y-%m-%d')
                q  = q.filter(Attendance.timestamp >= dt)
            except ValueError:
                pass
        if date_to:
            try:
                dt = datetime.strptime(date_to, '%Y-%m-%d') + timedelta(days=1)
                q  = q.filter(Attendance.timestamp < dt)
            except ValueError:
                pass

        records = q.order_by(Attendance.timestamp.desc()).limit(1000).all()

        return jsonify({
            'success':    True,
            'attendance': [r.safe_to_dict() for r in records],
        }), 200

    except Exception as e:
        logger.error(f'[Attendance] User attendance error uid={uid}: {e}')
        return jsonify({'success': True, 'attendance': []}), 200


@attendance_bp.route('/attendance/export', methods=['GET'])
@jwt_required()
@require_role('admin', 'hr')
def export_csv():
    """Export filtered attendance as CSV."""
    try:
        q = Attendance.query.join(User, Attendance.user_id == User.id)

        user_id    = request.args.get('user_id',    type=int)
        session_id = request.args.get('session_id', type=int)
        dept_id    = request.args.get('dept_id',    type=int)
        date_from  = request.args.get('date_from')
        date_to    = request.args.get('date_to')

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
            try:
                rows.append({
                    'ID':                   r.id,
                    'User ID':              r.user.student_id  if r.user else '',
                    'Name':                 r.user.name        if r.user else '',
                    'Department':           r.user.department.name if r.user and r.user.department else '',
                    'Session':              r.session.name     if r.session else 'General',
                    'Check-In Date':        r.timestamp.strftime('%Y-%m-%d') if r.timestamp else '',
                    'Check-In Time':        r.timestamp.strftime('%H:%M:%S') if r.timestamp else '',
                    'Punch Out Time':       r.punch_out.strftime('%Y-%m-%d %H:%M:%S') if r.punch_out else '',
                    'Hours Worked':         round(r.hours_worked or 0.0, 2),
                    'Status':               r.status,
                    'Core Hours Satisfied': 'Yes' if r.is_core_hours_satisfied else 'No',
                    'Marked By':            r.marked_by.name   if r.marked_by else 'System',
                })
            except Exception:
                pass

        output = io.StringIO()
        fields = ['ID', 'User ID', 'Name', 'Department', 'Session', 'Check-In Date', 'Check-In Time', 'Punch Out Time', 'Hours Worked', 'Status', 'Core Hours Satisfied', 'Marked By']
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
        csv_data = output.getvalue()

        response = make_response(csv_data)
        response.headers['Content-Type']        = 'text/csv'
        response.headers['Content-Disposition'] = (
            f'attachment; filename=attendance_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
        )
        return response

    except Exception as e:
        logger.error(f'[Export] CSV error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@attendance_bp.route('/attendance/stats', methods=['GET'])
@jwt_required()
@require_role('admin', 'hr')
def attendance_stats():
    """Summary stats for dashboard."""
    try:
        total_users  = User.query.filter(User.is_active == True, User.role != 'admin').count()
        today_start  = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        today_count  = Attendance.query.filter(Attendance.timestamp >= today_start).count()
        total_records = Attendance.query.count()

        # Detailed Today's Stats
        from sqlalchemy import func
        today_present_users = db.session.query(Attendance.user_id).filter(
            Attendance.timestamp >= today_start,
            Attendance.status.in_(['present', 'late', 'manual'])
        ).distinct().count()

        today_absent = max(0, total_users - today_present_users)
        
        today_presents_on_time = db.session.query(Attendance.user_id).filter(
            Attendance.timestamp >= today_start,
            Attendance.status == 'present'
        ).distinct().count()

        today_presents_late = db.session.query(Attendance.user_id).filter(
            Attendance.timestamp >= today_start,
            Attendance.status == 'late'
        ).distinct().count()

        today_presents_manual = db.session.query(Attendance.user_id).filter(
            Attendance.timestamp >= today_start,
            Attendance.status == 'manual'
        ).distinct().count()

        attendance_percentage = round((today_present_users / total_users * 100), 1) if total_users > 0 else 0.0

        # Recent 5 check-ins today
        recent_records = Attendance.query.filter(
            Attendance.timestamp >= today_start
        ).order_by(Attendance.timestamp.desc()).limit(5).all()
        recent_activity = [r.safe_to_dict() for r in recent_records]

        # Last 7 days trend
        trend = []
        for i in range(6, -1, -1):
            day       = datetime.now() - timedelta(days=i)
            day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end   = day_start + timedelta(days=1)
            count     = Attendance.query.filter(
                Attendance.timestamp >= day_start,
                Attendance.timestamp  < day_end
            ).count()
            trend.append({'date': day.strftime('%Y-%m-%d'), 'count': count})

        # Users without any face encodings
        from models.face_encoding import FaceEncoding
        registered_ids = db.session.query(FaceEncoding.user_id).distinct().subquery()
        no_face_count  = User.query.filter(
            User.is_active == True,
            ~User.id.in_(registered_ids),
        ).count()

        return jsonify({
            'success': True,
            'stats': {
                'total_users':   total_users,
                'today_count':   today_count,
                'total_records': total_records,
                'no_face_count': no_face_count,
                'trend':         trend,
                'today_present': today_present_users,
                'today_absent':  today_absent,
                'today_late':    today_presents_late,
                'today_on_time': today_presents_on_time,
                'today_manual':  today_presents_manual,
                'attendance_percentage': attendance_percentage,
                'recent_activity': recent_activity,
            }
        }), 200

    except Exception as e:
        logger.error(f'[Stats] Error: {e}')
        return jsonify({
            'success': True,
            'stats': {'total_users': 0, 'today_count': 0, 'total_records': 0, 'trend': []},
            'warning': str(e),
        }), 200
