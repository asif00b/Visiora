# Visiora — Face Recognition Attendance System (v6)

Production-style lightweight attendance system for a laptop-class setup.

Backend: Python + Flask  
Database: PostgreSQL + pgvector  
Recognition: InsightFace ArcFace + SCRFD detector + in-memory FAISS index  
Frontend: React + Vite

## Hardware Profile

Optimized defaults target an Acer Nitro V15 with a 2GB NVIDIA GPU:

- InsightFace `buffalo_s`
- detector size `320`
- KCF/CSRT-style tracker fallback through OpenCV
- embeddings loaded into RAM at startup
- FAISS index built once from active face encodings
- PostgreSQL used for writes, history, and admin data, not live matching

## Requirements

- Python 3.10 recommended
- Node.js 18+
- PostgreSQL 15+ with pgvector
- Webcam
- NVIDIA driver and compatible ONNX Runtime GPU stack for GPU acceleration

## Database Setup

Create the PostgreSQL database and enable pgvector:

```bat
createdb attendance_db
psql -d attendance_db -c "CREATE EXTENSION vector;"
```

Set `DATABASE_URL` if your username/password differs:

```bat
set DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/attendance_db
```

## First-Time Setup

```bat
setup.bat
```

This installs backend/frontend packages and creates tables/default admin.

Default login:

| Email | Password |
| --- | --- |
| `admin@system.com` | `admin123` |

## Migrate Existing Data

The migration preserves IDs, users, attendance, sessions, departments, face
encodings, unknown faces, and config.

Default source is `backend/database.db`:

```bat
cd backend
venv\Scripts\python scripts\migrate_to_postgres.py
```

For a one-time import from another SQLAlchemy-readable source, pass the source
URL:

```bat
cd backend
set SOURCE_DATABASE_URL=<legacy-source-url>
venv\Scripts\python scripts\migrate_to_postgres.py
```

## Start

```bat
start.bat
```

Backend: http://localhost:5000  
Frontend: http://localhost:5173

## Optimized Architecture

Live scanner flow:

1. React captures a resized JPEG frame, capped at 640px width.
2. Flask decodes the frame.
3. InsightFace SCRFD detects faces every few frames.
4. OpenCV tracker follows faces between detection frames.
5. ArcFace embeddings are refreshed only for stable tracks.
6. Identity hysteresis confirms the same ID across frames.
7. FAISS searches the in-memory embedding index.
8. Attendance writes go to PostgreSQL only after confirmation.

PostgreSQL stores durable data. Runtime recognition never queries the database;
the cache is loaded on startup or via the admin cache reload endpoint.

## Important Files

- `backend/config.py` - PostgreSQL and hardware-tuned runtime config
- `backend/face_engine/arcface_engine.py` - ArcFace + FAISS cache
- `backend/face_engine/tracker_pipeline.py` - tracker-based live pipeline
- `backend/scripts/migrate_to_postgres.py` - legacy data migration
- `backend/migrations/001_postgres_pgvector.sql` - pgvector/index reference SQL
- `frontend/src/pages/Scanner.jsx` - optimized scanner UI
- `frontend/src/hooks/useCamera.js` - camera capture and downscaling

## Cleanup Policy

Generated folders and runtime data are ignored:

- `backend/venv/`
- `frontend/node_modules/`
- `frontend/dist/`
- Python `__pycache__/`
- logs
- local databases
- stored face snapshots

Keep face images and old databases backed up before deleting them manually.
