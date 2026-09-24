"""
Threshold evaluation and incident lifecycle.

Readings are compared against each device's stored thresholds. An alert stays
open until the value recovers, so a sensor parked above its limit notifies once
instead of on every message. Delivery is someone else's job: this module calls
whatever notifier was registered, which keeps the rules testable without a
network and lets the channel change without touching the logic.
"""

import os
import threading
import time
from datetime import datetime, timedelta, timezone

# Recovery needs to beat the threshold by this margin before an alert closes.
# Without it a value sitting exactly on the limit flaps open/closed forever.
alert_hysteresis = float(os.getenv("ALERT_HYSTERESIS", "0.5"))
alert_check_seconds = int(os.getenv("ALERT_CHECK_SECONDS", "60"))

KIND_LABELS = {
    "temp_high": "Temperature above maximum",
    "temp_low": "Temperature below minimum",
    "humidity_high": "Humidity above maximum",
    "humidity_low": "Humidity below minimum",
    "offline": "Sensor offline",
}

_get_db = None
_notifier = None
_offline_watcher = None


def configure(get_db, notifier=None):
    """Wire the module to the app's database and delivery channel."""
    global _get_db, _notifier
    _get_db = get_db
    _notifier = notifier


def init_alert_tables(connection):
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            value REAL,
            threshold REAL,
            opened_at TEXT NOT NULL,
            closed_at TEXT,
            notified_at TEXT
        )
        """
    )
    # One open alert per device and kind, enforced by the database so a burst of
    # readings cannot race two duplicates in.
    connection.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_open "
        "ON alerts(device_id, kind) WHERE closed_at IS NULL"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_alerts_opened_at ON alerts(opened_at DESC)"
    )


def _now():
    return datetime.now(timezone.utc).isoformat()


def _device_label(connection, device_id):
    row = connection.execute(
        "SELECT name, location FROM sensor_config WHERE device_id = ?", (device_id,)
    ).fetchone()
    if row is None:
        return f"Sensor {device_id}", "Unassigned"
    return row["name"], row["location"]


def _open_alert(connection, device_id, kind, value, threshold):
    """Open an alert unless one of this kind is already active. Returns the event."""
    existing = connection.execute(
        "SELECT id FROM alerts WHERE device_id = ? AND kind = ? AND closed_at IS NULL",
        (device_id, kind),
    ).fetchone()
    if existing is not None:
        return None

    opened_at = _now()
    connection.execute(
        """
        INSERT INTO alerts (device_id, kind, value, threshold, opened_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (device_id, kind, value, threshold, opened_at),
    )
    name, location = _device_label(connection, device_id)
    return {
        "state": "opened",
        "device_id": device_id,
        "name": name,
        "location": location,
        "kind": kind,
        "label": KIND_LABELS.get(kind, kind),
        "value": value,
        "threshold": threshold,
        "at": opened_at,
    }


def _close_alert(connection, device_id, kind, value):
    row = connection.execute(
        "SELECT id, threshold, opened_at FROM alerts "
        "WHERE device_id = ? AND kind = ? AND closed_at IS NULL",
        (device_id, kind),
    ).fetchone()
    if row is None:
        return None

    closed_at = _now()
    connection.execute(
        "UPDATE alerts SET closed_at = ? WHERE id = ?", (closed_at, row["id"])
    )
    name, location = _device_label(connection, device_id)
    return {
        "state": "closed",
        "device_id": device_id,
        "name": name,
        "location": location,
        "kind": kind,
        "label": KIND_LABELS.get(kind, kind),
        "value": value,
        "threshold": row["threshold"],
        "at": closed_at,
    }


def _threshold_checks(temperature, humidity, config):
    """
    (kind, value, threshold, breached, recovered) per rule.

    `breached` and `recovered` are deliberately not each other's inverse: the
    gap between them is the hysteresis band, where an alert holds its current
    state instead of toggling.
    """
    checks = []
    if temperature is not None:
        checks.append((
            "temp_high", temperature, config["max_temp"],
            temperature > config["max_temp"],
            temperature <= config["max_temp"] - alert_hysteresis,
        ))
        checks.append((
            "temp_low", temperature, config["min_temp"],
            temperature < config["min_temp"],
            temperature >= config["min_temp"] + alert_hysteresis,
        ))
    if humidity is not None:
        checks.append((
            "humidity_high", humidity, config["max_humidity"],
            humidity > config["max_humidity"],
            humidity <= config["max_humidity"] - alert_hysteresis,
        ))
        checks.append((
            "humidity_low", humidity, config["min_humidity"],
            humidity < config["min_humidity"],
            humidity >= config["min_humidity"] + alert_hysteresis,
        ))
    return checks


def evaluate_reading(device_id, temperature, humidity, config):
    """Compare one reading against its thresholds and deliver any state change."""
    if _get_db is None:
        return []

    events = []
    with _get_db() as connection:
        for kind, value, threshold, breached, recovered in _threshold_checks(
            temperature, humidity, config
        ):
            if breached:
                event = _open_alert(connection, device_id, kind, value, threshold)
            elif recovered:
                event = _close_alert(connection, device_id, kind, value)
            else:
                event = None
            if event is not None:
                events.append(event)

        # A reading is proof of life, so any offline alert ends here.
        recovered_offline = _close_alert(connection, device_id, "offline", None)
        if recovered_offline is not None:
            events.append(recovered_offline)

    _deliver(events)
    return events


def evaluate_offline(offline_seconds):
    """
    Open alerts for devices that have gone quiet.

    Silence produces no reading, so this cannot be driven by the MQTT callback
    and runs on its own timer instead.
    """
    if _get_db is None:
        return []

    cutoff = (
        datetime.now(timezone.utc) - timedelta(seconds=offline_seconds)
    ).isoformat()
    events = []
    with _get_db() as connection:
        rows = connection.execute(
            """
            SELECT device_id, MAX(received_at) AS last_seen
            FROM sensor_readings
            GROUP BY device_id
            HAVING last_seen < ?
            """,
            (cutoff,),
        ).fetchall()
        for row in rows:
            event = _open_alert(connection, row["device_id"], "offline", None, None)
            if event is not None:
                event["last_seen"] = row["last_seen"]
                events.append(event)

    _deliver(events)
    return events


def list_alerts(status="active", limit=50):
    if _get_db is None:
        return []
    clause = "WHERE closed_at IS NULL" if status == "active" else ""
    with _get_db() as connection:
        rows = connection.execute(
            f"""
            SELECT a.*, c.name, c.location
            FROM alerts a
            LEFT JOIN sensor_config c ON c.device_id = a.device_id
            {clause}
            ORDER BY a.opened_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "device_id": row["device_id"],
            "name": row["name"] or f"Sensor {row['device_id']}",
            "location": row["location"] or "Unassigned",
            "kind": row["kind"],
            "label": KIND_LABELS.get(row["kind"], row["kind"]),
            "value": row["value"],
            "threshold": row["threshold"],
            "opened_at": row["opened_at"],
            "closed_at": row["closed_at"],
            "active": row["closed_at"] is None,
        }
        for row in rows
    ]


def _deliver(events):
    if not events or _notifier is None:
        return
    for event in events:
        try:
            _notifier(event)
        except Exception as error:  # delivery must never break ingestion
            print(f"Alert notification failed for {event['device_id']}: {error}")
            continue
        if event["state"] != "opened":
            continue
        with _get_db() as connection:
            connection.execute(
                "UPDATE alerts SET notified_at = ? "
                "WHERE device_id = ? AND kind = ? AND closed_at IS NULL",
                (_now(), event["device_id"], event["kind"]),
            )


def start_offline_watcher(offline_seconds):
    """Background timer for the one condition readings cannot report."""
    global _offline_watcher
    if _offline_watcher is not None:
        return

    def run():
        while True:
            time.sleep(alert_check_seconds)
            try:
                evaluate_offline(offline_seconds)
            except Exception as error:
                print(f"Offline alert check failed: {error}")

    _offline_watcher = threading.Thread(target=run, daemon=True)
    _offline_watcher.start()
