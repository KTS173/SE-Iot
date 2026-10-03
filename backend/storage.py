"""Disk-usage guard and rolling retention for sensor readings."""
import os
import shutil
import threading
import time
from datetime import datetime, timedelta, timezone

import config
from db import get_db

storage_warning_logged = False
storage_cleanup_blocked_logged = False
storage_cleanup_lock = threading.Lock()
retention_cleanup_lock = threading.Lock()
last_retention_cleanup = 0.0


def get_storage_status():
    storage_path = os.path.dirname(os.path.abspath(config.database_path))
    total, used, free = shutil.disk_usage(storage_path)
    used_percent = round((used / total) * 100, 1) if total else 0
    return {
        "used_percent": used_percent,
        "free_bytes": free,
        "total_bytes": total,
        "warning_percent": config.storage_warning_percent,
        "alert": used_percent >= config.storage_warning_percent,
    }


def cleanup_storage_if_needed():
    """Delete oldest readings at the disk threshold, retaining recent data."""
    global storage_cleanup_blocked_logged
    if not get_storage_status()["alert"]:
        storage_cleanup_blocked_logged = False
        return 0
    if not storage_cleanup_lock.acquire(blocking=False):
        return 0

    deleted_total = 0
    try:
        storage = get_storage_status()
        while storage["used_percent"] > config.storage_cleanup_target_percent:
            with get_db() as connection:
                reading_count = connection.execute(
                    "SELECT COUNT(*) FROM sensor_readings"
                ).fetchone()[0]
                delete_count = min(
                    config.storage_cleanup_batch_size,
                    max(0, reading_count - config.storage_min_readings),
                )
                if delete_count == 0:
                    if not storage_cleanup_blocked_logged:
                        print(
                            "WARNING: Storage remains above the cleanup target, but "
                            f"the newest {config.storage_min_readings} readings are protected."
                        )
                        storage_cleanup_blocked_logged = True
                    break
                connection.execute(
                    """
                    DELETE FROM sensor_readings WHERE id IN (
                        SELECT id FROM sensor_readings ORDER BY id ASC LIMIT ?
                    )
                    """,
                    (delete_count,),
                )
            with get_db() as connection:
                connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            deleted_total += delete_count
            storage = get_storage_status()

        if deleted_total:
            storage_cleanup_blocked_logged = False
            print(
                f"STORAGE CLEANUP: Deleted {deleted_total} oldest sensor readings; "
                f"disk usage is now {storage['used_percent']}%."
            )
        return deleted_total
    finally:
        storage_cleanup_lock.release()


def cleanup_expired_readings(force=False):
    """Delete readings older than the rolling retention period."""
    global last_retention_cleanup
    now = time.monotonic()
    if not force and now - last_retention_cleanup < 3600:
        return 0
    if not retention_cleanup_lock.acquire(blocking=False):
        return 0
    try:
        cutoff = (
            datetime.now(timezone.utc) - timedelta(days=config.sensor_retention_days)
        ).isoformat()
        with get_db() as connection:
            cursor = connection.execute(
                "DELETE FROM sensor_readings WHERE received_at < ?",
                (cutoff,),
            )
            deleted = cursor.rowcount
        last_retention_cleanup = now
        if deleted:
            print(
                f"RETENTION CLEANUP: Deleted {deleted} sensor readings older than "
                f"{config.sensor_retention_days} days."
            )
        return deleted
    finally:
        retention_cleanup_lock.release()


def warn_if_almost_full():
    """Log once when the disk crosses the warning threshold."""
    global storage_warning_logged
    storage = get_storage_status()
    if storage["alert"] and not storage_warning_logged:
        print(
            "WARNING: SQLite storage is almost full "
            f"({storage['used_percent']}% used, {storage['free_bytes']} bytes free)"
        )
        storage_warning_logged = True
    elif not storage["alert"]:
        storage_warning_logged = False
