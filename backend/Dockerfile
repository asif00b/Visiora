FROM python:3.11-slim

# Install system dependencies for OpenCV and FAISS
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Expose port (Hugging Face routes traffic to port 7860)
EXPOSE 7860
ENV PORT=7860
ENV ARCFACE_FORCE_CPU=true
ENV INSIGHTFACE_MODEL=buffalo_s
ENV INSIGHTFACE_DET_SIZE=320
ENV OMP_NUM_THREADS=2
ENV MKL_NUM_THREADS=2

# Command to run the application
CMD ["sh", "-c", "gunicorn wsgi:app --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120"]
