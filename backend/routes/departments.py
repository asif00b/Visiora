from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from database import db
from models.department import Department
from utils.auth_helpers import require_role, require_auth

departments_bp = Blueprint('departments', __name__)


@departments_bp.route('/departments', methods=['GET'])
@jwt_required()
@require_auth
def list_departments():
    depts = Department.query.order_by(Department.name).all()
    return jsonify({'success': True, 'departments': [d.to_dict() for d in depts]}), 200


@departments_bp.route('/departments', methods=['POST'])
@jwt_required()
@require_role('admin')
def create_department():
    data = request.get_json()
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'success': False, 'message': 'Name required'}), 400

    if Department.query.filter_by(name=name).first():
        return jsonify({'success': False, 'message': 'Department already exists'}), 409

    dept = Department(name=name, description=data.get('description'))
    db.session.add(dept)
    db.session.commit()
    return jsonify({'success': True, 'department': dept.to_dict()}), 201


@departments_bp.route('/departments/<int:did>', methods=['PUT'])
@jwt_required()
@require_role('admin')
def update_department(did):
    dept = Department.query.get_or_404(did)
    data = request.get_json()

    if 'name' in data:
        dept.name = data['name'].strip()
    if 'description' in data:
        dept.description = data['description']

    db.session.commit()
    return jsonify({'success': True, 'department': dept.to_dict()}), 200


@departments_bp.route('/departments/<int:did>', methods=['DELETE'])
@jwt_required()
@require_role('admin')
def delete_department(did):
    dept = Department.query.get_or_404(did)
    if dept.users:
        return jsonify({
            'success': False,
            'message': f'Cannot delete: {len(dept.users)} user(s) assigned. Reassign them first.'
        }), 400

    db.session.delete(dept)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Department deleted'}), 200
