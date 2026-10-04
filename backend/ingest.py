"""MQTT reading -> SQLite row -> alert check."""
import math
from datetime import datetime, timezone

import alerts
import storage
from db import get_db
from mqtt_client import SensorMqttClient
from sensor_config import default_thresholds, row_to_config


def evaluate_alerts(reading):
    """Run threshold rules for a stored reading, using the device's own limits."""
    device_id = reading["device_id"]
    with get_db() as connection:
        row = connection.execute(
            "SELECT * FROM sensor_config WHERE device_id = ?", (device_id,)
        ).fetchone()
        defaults = default_thresholds(connection)
    config = row_to_config(row, device_id, defaults)
    try:
        alerts.evaluate_reading(
            device_id, reading["temperature"], reading["humidity"], config
        )
    except Exception as error:  # a rule bug must not cost us the reading
        print(f"Alert evaluation failed for {device_id}: {error}")


def _number(payload, field, required=True):
    """A finite float from a JSON number or numeric string; ValueError otherwise."""
    value = payload.get(field)
    if value is None and not required:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"{field} must be a number")
    try:
        number = float(value)
    except ValueError:
        raise ValueError(f"{field} must be a number") from None
    if not math.isfinite(number):
        raise ValueError(f"{field} must be a finite number")
    return number


def save_reading(payload):
    if not isinstance(payload, dict):
        raise ValueError("reading must be a JSON object")
    reading = {
        "temperature": _number(payload, "temperature"),
        "humidity": _number(payload, "humidity"),
        "pressure": _number(payload, "pressure", required=False),
        "device_id": str(payload.get("device_id", "unknown")),
        "received_at": datetime.now(timezone.utc).isoformat(),
    }
    storage.cleanup_expired_readings()
    storage.cleanup_storage_if_needed()
    with get_db() as connection:
        # A deleted sensor that is still sending is evidently in use again.
        connection.execute("DELETE FROM removed_devices WHERE device_id = ?", (reading["device_id"],))
        connection.execute(
            """
            INSERT INTO sensor_readings
                (device_id, temperature, humidity, pressure, received_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                reading["device_id"], reading["temperature"],
                reading["humidity"], reading["pressure"],
                reading["received_at"],
            ),
        )
    storage.cleanup_storage_if_needed()
    evaluate_alerts(reading)
    storage.warn_if_almost_full()
    return reading


mqtt_client = SensorMqttClient(on_reading=save_reading)
