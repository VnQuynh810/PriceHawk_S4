# syntax=docker/dockerfile:1.7

# ── Stage 1: Build Lightweight Python Deps (No Chromium/X11 Bloat!) ──────────
FROM python:3.12-slim AS builder
WORKDIR /build

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefix=/install --no-warn-script-location -r requirements.txt

# ── Stage 2: Minimal Non-Root Production Runner (~180MB) ─────────────────────
FROM python:3.12-slim AS runner
WORKDIR /app

RUN groupadd --system --gid 1001 chatbot && \
    useradd --system --uid 1001 --gid chatbot --create-home chatbot

COPY --from=builder /install /usr/local
COPY --chown=chatbot:chatbot . .

ENV PYTHONUNBUFFERED=1 \
    PORT=8000

USER chatbot

EXPOSE 8000

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--limit-concurrency", "50"]
