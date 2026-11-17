#!/bin/sh
# Safe non-overlapping crawler wrapper with flock protection and stdout logging.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

export PYTHONPATH="$SCRIPT_DIR:${PYTHONPATH:-}"
LOCK_FILE="/tmp/pricehawk_crawler.lock"

if command -v flock >/dev/null 2>&1; then
  exec flock -n "$LOCK_FILE" python3 crawl_all.py
else
  exec python3 crawl_all.py
fi
