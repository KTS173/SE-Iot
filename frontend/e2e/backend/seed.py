"""
Fresh, deterministic database for the Playwright E2E suite.

Run from backend/ with the E2E environment (see start.sh). Imports the app's
own modules so the schema always matches, but never changes them.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# Safety: never seed (or later start) a backend that could reach real LINE.
for key in ("LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET"):
    if os.environ.get(key, None) != "":
        sys.exit(f"refusing to seed: {key} must be exported as an empty string")

sys.path.insert(0, os.getcwd())

import config  # noqa: E402,F401  (load_dotenv does not override the empty exports)
import line_client  # noqa: E402

if line_client.enabled():
    sys.exit("refusing to seed: LINE client reports credentials configured")

import auth  # noqa: E402
from db import get_db, init_db  # noqa: E402

LOCAL = ZoneInfo(os.environ.get("E2E_TZ", "Asia/Bangkok"))
now = datetime.now(timezone.utc)


def iso(value):
    return value.astimezone(timezone.utc).isoformat()


def local_day(days_ago, hour=None):
    """A moment on the local calendar day `days_ago` days before today."""
    today = now.astimezone(LOCAL).replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=days_ago)
    if days_ago == 0:
        # Halfway between local midnight and now: always today, never future.
        return start + (now.astimezone(LOCAL) - start) / 2
    return start + timedelta(hours=hour if hour is not None else 12)


init_db()

users = [
    ("E2E Admin", "admin", "admin@lab.test", "AdminPass123", "admin", "active"),
    ("Mary Member", "member", "member@lab.test", "MemberPass123", "member", "active"),
    ("Pat Pending", "pending1", "pending1@lab.test", "PendingPass123", "member", "pending"),
    ("Dan Disabled", "disabled1", "disabled1@lab.test", "DisabledPass123", "member", "disabled"),
]
for name, username, email, password, role, status in users:
    _, error = auth.create_user(name, username, email, password, role=role, status=status)
    if error:
        sys.exit(f"seed user {username}: {error}")

with get_db() as db:
    configs = [
        ("001", "Bench A", "North bench", 20, 30, 18, 30, 35, 65),
        ("002", "Bench B", "South bench", 60, 40, 18, 30, 35, 65),
        ("003", "Cold Room", "Back wall", 80, 70, 18, 30, 35, 65),
    ]
    db.executemany(
        "INSERT INTO sensor_config (device_id, name, location, x, y, min_temp, max_temp, "
        "min_humidity, max_humidity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        configs,
    )

    readings = []
    # Hourly history for 30 days for the two healthy sensors.
    for hours_ago in range(30 * 24, 0, -1):
        t = now - timedelta(hours=hours_ago)
        readings.append(("001", 23 + (hours_ago % 5) * 0.2, 48 + hours_ago % 7, t))
        readings.append(("002", 25 + (hours_ago % 3) * 0.3, 52 + hours_ago % 5, t))
        if hours_ago > 48:  # Cold Room went silent two days ago
            readings.append(("003", 21.5, 44, t))
    # Minute data for the last six hours.
    for minutes_ago in range(6 * 60, -1, -1):
        t = now - timedelta(minutes=minutes_ago)
        readings.append(("001", 24.0 + (minutes_ago % 10) * 0.05, 50, t))
        readings.append(("002", 31.2, 55, t))  # above its 30 °C limit -> warning
    # A device that reports through an MQTT topic like sensors/sensor-01/data
    # and was never configured on the Sensors page.
    for minutes_ago in range(120, -1, -1):
        readings.append(("sensor-01", 22.0, 47, now - timedelta(minutes=minutes_ago)))
    readings.sort(key=lambda r: r[3])
    db.executemany(
        "INSERT INTO sensor_readings (device_id, temperature, humidity, pressure, received_at) "
        "VALUES (?, ?, ?, NULL, ?)",
        [(d, round(t, 2), h, iso(at)) for d, t, h, at in readings],
    )

    # LINE delivery log across several local days, including failures.
    deliveries = [
        # (days_ago, hour, status, attempts, recipients, error, message)
        (40, 9, "sent", 1, 2, None, "E2E old message 40 days ago"),
        (20, 10, "sent", 1, 2, None, "E2E sent 20 days ago"),
        (20, 11, "skipped", 0, None, "LINE credentials are not configured", "E2E skipped 20 days ago"),
        (10, 8, "failed", 5, 0, "LINE API 500", "E2E failed 10 days ago"),
        (3, 15, "sent", 1, 2, None, "E2E sent 3 days ago"),
        (1, 9, "sent", 1, 2, None, "E2E sent yesterday"),
        (1, 18, "failed", 5, 0, "LINE API 429", "E2E failed yesterday"),
        (0, None, "sent", 1, 2, None, "E2E sent today #1"),
        (0, None, "sent", 1, 2, None, "E2E sent today #2"),
        (0, None, "pending", 1, 0, "LINE API timeout", "E2E pending today"),
    ]
    rows = []
    for index, (days_ago, hour, status, attempts, recipients, error, message) in enumerate(deliveries):
        created = local_day(days_ago, hour)
        rows.append((
            index + 1, "opened", "line", f"e2e:{index}", f"retry-{index}", message, status,
            attempts, recipients, error, iso(created),
            # Pending rows wait far in the future so the worker never touches them.
            "2099-01-01T00:00:00+00:00" if status == "pending" else None,
            iso(created) if attempts else None,
            iso(created + timedelta(seconds=2)) if status == "sent" else None,
        ))
    db.executemany(
        "INSERT INTO notification_deliveries (alert_id, event_state, channel, dedupe_key, "
        "retry_key, message, status, attempts, recipient_count, last_error, created_at, "
        "next_attempt_at, last_attempt_at, delivered_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )

print(f"seeded {config.database_path}: {len(users)} users, {len(readings)} readings, "
      f"{len(rows)} deliveries")
