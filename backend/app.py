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
    limit = max(1, min(requested_limit, 1000))
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT * FROM (
                SELECT * FROM sensor_readings ORDER BY id DESC LIMIT ?
            ) ORDER BY id ASC
            """,
            (limit,),
        ).fetchall()
    readings = [row_to_reading(row) for row in rows]
    return jsonify({"data": readings})


@app.post("/api/sensors")
def create_sensor_reading():
    """Convenient endpoint for testing without an MQTT broker."""
    payload = request.get_json(silent=True) or {}
    if payload.get("temperature") is None or payload.get("humidity") is None:
        return jsonify({"error": "temperature and humidity are required"}), 400
    return jsonify({"data": save_reading(payload)}), 201


if __name__ == "__main__":
    mqtt_client.start()
    app.run(
        host=os.getenv("FLASK_HOST", "0.0.0.0"),
        port=int(os.getenv("FLASK_PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
        use_reloader=False,
    )
