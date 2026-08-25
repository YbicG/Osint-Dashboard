FROM python:3.12-slim

# opencv-python-headless still needs a couple of shared libs at runtime on
# Debian slim (libgl1/libglib2.0 — not needed for headless rendering, but
# OpenCV's Python bindings import them regardless).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV MODEL_CACHE_DIR=/models
EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
