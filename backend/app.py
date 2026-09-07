import os
import shutil
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

from mqtt_client import SensorMqttClient

load_dotenv()

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": os.getenv("CORS_ORIGIN", "http://localhost:5173")}})

database_path = os.getenv("DATABASE_PATH", "sensor_data.db")
storage_warning_percent = float(os.getenv("STORAGE_WARNING_PERCENT", "85"))
storage_cleanup_target_percent = float(os.getenv("STORAGE_CLEANUP_TARGET_PERCENT", "80"))
storage_cleanup_batch_size = int(os.getenv("STORAGE_CLEANUP_BATCH_SIZE", "10000"))
storage_min_readings = int(os.getenv("STORAGE_MIN_READINGS", "100"))
sensor_retention_days = int(os.getenv("SENSOR_RETENTION_DAYS", "31"))
device_offline_seconds = int(os.getenv("DEVICE_OFFLINE_SECONDS", "120"))
storage_warning_logged = False
storage_cleanup_blocked_logged = False
storage_cleanup_lock = threading.Lock()
retention_cleanup_lock = threading.Lock()
last_retention_cleanup = 0.0


def get_db():
    connection = sqlite3.connect(database_path, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    database_dir = os.path.dirname(database_path)
    if database_dir:
        os.makedirs(database_dir, exist_ok=True)
    with get_db() as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sensor_readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                temperature REAL NOT NULL,
                humidity REAL NOT NULL,
                pressure REAL,
                received_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_sensor_received_at "
            "ON sensor_readings(received_at DESC)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sensor_config (
                device_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                location TEXT NOT NULL,
                x REAL NOT NULL DEFAULT 50,
                y REAL NOT NULL DEFAULT 50,
                min_temp REAL NOT NULL DEFAULT 18,
                max_temp REAL NOT NULL DEFAULT 30,
                min_humidity REAL NOT NULL DEFAULT 35,
                max_humidity REAL NOT NULL DEFAULT 65
            )
            """
        )
    with get_db() as connection:
        if connection.execute("PRAGMA auto_vacuum").fetchone()[0] != 1:
            connection.execute("PRAGMA auto_vacuum=FULL")
            connection.execute("VACUUM")


def row_to_reading(row):
    if row is None:
        return None
    return {
        "device_id": row["device_id"],
        "temperature": row["temperature"],
        "humidity": row["humidity"],
        "pressure": row["pressure"],
        "received_at": row["received_at"],
    }


CONFIG_DEFAULTS = {
    "x": 50.0, "y": 50.0,
    "min_temp": 18.0, "max_temp": 30.0,
    "min_humidity": 35.0, "max_humidity": 65.0,
}


def row_to_config(row, device_id):
    """Stored presentation/threshold settings, or defaults for a new device."""
    if row is None:
        return {
            "name": f"Sensor {device_id}",
            "location": "Unassigned",
            "configured": False,
            **CONFIG_DEFAULTS,
        }
    config = {key: row[key] for key in CONFIG_DEFAULTS}
    config.update(name=row["name"], location=row["location"], configured=True)
    return config


def read_config_payload(payload):
    """Validate a sensor config body. Returns (values, error)."""
    name = str(payload.get("name", "")).strip()
    location = str(payload.get("location", "")).strip()
    if not name:
        return None, "name is required"
    if not location:
        return None, "location is required"

    values = {"name": name, "location": location}
    for key, default in CONFIG_DEFAULTS.items():
        raw = payload.get(key, default)
        try:
            values[key] = float(raw)
        except (TypeError, ValueError):
            return None, f"{key} must be a number"

    if values["min_temp"] > values["max_temp"]:
        return None, "min_temp cannot exceed max_temp"
    if values["min_humidity"] > values["max_humidity"]:
        return None, "min_humidity cannot exceed max_humidity"
    return values, None


def get_storage_status():
    storage_path = os.path.dirname(os.path.abspath(database_path))
    total, used, free = shutil.disk_usage(storage_path)
    used_percent = round((used / total) * 100, 1) if total else 0
    return {
        "used_percent": used_percent,
        "free_bytes": free,
        "total_bytes": total,
        "warning_percent": storage_warning_percent,
        "alert": used_percent >= storage_warning_percent,
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
        while storage["used_percent"] > storage_cleanup_target_percent:
            with get_db() as connection:
                reading_count = connection.execute(
                    "SELECT COUNT(*) FROM sensor_readings"
                ).fetchone()[0]
                delete_count = min(
                    storage_cleanup_batch_size,
                    max(0, reading_count - storage_min_readings),
                )
                if delete_count == 0:
                    if not storage_cleanup_blocked_logged:
                        print(
                            "WARNING: Storage remains above the cleanup target, but "
                            f"the newest {storage_min_readings} readings are protected."
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
        cutoff = (datetime.now(timezone.utc) - timedelta(days=sensor_retention_days)).isoformat()
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
                f"{sensor_retention_days} days."
            )
        return deleted
    finally:
        retention_cleanup_lock.release()


def save_reading(payload):
    global storage_warning_logged
    cleanup_expired_readings()
    cleanup_storage_if_needed()
    reading = {
        "temperature": payload.get("temperature"),
        "humidity": payload.get("humidity"),
        "pressure": payload.get("pressure"),
        "device_id": payload.get("device_id", "unknown"),
        "received_at": datetime.now(timezone.utc).isoformat(),
    }
    with get_db() as connection:
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
    cleanup_storage_if_needed()
    storage = get_storage_status()
    if storage["alert"] and not storage_warning_logged:
        print(
            "WARNING: SQLite storage is almost full "
            f"({storage['used_percent']}% used, {storage['free_bytes']} bytes free)"
        )
        storage_warning_logged = True
    elif not storage["alert"]:
        storage_warning_logged = False
    return reading


init_db()
cleanup_expired_readings(force=True)
mqtt_client = SensorMqttClient(on_reading=save_reading)


@app.get("/api/health")
def health():
    with get_db() as connection:
        reading_count = connection.execute(
            "SELECT COUNT(*) FROM sensor_readings"
        ).fetchone()[0]
    return jsonify(
        {
            "status": "ok",
            "mqtt_connected": mqtt_client.connected,
            "mqtt_topic": mqtt_client.topic,
            "stored_readings": reading_count,
            "storage": get_storage_status(),
            "storage_retention": {
                "cleanup_target_percent": storage_cleanup_target_percent,
                "minimum_readings": storage_min_readings,
                "retention_days": sensor_retention_days,
            },
        }
    )


@app.get("/api/sensors/latest")
def latest_sensor():
    with get_db() as connection:
        row = connection.execute(
            "SELECT * FROM sensor_readings ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return jsonify({"data": row_to_reading(row)})


@app.get("/api/sensors")
def sensor_history():
    requested_limit = request.args.get("limit", default=20, type=int)
    limit = max(1, min(requested_limit, 5000))

    # received_at is stored as an ISO-8601 UTC string, so lexicographic
    # comparison is chronological and the index on it still applies.
    filters, params = [], []
    for name, operator in (("from", ">="), ("to", "<=")):
        value = request.args.get(name)
        if value:
            filters.append(f"received_at {operator} ?")
            params.append(value)
    device_id = request.args.get("device_id")
    if device_id:
        filters.append("device_id = ?")
        params.append(device_id)
    where = f"WHERE {' AND '.join(filters)}" if filters else ""

    with get_db() as connection:
        rows = connection.execute(
            f"""
            SELECT * FROM (
                SELECT * FROM sensor_readings {where} ORDER BY id DESC LIMIT ?
            ) ORDER BY id ASC
            """,
            (*params, limit),
        ).fetchall()
    readings = [row_to_reading(row) for row in rows]
    return jsonify({"data": readings})


@app.get("/api/devices")
def devices():
    """
    Every known sensor: those that have reported, those registered but silent,
    each with its stored settings and most recent reading.
    """
    with get_db() as connection:
        readings = {
            row["device_id"]: row
            for row in connection.execute(
                """
                SELECT reading.* FROM sensor_readings AS reading
                JOIN (
                    SELECT device_id, MAX(id) AS latest_id
                    FROM sensor_readings GROUP BY device_id
                ) AS latest ON reading.id = latest.latest_id
                """
            ).fetchall()
        }
        configs = {
            row["device_id"]: row
            for row in connection.execute("SELECT * FROM sensor_config").fetchall()
        }

    now = datetime.now(timezone.utc)
    payload = []
    for device_id in sorted(set(readings) | set(configs)):
        row = readings.get(device_id)
        reading = row_to_reading(row) or {
            "device_id": device_id,
            "temperature": None,
            "humidity": None,
            "pressure": None,
            "received_at": None,
        }
        age = None
        if reading["received_at"]:
            try:
                age = (now - datetime.fromisoformat(reading["received_at"])).total_seconds()
            except ValueError:
                age = None
        reading["online"] = age is not None and age <= device_offline_seconds
        reading["seconds_since_reading"] = None if age is None else round(age)
        reading.update(row_to_config(configs.get(device_id), device_id))
        payload.append(reading)
    return jsonify({"data": payload, "offline_after_seconds": device_offline_seconds})


@app.put("/api/devices/<device_id>")
def upsert_device(device_id):
    """Create or update a sensor's display settings and alert thresholds."""
    values, error = read_config_payload(request.get_json(silent=True) or {})
    if error:
        return jsonify({"error": error}), 400

    with get_db() as connection:
        connection.execute(
            """
            INSERT INTO sensor_config
                (device_id, name, location, x, y,
                 min_temp, max_temp, min_humidity, max_humidity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id) DO UPDATE SET
                name=excluded.name, location=excluded.location,
                x=excluded.x, y=excluded.y,
                min_temp=excluded.min_temp, max_temp=excluded.max_temp,
                min_humidity=excluded.min_humidity,
                max_humidity=excluded.max_humidity
            """,
            (
                device_id, values["name"], values["location"],
                values["x"], values["y"], values["min_temp"], values["max_temp"],
                values["min_humidity"], values["max_humidity"],
            ),
        )
    return jsonify({"data": {"device_id": device_id, **values, "configured": True}})


@app.delete("/api/devices/<device_id>")
def delete_device(device_id):
    """
    Remove a sensor's settings. Readings are kept unless ?purge=true, so
    deleting a mis-typed entry never destroys measurement history.
    """
    purge = request.args.get("purge", "false").lower() == "true"
    with get_db() as connection:
        connection.execute("DELETE FROM sensor_config WHERE device_id = ?", (device_id,))
        if purge:
            connection.execute(
                "DELETE FROM sensor_readings WHERE device_id = ?", (device_id,)
            )
    return jsonify({"data": {"device_id": device_id, "purged_readings": purge}})


if __name__ == "__main__":
    mqtt_client.start()
    app.run(
        host=os.getenv("FLASK_HOST", "0.0.0.0"),
        port=int(os.getenv("FLASK_PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
        use_reloader=False,
    )
