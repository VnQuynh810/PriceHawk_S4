# syntax=docker/dockerfile:1.7

# ── Stage 1: Install Python Dependencies ──────────────────────────────────────
FROM python:3.12-slim AS builder
WORKDIR /build

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefix=/install --no-warn-script-location -r requirements.txt

# ── Stage 2: Non-Root Production Runner with Supercronic ─────────────────────
FROM python:3.12-slim AS runner

ARG SUPERCRONIC_VERSION=v0.2.33
ARG TARGETARCH=amd64

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl tzdata && \
    curl -fsSL "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${TARGETARCH}" \
      -o /usr/local/bin/supercronic && \
    chmod +x /usr/local/bin/supercronic && \
    apt-get purge -y --auto-remove curl && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --system --gid 1001 crawler && \
    useradd --system --uid 1001 --gid crawler --create-home crawler

COPY --from=builder /install /usr/local

WORKDIR /app/crawler
COPY --chown=crawler:crawler . .

RUN chmod +x /app/crawler/run_crawler.sh && \
    printf "*/30 * * * * /app/crawler/run_crawler.sh\n" > /app/crawler/crontab

ENV PYTHONUNBUFFERED=1 \
    TZ=Asia/Ho_Chi_Minh \
    CRAWLER_MAX_WORKERS=2 \
    RUN_ON_STARTUP=true

USER crawler

HEALTHCHECK --interval=2m --timeout=10s --start-period=15s --retries=3 \
  CMD ["python3", "-c", "import price_hawk; print('ok')"]

CMD ["sh", "-c", "if [ \"$RUN_ON_STARTUP\" = \"true\" ]; then ./run_crawler.sh || true; fi && exec supercronic /app/crawler/crontab"]
