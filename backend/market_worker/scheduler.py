"""Background market-rate worker.

    python -m market_worker.scheduler            # runs forever, every RATE_UPDATE_INTERVAL_SECONDS (default 120)
    python -m market_worker.scheduler --once     # single update, then exit
"""
import argparse
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.blocking import BlockingScheduler

from app.core.config import get_settings
from app.database.session import SessionLocal
from market_worker.rate_updater import run_update

log = logging.getLogger("valora.worker")


def tick() -> None:
    db = SessionLocal()
    try:
        run_update(db)
    except Exception:  # never let one bad cycle kill the scheduler
        db.rollback()
        log.exception("rate update cycle crashed")
    finally:
        db.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="Valora Money market-rate worker")
    parser.add_argument("--once", action="store_true", help="run one update and exit")
    args = parser.parse_args()
    s = get_settings()
    if args.once:
        tick()
        return
    scheduler = BlockingScheduler(timezone="UTC")
    scheduler.add_job(tick, "interval", seconds=s.rate_update_interval_seconds, id="rates",
                      next_run_time=datetime.now(timezone.utc), max_instances=1, coalesce=True)
    log.info("market worker started: every %ss via %s", s.rate_update_interval_seconds, ", ".join(s.provider_chain))
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("market worker stopped")


if __name__ == "__main__":
    main()
