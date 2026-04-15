from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from database import db
from models.session_model import SessionModel
from utils.auth_helpers import require_role, require_auth

sessions_bp = Blueprint('sessions', __name__)


def _parse_time(t_str):
    """Parse HH:MM string to time object."""
    if not t_str:
        return None
    try:
        return datetime.strptime(t_str, '%H:%M').time()
    except ValueError:
        return None


def _parse_date(d_str):
    """Parse YYYY-MM-DD string to date object."""
    if not d_str:
        return None
    try:
        return datetime.strptime(d_str, '%Y-%m-%d').date()
    except ValueError:
        return None


@sessions_bp.route('/sessions', methods=['GET'])
@jwt_required()
@require_auth
def list_sessions():
    sessions = SessionModel.query.order_by(SessionModel.created_at.desc()).all()
    return jsonify({'success': True, 'sessions': [s.to_dict() for s in sessions]}), 200


@sessions_bp.route('/sessions/active', methods=['GET'])
@jwt_required()
@require_auth
def active_sessions():
    """Return sessions that are currently active (within time window)."""
    sessions = SessionModel.query.filter_by(is_active=True).all()
    active = [s for s in sessions if s.is_currently_active()]
    return jsonify({'success': True, 'sessions': [s.to_dict() for s in active]}), 200


@sessions_bp.route('/sessions', methods=['POST'])
@jwt_required()
@require_role('admin')
def create_session():
    data = request.get_json()
    if not data.get('name'):
        return jsonify({'success': False, 'message': 'Name required'}), 400

    session = SessionModel(
        name=data['name'],
        description=data.get('description'),
        start_time=_parse_time(data.get('start_time')),
        end_time=_parse_time(data.get('end_time')),
        valid_from=_parse_date(data.get('valid_from')),
        valid_to=_parse_date(data.get('valid_to')),
        allow_multiple=data.get('allow_multiple', False),
        cooldown_minutes=int(data.get('cooldown_minutes', 10)),
        is_active=data.get('is_active', True),
    )
    db.session.add(session)
    db.session.commit()
    return jsonify({'success': True, 'session': session.to_dict()}), 201


@sessions_bp.route('/sessions/<int:sid>', methods=['PUT'])
@jwt_required()
@require_role('admin')
def update_session(sid):
    session = SessionModel.query.get_or_404(sid)
    data = request.get_json()

    if 'name' in data:
        session.name = data['name']
    if 'description' in data:
        session.description = data['description']
    if 'start_time' in data:
        session.start_time = _parse_time(data['start_time'])
    if 'end_time' in data:
        session.end_time = _parse_time(data['end_time'])
    if 'valid_from' in data:
        session.valid_from = _parse_date(data['valid_from'])
    if 'valid_to' in data:
        session.valid_to = _parse_date(data['valid_to'])
    if 'allow_multiple' in data:
        session.allow_multiple = data['allow_multiple']
    if 'cooldown_minutes' in data:
        session.cooldown_minutes = int(data['cooldown_minutes'])
    if 'is_active' in data:
        session.is_active = data['is_active']

    db.session.commit()
    return jsonify({'success': True, 'session': session.to_dict()}), 200


@sessions_bp.route('/sessions/<int:sid>', methods=['DELETE'])
@jwt_required()
@require_role('admin')
def delete_session(sid):
    session = SessionModel.query.get_or_404(sid)
    db.session.delete(session)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Session deleted'}), 200
