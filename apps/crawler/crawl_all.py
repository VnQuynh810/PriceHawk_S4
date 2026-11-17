#!/usr/bin/env python3
"""
Entrypoint for PriceHawk Dynamic Multi-Site Crawler.
Delegates to `scheduler.py` (DB-driven dynamic sources + hot-SKU fast-track + Redis queue support).
"""

import sys
from scheduler import run_scheduler_cycle

if __name__ == "__main__":
    sys.exit(run_scheduler_cycle())
