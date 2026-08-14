import logging
from datetime import datetime, date
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from database import db
from models.leave import Leave
from models.user import User
from utils.auth_helpers import require_role, require_auth, get_current_user

leaves_bp = Blueprint('leaves', __name__)
logger = logging.getLogger(__name__)

YEARLY_ENTITLEMENT_DAYS = 25
VALID_LEAVE_TYPES = ['Casual', 'Medical', 'Festival']


def _calculate_user_leave_summary(user_id: int):
    """Calculate yearly entitlement summary for a given user."""
    current_year = datetime.now().year
    year_start = date(current_year, 1, 1)
    year_end = date(current_year, 12, 31)

    # Approved leaves in current year
    approved_leaves = Leave.query.filter(
        Leave.user_id == user_id,
        Leave.status == 'approved',
        Leave.start_date >= year_start,
        Leave.start_date <= year_end
    ).all()
    leave_taken = sum(l.total_days for l in approved_leaves)

    # Pending leaves in current year
    pending_leaves = Leave.query.filter(
        Leave.user_id == user_id,
        Leave.status == 'pending',
        Leave.start_date >= year_start,
        Leave.start_date <= year_end
    ).all()
    pending_days = sum(l.total_days for l in pending_leaves)

    remaining_leave = max(0, YEARLY_ENTITLEMENT_DAYS - leave_taken)

    # Last approved leave date
    latest_approved = Leave.query.filter(
        Leave.user_id == user_id,
        Leave.status == 'approved'
    ).order_by(Leave.end_date.desc()).first()

    last_leave_date_str = latest_approved.end_date.strftime('%d %b %Y') if (latest_approved and latest_approved.end_date) else 'None'

    return {
        'yearly_entitlement': YEARLY_ENTITLEMENT_DAYS,
        'leave_taken': leave_taken,
        'pending_leave': pending_days,
        'remaining_leave': remaining_leave,
        'last_leave_date': last_leave_date_str,
    }


@leaves_bp.route('/leaves/summary', methods=['GET'])
@jwt_required()
@require_auth
def get_my_summary():
    """Get leave summary for current user."""
    try:
        current = get_current_user()
        summary = _calculate_user_leave_summary(current.id)
        return jsonify({'success': True, 'summary': summary}), 200
    except Exception as e:
        logger.error(f'[Leaves] Summary error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@leaves_bp.route('/leaves/users', methods=['GET'])
@jwt_required()
@require_auth
def get_alternative_users():
    """Get list of active users to select as an alternative user during leave."""
    try:
        current = get_current_user()
        users = User.query.filter(
            User.is_active == True,
            User.id != current.id
        ).order_by(User.name.asc()).all()

        user_list = [{
            'id': u.id,
            'name': u.name,
            'email': u.email,
            'student_id': u.student_id or '—',
            'department_name': u.department.name if u.department else 'General',
        } for u in users]

        return jsonify({'success': True, 'users': user_list}), 200
    except Exception as e:
        logger.error(f'[Leaves] Alternative users error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@leaves_bp.route('/leaves/apply', methods=['POST'])
@jwt_required()
@require_auth
def apply_leave():
    """Apply for a new leave."""
    try:
        current = get_current_user()
        data = request.get_json() or {}

        leave_type = data.get('leave_type')
        reason = data.get('reason')
        start_date_str = data.get('start_date')
        end_date_str = data.get('end_date')
        alt_user_id = data.get('alternative_user_id')

        if not leave_type or leave_type not in VALID_LEAVE_TYPES:
            return jsonify({
                'success': False,
                'message': f'Invalid leave type. Must be one of: {", ".join(VALID_LEAVE_TYPES)}'
            }), 400

        if not reason or not str(reason).strip():
            return jsonify({'success': False, 'message': 'Leave reason is required'}), 400

        if not start_date_str or not end_date_str:
            return jsonify({'success': False, 'message': 'Start date and end date are required'}), 400

        try:
            start_d = datetime.strptime(start_date_str, '%Y-%m-%d').date()
            end_d = datetime.strptime(end_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'success': False, 'message': 'Dates must be in YYYY-MM-DD format'}), 400

        if start_d > end_d:
            return jsonify({'success': False, 'message': 'Start date cannot be after end date'}), 400

        total_days = (end_d - start_d).days + 1

        # Calculate remaining entitlement
        summary = _calculate_user_leave_summary(current.id)
        if total_days > summary['remaining_leave']:
            return jsonify({
                'success': False,
                'message': f'Requested leave ({total_days} days) exceeds your remaining leave balance ({summary["remaining_leave"]} days).'
            }), 400

        # Optional alternative user check
        parsed_alt_id = None
        if alt_user_id and str(alt_user_id).strip() not in ('', 'null', 'None'):
            parsed_alt_id = int(alt_user_id)
            if parsed_alt_id != current.id:
                alt_user = User.query.get(parsed_alt_id)
                if not alt_user:
                    return jsonify({'success': False, 'message': 'Selected alternative user does not exist'}), 400

        leave = Leave(
            user_id=current.id,
            leave_type=leave_type,
            reason=str(reason).strip(),
            start_date=start_d,
            end_date=end_d,
            total_days=total_days,
            alternative_user_id=parsed_alt_id,
            status='pending',
            applied_at=datetime.now()
        )
        db.session.add(leave)
        db.session.commit()

        logger.info(f'[Leaves] User {current.id} ({current.name}) applied for {total_days} day(s) {leave_type} leave')

        return jsonify({
            'success': True,
            'message': 'Leave application submitted successfully!',
            'leave': leave.to_dict(),
            'summary': _calculate_user_leave_summary(current.id)
        }), 201

    except Exception as e:
        db.session.rollback()
        logger.error(f'[Leaves] Apply error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@leaves_bp.route('/leaves/my-leaves', methods=['GET'])
@jwt_required()
@require_auth
def get_my_leaves():
    """Get logged in user's leave applications and summary."""
    try:
        current = get_current_user()
        leaves = Leave.query.filter_by(user_id=current.id).order_by(Leave.applied_at.desc()).all()
        summary = _calculate_user_leave_summary(current.id)

        return jsonify({
            'success': True,
            'leaves': [l.to_dict() for l in leaves],
            'summary': summary
        }), 200
    except Exception as e:
        logger.error(f'[Leaves] My leaves error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@leaves_bp.route('/leaves/all', methods=['GET'])
@jwt_required()
@require_role('admin', 'hr')
def get_all_leaves():
    """Get all leave applications for review (Admin & HR)."""
    try:
        q = Leave.query.join(User, Leave.user_id == User.id)

        status_filter = request.args.get('status')
        dept_id_filter = request.args.get('dept_id', type=int)
        user_id_filter = request.args.get('user_id', type=int)

        if status_filter and status_filter.lower() in ['pending', 'approved', 'rejected']:
            q = q.filter(Leave.status == status_filter.lower())
        if dept_id_filter:
            q = q.filter(User.dept_id == dept_id_filter)
        if user_id_filter:
            q = q.filter(Leave.user_id == user_id_filter)

        leaves = q.order_by(Leave.applied_at.desc()).limit(500).all()

        return jsonify({
            'success': True,
            'count': len(leaves),
            'leaves': [l.to_dict() for l in leaves]
        }), 200
    except Exception as e:
        logger.error(f'[Leaves] All leaves error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@leaves_bp.route('/leaves/<int:leave_id>/review', methods=['PUT'])
@jwt_required()
@require_role('admin', 'hr')
def review_leave(leave_id):
    """Approve or reject a leave application."""
    try:
        current = get_current_user()
        leave = Leave.query.get_or_404(leave_id)
        data = request.get_json() or {}

        action = str(data.get('status') or data.get('action')).lower().strip()
        admin_comment = data.get('admin_comment') or data.get('rejection_reason')

        if action not in ['approved', 'rejected']:
            return jsonify({'success': False, 'message': 'Status must be approved or rejected'}), 400

        leave.status = action
        leave.reviewed_by_id = current.id
        leave.reviewed_at = datetime.now()
        if admin_comment is not None:
            leave.admin_comment = str(admin_comment).strip()

        db.session.commit()

        logger.info(f'[Leaves] Leave {leave_id} reviewed by {current.name}: {action}')

        return jsonify({
            'success': True,
            'message': f'Leave application {action} successfully!',
            'leave': leave.to_dict()
        }), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f'[Leaves] Review error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@leaves_bp.route('/leaves/<int:leave_id>', methods=['DELETE'])
@jwt_required()
@require_auth
def delete_leave(leave_id):
    """Cancel / Delete a leave application."""
    try:
        current = get_current_user()
        leave = Leave.query.get_or_404(leave_id)

        # Non-admins can only cancel their own pending requests
        if current.role in ['user', 'student'] and leave.user_id != current.id:
            return jsonify({'success': False, 'message': 'Access denied'}), 403

        if current.role in ['user', 'student'] and leave.status != 'pending':
            return jsonify({'success': False, 'message': 'Cannot cancel an application that is already approved or rejected'}), 400

        db.session.delete(leave)
        db.session.commit()

        logger.info(f'[Leaves] Leave {leave_id} deleted/cancelled by user {current.id}')

        return jsonify({'success': True, 'message': 'Leave application cancelled successfully'}), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f'[Leaves] Delete error: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500
