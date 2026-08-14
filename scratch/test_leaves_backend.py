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
    print("Testing Draft Leave Logic...")
    admin = User.query.filter_by(role='admin').first()
    if not admin:
        print("No admin user found.")
        sys.exit(1)

    # Delete existing test leaves for clean test
    Leave.query.filter_by(user_id=admin.id).delete()
    db.session.commit()

    # Create a draft leave
    draft = Leave(
        user_id=admin.id,
        leave_type='Casual',
        reason='Draft leave test',
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 5),
        total_days=5,
        status='draft',
        applied_at=datetime.now()
    )
    db.session.add(draft)
    db.session.commit()

    summary = _calculate_user_leave_summary(admin.id)
    print("Summary with draft leave:", summary)
    # Draft should NOT count as pending or taken
    assert summary['leave_taken'] == 0
    assert summary['pending_leave'] == 0
    assert summary['remaining_leave'] == 25

    # Update draft to pending
    draft.status = 'pending'
    db.session.commit()

    summary2 = _calculate_user_leave_summary(admin.id)
    print("Summary after submitting draft to pending:", summary2)
    assert summary2['pending_leave'] == 5
    assert summary2['leave_taken'] == 0
    assert summary2['remaining_leave'] == 25

    # Clean up
    db.session.delete(draft)
    db.session.commit()
    print("Draft Leave Logic Test SUCCESSFUL!")
