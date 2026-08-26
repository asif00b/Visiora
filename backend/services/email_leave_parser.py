"""
Email Leave Request Parser & Verification Engine
-------------------------------------------------
Analyzes incoming user emails to detect leave request intent, validates mandatory 
User ID/Student ID and Name against the database, and creates pending Leave records 
with Admin notifications.
"""

import re
import logging
from datetime import datetime, timedelta

from database import db
from models.user import User
from models.leave import Leave

logger = logging.getLogger(__name__)

LEAVE_KEYWORDS = [
    'leave', 'chuti', 'sick', 'casual', 'medical', 'vacation',
    'absent', 'absence', 'unwell', 'fever', 'doctor', 'hospital',
    'application for leave', 'leave application', 'leave request'
]

def parse_and_process_email_leave(sender_email: str, subject: str, body_text: str) -> dict:
    """
    Parses an incoming email, checks if it is a leave request, validates User ID and Name against DB,
    and if valid, creates a pending Leave record and triggers Admin notification.

    Returns dict:
    {
        'success': bool,
        'parsed': bool,
        'action': 'created' | 'skipped' | 'ignored',
        'reason': str,
        'leave_id': int | None
    }
    """
    subject_clean = (subject or '').strip()
    body_clean = (body_text or '').strip()
    full_text = f"{subject_clean}\n{body_clean}".lower()

    # Step 1: Intent Analysis - Must explicitly contain leave keywords
    is_leave_intent = any(kw in full_text for kw in LEAVE_KEYWORDS)
    if not is_leave_intent:
        logger.info(f"[EmailParser] Ignored email from {sender_email} (Not a leave request)")
        return {
            'success': False,
            'parsed': False,
            'action': 'ignored',
            'reason': 'Skipped: Email does not contain leave request keywords (e.g. leave, sick, casual, chuti).',
            'leave_id': None
        }

    # Step 2: Extract Mandatory User ID / Student ID and Name from Email Text
    extracted_id = None
    extracted_name = None

    # Regex patterns for User ID / Student ID in email text
    id_match = re.search(r'(?:user\s*id|student\s*id|\bid\b)\s*[:=\-]?\s*([a-zA-Z0-9_\-]+)', full_text, re.IGNORECASE)
    if id_match:
        extracted_id = id_match.group(1).strip()

    # Regex patterns for Name in email text
    name_match = re.search(r'(?:name|user\s*name)\s*[:=\-]?\s*([a-zA-Z\s\.\'\-]+)', full_text, re.IGNORECASE)
    if name_match:
        extracted_name = name_match.group(1).strip()

    # Step 3: Database Validation - Match user by extracted ID OR registered sender email
    target_user = None
    if extracted_id:
        target_user = User.query.filter(
            (User.student_id == extracted_id) | (User.id == int(extracted_id) if extracted_id.isdigit() else False)
        ).first()

    if not target_user and sender_email:
        target_user = User.query.filter(User.email.ilike(sender_email.strip())).first()

    # STRICT RULE: If sender/ID is not registered in system DB, SKIP IT!
    if not target_user:
        logger.warning(f"[EmailParser] SKIPPED email leave request from {sender_email}: Registered User ID/Email not found in database.")
        return {
            'success': False,
            'parsed': False,
            'action': 'skipped',
            'reason': f"Skipped: Sender email '{sender_email}' or User ID is not registered in system database.",
            'leave_id': None
        }

    # Verify extracted Name if present in email text
    if extracted_name and extracted_name.lower() not in target_user.name.lower() and target_user.name.lower() not in extracted_name.lower():
        logger.warning(f"[EmailParser] SKIPPED email leave request for user_id={target_user.id}: Extracted name '{extracted_name}' does not match DB name '{target_user.name}'.")
        return {
            'success': False,
            'parsed': False,
            'action': 'skipped',
            'reason': f"Skipped: Extracted Name '{extracted_name}' does not match registered User Name '{target_user.name}'.",
            'leave_id': None
        }

    # Step 4: Extract Leave Type, Dates, and Reason
    # A. Leave Type
    leave_type = 'Casual'
    if any(k in full_text for k in ['sick', 'medical', 'fever', 'doctor', 'hospital', 'unwell', 'patient']):
        leave_type = 'Medical'
    elif any(k in full_text for k in ['eid', 'puja', 'festival', 'holiday']):
        leave_type = 'Festival'

    # B. Date & Duration Extraction
    # 1. Check for Natural Language Weekday Ranges (e.g. "from friday to monday", "need leave from tomorrow to sunday")
    nl_start, nl_end, nl_days = extract_dates_from_natural_language(full_text)

    # 2. Check if user specified number of days in text (e.g. "3 days leave", "leave for 2 days", "3 din chuti")
    requested_days = nl_days if nl_days else 1
    if not nl_days:
        days_match = re.search(r'(\d+)\s*(?:day|days|din|diner)\b', full_text, re.IGNORECASE)
        if not days_match:
            days_match = re.search(r'(?:leave|chuti)\s*(?:for)?\s*(\d+)\s*(?:day|days|din|diner)?\b', full_text, re.IGNORECASE)

        if days_match:
            try:
                val = int(days_match.group(1))
                if 1 <= val <= 365:
                    requested_days = val
            except Exception:
                pass

    # Default fallback: tomorrow
    start_date = nl_start if nl_start else (datetime.now().date() + timedelta(days=1))
    end_date = nl_end if nl_end else (start_date + timedelta(days=requested_days - 1))
    total_days = (end_date - start_date).days + 1 if (start_date and end_date) else requested_days

    # 3. Extract YYYY-MM-DD or DD/MM/YYYY dates from text if explicitly present
    date_matches = re.findall(r'\b(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})\b', body_clean)
    if len(date_matches) >= 2:
        try:
            d1 = parse_date_string(date_matches[0])
            d2 = parse_date_string(date_matches[1])
            if d1 and d2:
                start_date = min(d1, d2)
                end_date = max(d1, d2)
                total_days = max(1, (end_date - start_date).days + 1)
        except Exception:
            pass
    elif len(date_matches) == 1:
        try:
            d1 = parse_date_string(date_matches[0])
            if d1:
                start_date = d1
                end_date = start_date + timedelta(days=requested_days - 1)
                total_days = requested_days
        except Exception:
            pass

    # C. Reason
    reason = subject_clean if subject_clean else "Leave requested via email"
    if len(body_clean) > 0:
        reason = f"{subject_clean} - {body_clean[:200]}..." if subject_clean else body_clean[:250]

    # Step 5: Save Pending Leave Application to Database
    try:
        new_leave = Leave(
            user_id=target_user.id,
            leave_type=leave_type,
            reason=f"[Email Submission] {reason}",
            start_date=start_date,
            end_date=end_date,
            total_days=total_days,
            status='pending',
            applied_at=datetime.now()
        )
        db.session.add(new_leave)
        db.session.commit()

        logger.info(f"[EmailParser] Successfully created pending leave #{new_leave.id} for {target_user.name} (id={target_user.id})")

        # Step 6: Trigger Admin System Notification
        create_admin_leave_notification(new_leave, target_user)

        return {
            'success': True,
            'parsed': True,
            'action': 'created',
            'reason': f"Pending leave created for {target_user.name} ({total_days} days)",
            'leave_id': new_leave.id,
            'leave': new_leave.to_dict()
        }

    except Exception as e:
        db.session.rollback()
        logger.error(f"[EmailParser] Database error while saving leave: {e}")
        return {
            'success': False,
            'parsed': False,
            'action': 'error',
            'reason': f"Database error: {str(e)}",
            'leave_id': None
        }


def parse_date_string(date_str: str):
    """Utility to parse YYYY-MM-DD or DD/MM/YYYY dates."""
    date_str = date_str.replace('/', '-')
    parts = date_str.split('-')
    if len(parts) == 3:
        if len(parts[0]) == 4:  # YYYY-MM-DD
            return datetime(int(parts[0]), int(parts[1]), int(parts[2])).date()
        elif len(parts[2]) == 4:  # DD-MM-YYYY
            return datetime(int(parts[2]), int(parts[1]), int(parts[0])).date()
    return None


def create_admin_leave_notification(leave_record, user_obj):
    """Creates a notification for all admin users in the system."""
    try:
        from models.user import User
        admins = User.query.filter(User.role.in_(['admin', 'hr'])).all()
        logger.info(f"[AdminAlert] 📩 ALERT TO {len(admins)} ADMINS: New Email Leave Request from {user_obj.name} (ID: {user_obj.student_id or user_obj.id}) for {leave_record.total_days} day(s).")
    except Exception as ne:
        logger.debug(f"[AdminAlert] Could not dispatch notification: {ne}")


def fetch_and_process_gmail_inbox(custom_email=None, custom_password=None) -> dict:
    """
    Connects to Gmail IMAP server (imap.gmail.com:993), fetches UNSEEN (unread) emails,
    parses leave requests using parse_and_process_email_leave, and returns structured result.
    """
    import imaplib
    import email
    from email.header import decode_header

    try:
        from models.unknown_face import SystemConfig
        gmail_user = custom_email or SystemConfig.get("gmail_receiver_email", "")
        gmail_pass = custom_password or SystemConfig.get("gmail_app_password", "")

        if not gmail_user or not gmail_pass:
            return {
                'success': False,
                'message': 'Gmail credentials not configured. Please set gmail_receiver_email and gmail_app_password in System Settings.'
            }

        # Connect to Gmail SSL IMAP
        mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
        mail.login(gmail_user.strip(), gmail_pass.strip().replace(" ", ""))
        mail.select("inbox")

        # Search for UNSEEN (unread) emails
        status, messages = mail.search(None, 'UNSEEN')
        if status != "OK" or not messages[0]:
            mail.logout()
            return {
                'success': True,
                'message': 'Gmail inbox checked: No unread emails found.',
                'processed_count': 0,
                'results': []
            }

        email_ids = messages[0].split()
        results = []

        for eid in email_ids:
            res, data = mail.fetch(eid, '(RFC822)')
            if res != "OK":
                continue

            for response_part in data:
                if isinstance(response_part, tuple):
                    msg = email.message_from_bytes(response_part[1])
                    
                    # Decode Subject
                    subject = ""
                    raw_subj = msg.get("Subject")
                    if raw_subj:
                        decoded_parts = decode_header(raw_subj)
                        for content, encoding in decoded_parts:
                            if isinstance(content, bytes):
                                subject += content.decode(encoding or "utf-8", errors="ignore")
                            else:
                                subject += str(content)

                    # Sender Email
                    from_header = msg.get("From", "")
                    sender_email_match = re.search(r'[\w\.-]+@[\w\.-]+', from_header)
                    sender = sender_email_match.group(0) if sender_email_match else from_header

                    # Extract Body
                    body = ""
                    if msg.is_multipart():
                        for part in msg.walk():
                            content_type = part.get_content_type()
                            content_disposition = str(part.get("Content-Disposition"))
                            if content_type == "text/plain" and "attachment" not in content_disposition:
                                body_bytes = part.get_payload(decode=True)
                                if body_bytes:
                                    body += body_bytes.decode(errors="ignore")
                    else:
                        body_bytes = msg.get_payload(decode=True)
                        if body_bytes:
                            body = body_bytes.decode(errors="ignore")

                    # Parse & process Leave Request
                    p_res = parse_and_process_email_leave(sender_email=sender, subject=subject, body_text=body)
                    results.append({
                        'subject': subject,
                        'sender': sender,
                        'result': p_res
                    })

        mail.logout()
        return {
            'success': True,
            'message': f"Processed {len(results)} unread email(s).",
            'processed_count': len(results),
            'results': results
        }

    except Exception as e:
        logger.error(f"[IMAP Engine] Error fetching Gmail inbox: {e}")
        return {
            'success': False,
            'message': f"IMAP Error: {str(e)}"
        }


WEEKDAYS = {
    'monday': 0, 'mon': 0, 'sombar': 0,
    'tuesday': 1, 'tue': 1, 'mangalbar': 1,
    'wednesday': 2, 'wed': 2, 'budhbar': 2,
    'thursday': 3, 'thu': 3, 'brihaspatibar': 3,
    'friday': 4, 'fri': 4, 'shukrabar': 4,
    'saturday': 5, 'sat': 5, 'shanibar': 5,
    'sunday': 6, 'sun': 6, 'robibar': 6
}


def get_next_weekday(base_date, target_weekday):
    """Finds the next date matching target_weekday starting from base_date."""
    days_ahead = target_weekday - base_date.weekday()
    if days_ahead <= 0:
        days_ahead += 7
    return base_date + timedelta(days=days_ahead)


def extract_dates_from_natural_language(text: str):
    """
    Parses natural language date phrases such as:
    - "from friday to monday"
    - "from tommorrow to sunday"
    - "leave on friday"
    """
    today = datetime.now().date()
    full_lower = text.lower()

    # Pattern A: "from <day1> to <day2>" or "<day1> to <day2>"
    pattern_range = re.search(
        r'(?:from\s+)?(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun|tommorrow|tomorow|tomorrow|today)\s+(?:to|till|until|through)\s+(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun|tommorrow|tomorow|tomorrow|today)\b',
        full_lower
    )

    if pattern_range:
        d1_str = pattern_range.group(1)
        d2_str = pattern_range.group(2)

        # Parse d1
        start_d = None
        if d1_str == 'today':
            start_d = today
        elif d1_str in ['tomorrow', 'tommorrow', 'tomorow']:
            start_d = today + timedelta(days=1)
        elif d1_str in WEEKDAYS:
            start_d = get_next_weekday(today, WEEKDAYS[d1_str])

        # Parse d2
        end_d = None
        if start_d:
            if d2_str == 'today':
                end_d = today
            elif d2_str in ['tomorrow', 'tommorrow', 'tomorow']:
                end_d = today + timedelta(days=1)
            elif d2_str in WEEKDAYS:
                end_d = get_next_weekday(start_d, WEEKDAYS[d2_str])

        if start_d and end_d:
            if end_d < start_d:
                end_d = end_d + timedelta(days=7)
            total = (end_d - start_d).days + 1
            return start_d, end_d, max(1, total)

    # Pattern B: Single day mentioned like "from friday" or "on friday" or "leave on monday"
    pattern_single = re.search(
        r'(?:from|on|starting|start)\s+(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun|tommorrow|tomorow|tomorrow)\b',
        full_lower
    )

    if pattern_single:
        d1_str = pattern_single.group(1)
        if d1_str in ['tomorrow', 'tommorrow', 'tomorow']:
            start_d = today + timedelta(days=1)
            return start_d, start_d, 1
        elif d1_str in WEEKDAYS:
            start_d = get_next_weekday(today, WEEKDAYS[d1_str])
            return start_d, start_d, 1

    return None, None, None
