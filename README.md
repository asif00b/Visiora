# Face Recognition Attendance System — Version 6

AI-powered attendance system using face recognition.
Backend: **Python + Flask** | Database: **XAMPP MySQL** | Frontend: **React + Vite**

---

## Requirements

| Requirement | Details |
|---|---|
| Python | 3.9 or 3.10 (recommended) |
| XAMPP | With MySQL running |
| Node.js | v18 or later (for frontend) |
| Webcam | Required for face scanning |

---

## Quick Start

### Step 1 — Start XAMPP MySQL
Open XAMPP Control Panel → click **Start** next to **MySQL**.
Wait until the status turns green.

### Step 2 — Run Setup (first time only)
Double-click **`setup.bat`**

This will:
- Create a Python virtual environment
- Install all Python packages (Flask, PyMySQL, face_recognition, OpenCV, etc.)
- Create the `attendance_db` MySQL database automatically

> **dlib on Windows**: If face_recognition fails to install, see the instructions printed in the setup window. You may need to download a pre-built `.whl` from [here](https://github.com/z-mahmud22/Dlib_Windows_Python3.x) and install it manually.

### Step 3 — Start the System
Double-click **`start.bat`**

This opens:
- **Backend** (Flask): http://localhost:5000
- **Frontend** (React): http://localhost:5173

Your browser will open automatically.

---

## Default Login

| Field | Value |
|---|---|
| Email | `admin@system.com` |
| Password | `admin123` |

---

## Database (XAMPP MySQL)

| Setting | Value |
|---|---|
| Host | localhost |
| Port | 3306 |
| User | root |
| Password | *(empty by default)* |
| Database | `attendance_db` |

To change MySQL credentials, edit these files:
- `backend/config.py` — `MYSQL_USER` / `MYSQL_PASSWORD`
- `backend/create_mysql_db.py` — same settings

---

## Face Registration

When adding a student:
1. Open **Add Student** form
2. Click **Scan Face** — the webcam opens
3. Position your face in the frame (good lighting, look directly at camera)
4. The system validates:
   - ✅ Exactly 1 face in frame
   - ✅ Face is large enough (≥ 80px)
   - ✅ Image is not too blurry
5. Take 3–5 photos from slightly different angles for best accuracy
6. Click **Save** — encodings are stored in MySQL

**Tips for better recognition:**
- Use natural lighting or face the light source
- Use **CNN model** for registration (more accurate, slower)
- Use **HOG model** for live scanner (faster, good for real-time)
- Register 3–5 images per student

---

## Architecture

```
Version 6/
├── backend/               # Python Flask API
│   ├── app.py             # Entry point
│   ├── config.py          # MySQL + JWT config
│   ├── database.py        # DB init + seeding
│   ├── create_mysql_db.py # One-time DB creation
│   ├── face_engine/
│   │   ├── encoder.py     # Face recognition (with preprocessing)
│   │   └── liveness.py    # Blink detection
│   ├── models/            # SQLAlchemy models
│   ├── routes/            # Flask blueprints
│   └── utils/
│       └── auth_helpers.py  # JWT + RBAC helpers
├── frontend/              # React + Vite UI
├── storage/
│   ├── known_faces/       # Registered face images
│   └── unknown_faces/     # Unknown visitor snapshots
├── setup.bat              # First-time setup
└── start.bat              # Start everything
```

---

## API Endpoints

| Method | URL | Description |
|---|---|---|
| POST | `/api/login` | Login, returns JWT |
| GET | `/api/me` | Current user info |
| GET | `/api/users` | List users |
| POST | `/api/users` | Create user |
| POST | `/api/face/register` | Register face (1–10 images) |
| POST | `/api/face/recognize` | Recognize + mark attendance |
| GET | `/api/attendance/report` | Attendance report |
| GET | `/api/attendance/export` | Export CSV |
| GET | `/api/admin/system-info` | System status |
| POST | `/api/admin/reload-cache` | Reload face cache |

---

## Roles

| Role | Permissions |
|---|---|
| `admin` | Full access: manage users, departments, sessions, delete records, system config |
| `hr` | Create/edit students, register faces, view attendance |
| `student` | View own attendance only |
