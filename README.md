# Visiora — Face Recognition Attendance System (v6)

[![Python](https://img.shields.io/badge/python-3.10-blue.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61dafb.svg)](https://react.dev/)
[![Database](https://img.shields.io/badge/database-PostgreSQL%20%2B%20pgvector-blue.svg)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A production-grade, highly-optimized, lightweight face recognition attendance system designed to run efficiently on consumer-grade hardware (e.g., laptop-class setup with GPU acceleration).

---

## 🚀 Key Features

*   **Hybrid Detection-Tracking Pipeline:** Utilizes **InsightFace SCRFD** for face detection every 5th frame and lightweight **OpenCV KCF/CSRT** trackers for intermediate frames to drastically reduce GPU/CPU load.
*   **In-Memory Vector Search:** Employs **FAISS (Facebook AI Similarity Search)** with a Cosine Similarity index built in RAM for near-instantaneous face matching ($<0.1\text{ ms}$ query latency).
*   **Anti-Spoofing (Liveness Check):** Implements **Eye Aspect Ratio (EAR)** blink tracking and statistical variance analysis to prevent spoofing attacks via photos or mobile screens.
*   **Vector Database Storage:** Stores 512-dimensional face embeddings in **PostgreSQL** using the **`pgvector`** extension for permanent, queryable, and scalable record-keeping.
*   **Quality & Blur Filtering:** Integrates a **Laplacian Variance filter** to automatically reject blurry or poorly illuminated frames during registration and matching.
*   **Modern Admin Interface:** Feature-rich React dashboard with real-time statistics, logs, live configuration management, and visual monitoring.

---

## 🛠️ System Architecture

The following diagram illustrates the end-to-end frame processing and matching workflow:

```mermaid
graph TD
    A[React Client / Scanner.jsx] -->|1. Webcams Frames Captured| B[useCamera.js: Downscale to 640px JPEG]
    B -->|2. HTTP POST JSON Payload| C[Flask Server / app.py]
    C -->|3. Route Handle| D[routes/face.py: recognize endpoint]
    D -->|4. Invoke Engine| E[face_engine/arcface_engine.py]
    E -->|5. Coordinate State| F[face_engine/tracker_pipeline.py]
    F -->|6. If Det Frame: Detect| G[InsightFace SCRFD Detector]
    F -->|7. If Track Frame: Follow| H[OpenCV KCF/CSRT Tracker]
    F -->|8. Stable Face Crop| I[InsightFace ArcFace Extraction]
    I -->|9. Normalised 512-dim Vector| J[FAISS In-Memory Search]
    J -->|10. Match Matrix| K{Identity Found?}
    K -->|Yes & Liveness Confirmed| L[Write to PostgreSQL via SQLAlchemy]
    K -->|No / Spoof| M[Return Response to Client with Debug Data]
    L --> M
```

---

## ⚙️ Hardware Profile & Optimization Defaults

Optimized out-of-the-box for a standard laptop setup (e.g., Acer Nitro V15 with a 2GB NVIDIA GPU):

*   **Model:** InsightFace `buffalo_s`
*   **Detector Size:** `320`
*   **In-Memory Index:** Encodings are loaded into RAM at startup; matching never runs active SQL queries.
*   **GPU Execution:** ONNX Runtime runs model inference on CUDA Execution Provider, falling back to CPU if necessary.

---

## 📋 Prerequisites

*   **Python:** 3.10 recommended (compatibility with InsightFace ONNX builds)
*   **Node.js:** v18+
*   **Database:** PostgreSQL 15+ with the `pgvector` extension installed
*   **Camera:** Standard USB Webcam / Integrated Laptop Camera
*   **GPU Acceleration:** NVIDIA Driver + compatible CUDA and cuDNN versions for ONNX Runtime GPU support.

---

## ⚙️ Initial Setup

### 1. Database Creation

Create the database and enable the vector extension:

```bash
createdb attendance_db
psql -d attendance_db -c "CREATE EXTENSION vector;"
```

### 2. Environment Variables (`.env`)

Configure your environment variables in the project root directory. Use `.env.example` as a template:

```env
DATABASE_URL=postgresql+psycopg://postgres:your_db_password@localhost:5432/attendance_db
ARCFACE_FORCE_CPU=false
TRACKER_ALGORITHM=KCF
```

### 3. Installation

Install backend dependencies:

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Install frontend dependencies:

```bash
cd ../frontend
npm install
```

---

## 🚀 Running the Application

To launch both the backend server and frontend development server simultaneously, use the provided batch script from the root directory:

```bash
run.bat
```

*   **Backend API Server:** [http://localhost:5000](http://localhost:5000)
*   **Frontend Dashboard:** [http://localhost:5173](http://localhost:5173)

---

## 🔒 Security & Privacy Notice

*   **Default Administrator Credentials:** On first-time initialization, the system seeds a default admin account. The login credentials are automatically outputted in the backend startup logs.
*   **Production Deployment:** Please log in immediately on first startup, navigate to the **Admin Dashboard**, and change the default administrator credentials and database keys.

---

## 🔄 Legacy Data Migration

To migrate existing SQLAlchemy SQLite database records to PostgreSQL, run:

```bash
cd backend
venv\Scripts\python scripts\migrate_to_postgres.py
```

To migrate from an external SQLAlchemy-compatible database:

```bash
set SOURCE_DATABASE_URL=<your-legacy-database-connection-url>
cd backend
venv\Scripts\python scripts\migrate_to_postgres.py
```
