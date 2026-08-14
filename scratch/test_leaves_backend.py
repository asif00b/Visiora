import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app import create_app
from database import db
from models.user import User
from models.leave import Leave
from routes.leaves import _calculate_user_leave_summary
from datetime import date, datetime

app = create_app()

with app.app_context():
    print("Testing DB Connection & Leave Table...")

    admin = User.query.filter_by(role='admin').first()
    if not admin:
        print("No admin user found.")
        sys.exit(1)

    print(f"Admin User: {admin.name} (ID: {admin.id})")

    # Clear existing test leaves if any
    Leave.query.filter_by(user_id=admin.id).delete()
    db.session.commit()

    # Test summary calculation on empty
    summary = _calculate_user_leave_summary(admin.id)
    print("Empty Summary:", summary)
    assert summary['yearly_entitlement'] == 25
    assert summary['leave_taken'] == 0
    assert summary['remaining_leave'] == 25

    # Create an approved leave
    l1 = Leave(
        user_id=admin.id,
        leave_type='Casual',
        reason='Family event',
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 3),
        total_days=3,
        status='approved',
        applied_at=datetime.now()
    )
    db.session.add(l1)
    db.session.commit()

    summary2 = _calculate_user_leave_summary(admin.id)
    print("After 3-day approved leave summary:", summary2)
    assert summary2['leave_taken'] == 3
    assert summary2['remaining_leave'] == 22

    # Clean up test leave
    db.session.delete(l1)
    db.session.commit()
    print("Test Leave Backend SUCCESSFUL!")
