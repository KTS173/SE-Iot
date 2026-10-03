"""Settings read from the environment. Import this before any other app module."""
import os

from dotenv import load_dotenv

# alerts.py and line_client.py read their settings at import time,
# so .env has to be loaded before they are imported.
load_dotenv()

api_host = os.getenv("API_HOST", "0.0.0.0")
api_port = int(os.getenv("API_PORT", "5000"))
cors_origin = os.getenv("CORS_ORIGIN", "http://localhost:5173")

database_path = os.getenv("DATABASE_PATH", "sensor_data.db")
storage_warning_percent = float(os.getenv("STORAGE_WARNING_PERCENT", "85"))
storage_cleanup_target_percent = float(os.getenv("STORAGE_CLEANUP_TARGET_PERCENT", "80"))
storage_cleanup_batch_size = int(os.getenv("STORAGE_CLEANUP_BATCH_SIZE", "10000"))
storage_min_readings = int(os.getenv("STORAGE_MIN_READINGS", "100"))
sensor_retention_days = int(os.getenv("SENSOR_RETENTION_DAYS", "31"))
device_offline_seconds = int(os.getenv("DEVICE_OFFLINE_SECONDS", "120"))

# Sign-in: a normal session lasts a working day, "Remember me" a month.
session_hours = int(os.getenv("SESSION_HOURS", "8"))
remember_days = int(os.getenv("REMEMBER_DAYS", "30"))
