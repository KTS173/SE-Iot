import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Set before any app module is imported: config, alerts and line_client read the
# environment at import time, and load_dotenv never overrides a variable that is
# already set, so a developer's real backend/.env (LINE token) cannot leak in.
os.environ.update(
    {
        "DATABASE_PATH": "unused-by-tests.db",
        "MQTT_HOST": "127.0.0.1",
        "MQTT_PORT": "1",
        "MQTT_TOPIC": "Test sensor/+",
        "CORS_ORIGIN": "http://frontend.test",
        "LINE_CHANNEL_ACCESS_TOKEN": "",
        "LINE_CHANNEL_SECRET": "test-secret",
        "DEVICE_OFFLINE_SECONDS": "120",
        "GOOGLE_CLIENT_ID": "",
        "GOOGLE_CLIENT_SECRET": "",
        "GOOGLE_ALLOWED_DOMAINS": "",
        "PUBLIC_URL": "",
        # Pinned so a developer's .env (loaded by config.py) cannot change
        # behaviour the tests depend on, or hand the MQTT client real credentials.
        "MQTT_USERNAME": "",
        "MQTT_PASSWORD": "",
        "ALERT_HYSTERESIS": "0.5",
        "ALERT_CHECK_SECONDS": "60",
        "ALERT_TIMEZONE": "Asia/Bangkok",
        "LINE_MAX_ATTEMPTS": "5",
        "LINE_RETRY_BASE_SECONDS": "30",
        "LINE_POLL_SECONDS": "5",
        "SESSION_HOURS": "8",
        "REMEMBER_DAYS": "30",
    }
)

import alerts  # noqa: E402
import auth  # noqa: E402
import config  # noqa: E402
import db as db_module  # noqa: E402
import line_client  # noqa: E402
import storage  # noqa: E402


# Belt and braces: even if a token leaked in, no test may reach the network.
assert line_client.channel_access_token == "", "a real LINE token reached the tests"


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Any real HTTP request fails loudly; tests patch requests.post/get with fakes."""
    import requests

    def blocked(*args, **kwargs):
        raise RuntimeError("network access is disabled in tests")

    monkeypatch.setattr(requests.Session, "request", blocked)


class FakeDisk:
    """Stands in for shutil.disk_usage so tests never depend on the real disk."""

    def __init__(self):
        self.used_percent = 10.0

    def status(self):
        return {
            "used_percent": self.used_percent,
            "free_bytes": 1_000,
            "total_bytes": 10_000,
            "warning_percent": config.storage_warning_percent,
            "alert": self.used_percent >= config.storage_warning_percent,
        }


@pytest.fixture
def disk(monkeypatch):
    fake = FakeDisk()
    monkeypatch.setattr(storage, "get_storage_status", fake.status)
    return fake


@pytest.fixture
def get_db(tmp_path, monkeypatch, disk):
    """A fresh, fully initialised database per test, wired like app startup."""
    monkeypatch.setattr(config, "database_path", str(tmp_path / "test.db"))
    monkeypatch.setattr(storage, "last_retention_cleanup", 0.0)
    monkeypatch.setattr(storage, "storage_warning_logged", False)
    monkeypatch.setattr(auth, "_failed_logins", {})
    db_module.init_db()
    line_client.configure(db_module.get_db, on_delivered=alerts.mark_notified)
    alerts.configure(db_module.get_db, notifier=line_client.notify)
    yield db_module.get_db
    alerts.configure(None)
    line_client.configure(None)


PASSWORD = "password123"


@pytest.fixture
def make_user(get_db):
    def make(username, role="member", status="active"):
        user, error = auth.create_user(
            name=username.title(), username=username, email=f"{username}@lab.test",
            password=PASSWORD, role=role, status=status,
        )
        assert error is None
        return user

    return make


@pytest.fixture
def new_client(get_db):
    """A fresh browser: no cookies. Pass a username to sign in as that user."""
    from fastapi.testclient import TestClient

    import app

    def make(username=None):
        # No `with`: skips lifespan, so no MQTT connection or background threads.
        browser = TestClient(app.app)
        if username:
            response = browser.post(
                "/api/auth/login", json={"identifier": username, "password": PASSWORD}
            )
            assert response.status_code == 200, response.text
        return browser

    return make


@pytest.fixture
def client(make_user, new_client):
    """Signed in as an approved admin, so every endpoint is reachable."""
    make_user("admin", role="admin")
    return new_client("admin")


def iso(minutes_ago=0):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


@pytest.fixture
def add_reading(get_db):
    def add(device_id="001", temperature=25.0, humidity=50.0, pressure=None, received_at=None):
        with get_db() as connection:
            cursor = connection.execute(
                "INSERT INTO sensor_readings "
                "(device_id, temperature, humidity, pressure, received_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (device_id, temperature, humidity, pressure, received_at or iso()),
            )
            return cursor.lastrowid

    return add


@pytest.fixture
def add_config(get_db):
    def add(device_id, name="Bench", location="Lab", **limits):
        values = {"min_temp": 18, "max_temp": 30, "min_humidity": 35, "max_humidity": 65}
        values.update(limits)
        with get_db() as connection:
            connection.execute(
                "INSERT INTO sensor_config (device_id, name, location, x, y, "
                "min_temp, max_temp, min_humidity, max_humidity) "
                "VALUES (?, ?, ?, 50, 50, ?, ?, ?, ?)",
                (device_id, name, location, values["min_temp"], values["max_temp"],
                 values["min_humidity"], values["max_humidity"]),
            )

    return add


def count(get_db, table, where="1=1", params=()):
    with get_db() as connection:
        return connection.execute(
            f"SELECT COUNT(*) FROM {table} WHERE {where}", params
        ).fetchone()[0]
