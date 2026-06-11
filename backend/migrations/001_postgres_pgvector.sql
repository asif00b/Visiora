CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE face_encodings
    ADD COLUMN IF NOT EXISTS embedding_dim integer,
    ADD COLUMN IF NOT EXISTS embedding_vector vector(512);

ALTER TABLE attendance
    ADD COLUMN IF NOT EXISTS attendance_date date;

UPDATE attendance
SET attendance_date = timestamp::date
WHERE attendance_date IS NULL;

ALTER TABLE attendance
    ALTER COLUMN attendance_date SET DEFAULT CURRENT_DATE,
    ALTER COLUMN attendance_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS ix_face_encodings_user_id
    ON face_encodings (user_id);

CREATE INDEX IF NOT EXISTS ix_face_encodings_quality
    ON face_encodings (user_id, quality_score DESC);

CREATE INDEX IF NOT EXISTS ix_face_encodings_embedding_dim
    ON face_encodings (embedding_dim);

CREATE INDEX IF NOT EXISTS ix_face_encodings_embedding_hnsw
    ON face_encodings
    USING hnsw (embedding_vector vector_cosine_ops)
    WHERE embedding_vector IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_attendance_user_date
    ON attendance (user_id, attendance_date);

CREATE INDEX IF NOT EXISTS ix_attendance_recent
    ON attendance (attendance_date DESC, timestamp DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_user_session_day
    ON attendance (user_id, attendance_date, session_id) WHERE session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_user_general_day
    ON attendance (user_id, attendance_date) WHERE session_id IS NULL;
