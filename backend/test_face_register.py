"""
test_face_register.py  — test face registration with a real photo
"""
import requests, base64, json, io, sys
import numpy as np

# Create a test face image using face_recognition's own test utilities
# Use a simple solid-color image — this tests the endpoint stack
print("Creating test image...")

try:
    import cv2
    # Create a realistic-looking face-sized image
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    img[:] = (120, 100, 80)  # background

    # Draw rough face shape (just for API stack testing — won't detect as real face)
    cv2.ellipse(img, (320, 240), (120, 150), 0, 0, 360, (220, 180, 140), -1)
    cv2.circle(img, (280, 200), 20, (50, 30, 20), -1)  # eye
    cv2.circle(img, (360, 200), 20, (50, 30, 20), -1)  # eye
    cv2.ellipse(img, (320, 280), (40, 20), 0, 0, 180, (160, 80, 80), 3)  # mouth

    _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    b64 = base64.b64encode(buf.tobytes()).decode()
    print("Test image created (640x480 synthetic face)")
except Exception as e:
    print(f"Image creation error: {e}")
    sys.exit(1)

# Login
print("\nLogging in...")
try:
    login = requests.post(
        'http://localhost:5000/api/login',
        json={'email': 'admin@system.com', 'password': 'admin123'},
        timeout=10
    )
    data = login.json()
    token = data.get('token', '')
    print(f"Login: {login.status_code} | Token: {'OK' if token else 'FAILED'}")
    if not token:
        print("ERROR: Login failed:", data)
        sys.exit(1)
except Exception as e:
    print(f"Login error: {e}")
    sys.exit(1)

headers = {'Authorization': f'Bearer {token}'}

# Get a user to test with
users = requests.get('http://localhost:5000/api/users', headers=headers, timeout=10).json()
all_users = users.get('users', [])
print(f"\nUsers in DB: {[u['name'] for u in all_users]}")

if not all_users:
    print("No users found — create a student first, then re-run this test.")
    sys.exit(0)

# Find first non-admin user or use the admin
test_user = next((u for u in all_users if u['role'] != 'admin'), all_users[0])
uid = test_user['id']
print(f"\nTesting registration for: {test_user['name']} (id={uid})")

# Test endpoint
print("Calling /api/face/register...")
try:
    reg = requests.post(
        'http://localhost:5000/api/face/register',
        json={
            'user_id': uid,
            'images': [f'data:image/jpeg;base64,{b64}']
        },
        headers=headers,
        timeout=60
    )
    print(f"\nStatus: {reg.status_code}")
    print(f"Response:\n{json.dumps(reg.json(), indent=2)}")
except requests.exceptions.Timeout:
    print("ERROR: Request timed out (>60s) — engine is too slow")
except Exception as e:
    print(f"ERROR: {e}")
