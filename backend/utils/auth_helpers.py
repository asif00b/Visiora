from functools import wraps
from flask import jsonify
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request


def _get_current_user():
    from models.user import User
    # JWT identity is stored as string; convert back to int for DB lookup
    raw_id = get_jwt_identity()
    try:
        user_id = int(raw_id)
    except (TypeError, ValueError):
        return None
    return User.query.get(user_id)


def require_role(*allowed_roles):
    """
    Decorator — only allows users whose role is in allowed_roles.
    Usage: @require_role('admin', 'hr')
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            user = _get_current_user()
            if not user:
                return jsonify({'success': False, 'message': 'User not found'}), 404
            if not user.is_active:
                return jsonify({'success': False, 'message': 'Account disabled'}), 403
            if user.role not in allowed_roles:
                return jsonify({
                    'success': False,
                    'message': f'Access denied. Required roles: {", ".join(allowed_roles)}'
                }), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def require_auth(fn):
    """Decorator — requires any valid JWT (any role)."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        verify_jwt_in_request()
        user = _get_current_user()
        if not user:
            return jsonify({'success': False, 'message': 'User not found'}), 404
        if not user.is_active:
            return jsonify({'success': False, 'message': 'Account disabled'}), 403
        return fn(*args, **kwargs)
    return wrapper


def get_current_user():
    """Helper for routes — returns current User object from JWT."""
    return _get_current_user()
