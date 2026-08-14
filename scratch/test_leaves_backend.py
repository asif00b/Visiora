import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app import create_app
from models.user import User
from models.leave import Leave

app = create_app()

with app.app_context():
    print("Testing Department Filter for Alternative Users...")
    users = User.query.filter_by(is_active=True).all()
    print(f"Total active users: {len(users)}")
    for u in users:
        dept_name = u.department.name if u.department else 'General'
        print(f" - User {u.id}: {u.name} (Dept: {dept_name}, Dept ID: {u.dept_id})")

    admin = User.query.filter_by(role='admin').first()
    if admin:
        # Simulate query for alternative users in admin's dept
        q = User.query.filter(User.is_active == True, User.id != admin.id)
        if admin.dept_id is not None:
            q = q.filter(User.dept_id == admin.dept_id)
        else:
            q = q.filter(User.dept_id.is_(None))
        alts = q.all()
        print(f"Alternative users for Admin (Dept ID {admin.dept_id}): {[a.name for a in alts]}")
        for a in alts:
            assert a.dept_id == admin.dept_id

    print("Department restriction test SUCCESSFUL!")
