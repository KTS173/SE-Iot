"""
Permission matrix, boundary behaviour that is correct today, and the code paths
the original suite never reached (worker loops, lifespan, error branches).
"""
import json
import threading
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

import alerts
import config
import ingest
import line_client
import storage
from conftest import PASSWORD, count, iso


class StopLoop(BaseException):
    """Escapes the `except Exception` inside the forever-loops under test."""


# --- permission matrix -----------------------------------------------------------

ADMIN_ONLY = [
    ("get", "/api/users", None),
    ("put", "/api/users/1", {"role": "admin"}),
    ("delete", "/api/users/1", None),
    ("put", "/api/devices/001", {"name": "x", "location": "y"}),
    ("delete", "/api/devices/001", None),
    ("put", "/api/thresholds", {"metric": "temperature", "min": 1, "max": 2}),
    ("post", "/api/line/test", None),
]
APPROVED_ONLY = [
    ("get", "/api/sensors", None),
    ("get", "/api/sensors/latest", None),
    ("get", "/api/sensors/chart?from=a&to=b", None),
    ("get", "/api/devices", None),
    ("get", "/api/thresholds", None),
    ("get", "/api/alerts", None),
    ("get", "/api/notifications", None),
    ("get", "/api/notifications/days", None),
    ("get", "/api/line/status", None),
]


def call(browser, method, path, body):
    return getattr(browser, method)(path, **({"json": body} if body is not None else {}))


@pytest.mark.parametrize("method, path, body", ADMIN_ONLY + APPROVED_ONLY)
def test_anonymous_gets_401_everywhere(new_client, get_db, method, path, body):
    assert call(new_client(), method, path, body).status_code == 401


@pytest.mark.parametrize("method, path, body", ADMIN_ONLY + APPROVED_ONLY)
def test_pending_user_gets_403_everywhere(new_client, make_user, method, path, body):
    make_user("admin", role="admin")  # user id 1 exists
    make_user("waiting", status="pending")
    assert call(new_client("waiting"), method, path, body).status_code == 403


@pytest.mark.parametrize("method, path, body", ADMIN_ONLY)
def test_member_gets_403_on_admin_endpoints(new_client, make_user, method, path, body):
    make_user("admin", role="admin")
    make_user("member")
    assert call(new_client("member"), method, path, body).status_code == 403


def test_pending_admin_role_is_still_blocked(new_client, make_user):
    """An admin role on a not-yet-approved account grants nothing."""
    make_user("boss", role="admin", status="pending")
    assert new_client("boss").get("/api/users").status_code == 403


def test_disabled_session_is_rejected_immediately(new_client, make_user, client):
    member = make_user("member")
    browser = new_client("member")
    assert client.put(f"/api/users/{member['id']}", json={"status": "disabled"}).status_code == 200
    assert browser.get("/api/devices").status_code == 401


def test_profile_update_cannot_raise_own_role(new_client, make_user):
    make_user("member")
    browser = new_client("member")
    response = browser.put("/api/auth/me", json={
        "name": "M", "username": "member", "email": "member@lab.test",
        "role": "admin", "status": "active",
    })
    assert response.json()["data"]["role"] == "member"


def test_signup_cannot_choose_role_or_status(new_client, get_db):
    response = new_client().post("/api/auth/signup", json={
        "name": "Eve", "username": "eve", "email": "eve@lab.test", "password": PASSWORD,
        "role": "admin", "status": "active",
    })
    assert (response.json()["data"]["role"], response.json()["data"]["status"]) == ("member", "pending")


def test_health_is_public(new_client, get_db):
    assert new_client().get("/api/health").status_code == 200


# --- request validation ----------------------------------------------------------

@pytest.mark.parametrize("body, message", [
    (b"{not json", "request body must be valid JSON"),
    (b"[1, 2]", "request body must be a JSON object"),
])
def test_bad_json_bodies_are_400(client, body, message):
    response = client.put("/api/thresholds", content=body, headers={"content-type": "application/json"})
    assert response.status_code == 400
    assert response.json()["error"] == message


def test_non_numeric_query_is_400(client):
    response = client.get("/api/sensors?limit=abc")
    assert response.status_code == 400
    assert response.json()["error"] == "limit must be a number"


def test_missing_chart_range_is_400(client):
    response = client.get("/api/sensors/chart")
    assert response.status_code == 400


def test_sensor_limit_is_clamped(client, add_reading):
    for _ in range(3):
        add_reading()
    assert len(client.get("/api/sensors?limit=-5").json()["data"]) == 1
    assert len(client.get("/api/sensors?limit=999999").json()["data"]) == 3


def test_device_with_unparseable_timestamp_is_offline(client, add_reading):
    add_reading(received_at="not-a-date")
    device = client.get("/api/devices").json()["data"][0]
    assert device["online"] is False
    assert device["seconds_since_reading"] is None


# --- alert hysteresis boundaries ---------------------------------------------------

def kinds(status="active"):
    return [a["kind"] for a in alerts.list_alerts(status=status)]


def test_value_exactly_on_limit_does_not_alert(get_db, add_config):
    add_config("001")  # 18-30 C, 35-65 %RH
    ingest.save_reading({"device_id": "001", "temperature": 30.0, "humidity": 65.0})
    ingest.save_reading({"device_id": "001", "temperature": 18.0, "humidity": 35.0})
    assert kinds() == []


def test_alert_holds_inside_band_and_closes_at_margin(get_db, add_config):
    add_config("001")
    ingest.save_reading({"device_id": "001", "temperature": 30.1, "humidity": 50})
    assert kinds() == ["temp_high"]
    ingest.save_reading({"device_id": "001", "temperature": 29.6, "humidity": 50})
    assert kinds() == ["temp_high"]  # inside the 0.5 band: still open
    ingest.save_reading({"device_id": "001", "temperature": 29.5, "humidity": 50})
    assert kinds() == []


def test_low_alerts_mirror_high_alerts(get_db, add_config):
    add_config("001")
    ingest.save_reading({"device_id": "001", "temperature": 17.9, "humidity": 34.9})
    assert sorted(kinds()) == ["humidity_low", "temp_low"]
    ingest.save_reading({"device_id": "001", "temperature": 18.4, "humidity": 35.4})
    assert sorted(kinds()) == ["humidity_low", "temp_low"]
    ingest.save_reading({"device_id": "001", "temperature": 18.5, "humidity": 35.5})
    assert kinds() == []


def test_raising_the_limit_closes_an_open_alert(client, get_db, add_config):
    add_config("001")
    ingest.save_reading({"device_id": "001", "temperature": 32, "humidity": 50})
    client.put("/api/devices/001", json={"name": "Bench", "location": "Lab", "max_temp": 40})
    ingest.save_reading({"device_id": "001", "temperature": 32, "humidity": 50})
    assert kinds() == []


def test_reopened_alert_gets_new_delivery(get_db, add_config):
    add_config("001")
    for temperature in (31, 25, 31):
        ingest.save_reading({"device_id": "001", "temperature": temperature, "humidity": 50})
    states = [d["event_state"] for d in line_client.list_deliveries()]
    assert sorted(states) == ["closed", "opened", "opened"]


def test_offline_alert_opens_once_and_reading_closes_it(get_db, add_reading):
    add_reading("001", received_at=iso(minutes_ago=10))
    assert len(alerts.evaluate_offline(120)) == 1
    assert alerts.evaluate_offline(120) == []  # already open
    ingest.save_reading({"device_id": "001", "temperature": 25, "humidity": 50})
    assert kinds() == []
    closed = [d for d in line_client.list_deliveries() if d["event_state"] == "closed"]
    assert "[RESOLVED]" in closed[0]["message"]


def test_concurrent_breaches_open_a_single_alert(get_db, add_config):
    add_config("001")
    errors = []

    def send():
        try:
            ingest.save_reading({"device_id": "001", "temperature": 40, "humidity": 50})
        except Exception as error:  # pragma: no cover - reported below
            errors.append(error)

    threads = [threading.Thread(target=send) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == []
    assert count(get_db, "sensor_readings") == 8
    assert count(get_db, "alerts") == 1
    assert count(get_db, "notification_deliveries") == 1


def test_notifier_failure_does_not_break_ingestion(get_db, capsys, monkeypatch):
    def broken(event):
        raise RuntimeError("boom")

    alerts.configure(alerts._get_db, notifier=broken)
    ingest.save_reading({"device_id": "001", "temperature": 99, "humidity": 50})
    assert count(get_db, "sensor_readings") == 1
    assert "Alert notification failed for 001: boom" in capsys.readouterr().out


def test_unconfigured_alerts_module_is_inert(monkeypatch):
    monkeypatch.setattr(alerts, "_get_db", None)
    assert alerts.evaluate_reading("001", 99, 50, {}) == []
    assert alerts.evaluate_offline(120) == []
    assert alerts.list_alerts() == []


def test_offline_watcher_runs_on_its_timer(get_db, add_reading, monkeypatch, capsys):
    add_reading("001", received_at=iso(minutes_ago=10))
    started = []

    class FakeThread:
        def __init__(self, target, daemon):
            self.target = target
            started.append(self)

        def start(self):
            pass

    sleeps = iter([None, None])

    def fake_sleep(seconds):
        try:
            next(sleeps)
        except StopIteration:
            raise StopLoop

    calls = {"n": 0}
    real = alerts.evaluate_offline

    def flaky(seconds):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("db gone")
        return real(seconds)

    monkeypatch.setattr(alerts, "_offline_watcher", None)
    monkeypatch.setattr(alerts.threading, "Thread", FakeThread)
    monkeypatch.setattr(alerts.time, "sleep", fake_sleep)
    monkeypatch.setattr(alerts, "evaluate_offline", flaky)
    alerts.start_offline_watcher(120)
    alerts.start_offline_watcher(120)  # second call is a no-op
    assert len(started) == 1
    with pytest.raises(StopLoop):
        started[0].target()
    assert kinds() == ["offline"]
    assert "Offline alert check failed: db gone" in capsys.readouterr().out


# --- LINE delivery ------------------------------------------------------------------

class FakeLine:
    def __init__(self, *statuses):
        self.statuses = list(statuses)
        self.calls = []

    def post(self, url, headers, data, timeout):
        self.calls.append({"url": url, "headers": dict(headers), "body": json.loads(data)})
        status = self.statuses.pop(0) if self.statuses else 200
        return SimpleNamespace(status_code=status, ok=200 <= status < 300,
                               json=lambda: {"message": "x"})


@pytest.fixture
def line_on(monkeypatch, get_db):
    monkeypatch.setattr(line_client, "channel_access_token", "token")

    def install(*statuses):
        fake = FakeLine(*statuses)
        monkeypatch.setattr(line_client.requests, "post", fake.post)
        return fake

    return install


def queue(users):
    for user in users:
        line_client.add_recipient(user)
    ingest.save_reading({"device_id": "001", "temperature": 99, "humidity": 50})
    return line_client.list_deliveries()[0]["id"]


def row(delivery_id):
    return next(d for d in line_client.list_deliveries() if d["id"] == delivery_id)


def test_partial_multicast_failure_resumes_without_duplicates(line_on):
    fake = line_on(200, 500, 409, 200)
    delivery_id = queue([f"U{i:04d}" for i in range(501)])  # two batches: 500 + 1

    line_client._attempt(delivery_id)
    assert (row(delivery_id)["status"], row(delivery_id)["recipient_count"]) == ("pending", 500)

    line_client._attempt(delivery_id)
    assert (row(delivery_id)["status"], row(delivery_id)["recipient_count"]) == ("sent", 501)
    keys = [call["headers"]["X-Line-Retry-Key"] for call in fake.calls]
    assert keys[0] == keys[2] and keys[1] == keys[3] and keys[0] != keys[1]
    assert fake.calls[1]["url"] == line_client.PUSH_URL  # a lone recipient uses push


def test_backoff_doubles_each_attempt(line_on, monkeypatch):
    monkeypatch.setattr(line_client, "max_attempts", 4)
    line_on(500, 500, 500)
    delivery_id = queue(["U1"])
    gaps = []
    for _ in range(3):
        line_client._attempt(delivery_id)
        after = row(delivery_id)
        gap = datetime.fromisoformat(after["next_attempt_at"]) - datetime.fromisoformat(after["last_attempt_at"])
        gaps.append(gap.total_seconds())
    assert gaps == [30, 60, 120]


def test_attempt_ignores_finished_or_missing_rows(line_on):
    fake = line_on(200)
    delivery_id = queue(["U1"])
    line_client._attempt(delivery_id)
    line_client._attempt(delivery_id)  # already sent
    line_client._attempt(9999)  # never existed
    assert len(fake.calls) == 1


def test_no_recipients_fails_without_retry(line_on):
    line_on()
    ingest.save_reading({"device_id": "001", "temperature": 99, "humidity": 50})
    delivery_id = line_client.list_deliveries()[0]["id"]
    line_client._attempt(delivery_id)
    assert row(delivery_id)["status"] == "failed"
    assert row(delivery_id)["last_error"] == "No LINE recipients have added the bot yet"


def test_same_transition_is_only_queued_once(get_db):
    event = {"alert_id": 7, "state": "opened", "name": "n", "location": "l", "kind": "temp_high",
             "label": "x", "value": 31.0, "threshold": 30.0, "device_id": "001", "at": iso()}
    line_client.notify(event)
    line_client.notify(event)
    assert count(get_db, "notification_deliveries") == 1


def test_error_text_without_json_body():
    def bad_json():
        raise ValueError("not json")

    response = SimpleNamespace(status_code=502, json=bad_json)
    assert line_client._error_text(response) == "LINE responded 502: "


def test_format_time_handles_odd_values():
    assert line_client._format_time(None) is None
    assert line_client._format_time("garbage") == "garbage"
    assert line_client._format_time("2026-01-01T00:00:00").endswith("+07")  # naive = UTC


def test_offline_message_mentions_last_seen():
    text = line_client.format_alert({
        "state": "opened", "kind": "offline", "severity": "critical", "name": "Bench",
        "location": "Lab", "device_id": "001", "at": "2026-01-01T00:00:00+00:00",
        "last_seen": "2026-01-01T00:00:00+00:00", "label": "Sensor offline",
    })
    assert text.startswith("[CRITICAL] Bench\nNo readings received since 2026-01-01 07:00:00")


def test_fetch_display_name(monkeypatch, capsys):
    monkeypatch.setattr(line_client.requests, "get", lambda url, headers, timeout: SimpleNamespace(
        ok=True, json=lambda: {"displayName": "Jane"}))
    assert line_client.fetch_display_name("U1") == "Jane"

    def down(url, headers, timeout):
        raise line_client.requests.ConnectionError(f"failed for {url}")

    monkeypatch.setattr(line_client.requests, "get", down)
    assert line_client.fetch_display_name("Usecret-id") is None
    assert "Usecret-id" not in capsys.readouterr().out  # the full userId never hits logs


def test_unconfigured_line_module_is_inert(monkeypatch):
    monkeypatch.setattr(line_client, "_get_db", None)
    assert line_client.active_recipients() == []
    assert line_client.list_recipients() == []
    assert line_client.list_deliveries() == []
    assert line_client.delivery_days() == []
    assert line_client.delivery_counts() == {}


def test_worker_loop_drains_due_rows_and_survives_errors(line_on, monkeypatch, capsys):
    fake = line_on(200)
    delivery_id = queue(["U1"])
    waits = iter(range(2))

    class FakeEvent:
        def wait(self, timeout):
            try:
                next(waits)
            except StopIteration:
                raise StopLoop

        def clear(self):
            pass

        def set(self):
            pass

    real_due = line_client._due_deliveries
    calls = {"n": 0}

    def due():
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("locked")
        return real_due()

    monkeypatch.setattr(line_client, "_wake", FakeEvent())
    monkeypatch.setattr(line_client, "_due_deliveries", due)
    with pytest.raises(StopLoop):
        line_client._run_worker()
    assert row(delivery_id)["status"] == "sent"
    assert len(fake.calls) == 1
    assert "LINE worker error: locked" in capsys.readouterr().out


def test_start_worker_only_once(monkeypatch):
    started = []

    class FakeThread:
        def __init__(self, target, daemon):
            started.append(target)

        def start(self):
            pass

    monkeypatch.setattr(line_client, "_worker", None)
    monkeypatch.setattr(line_client.threading, "Thread", FakeThread)
    line_client.start_worker()
    line_client.start_worker()
    assert started == [line_client._run_worker]


def test_line_test_endpoint_success(client, line_on):
    line_on(200)
    line_client.add_recipient("U1")
    response = client.post("/api/line/test")
    assert response.status_code == 200
    assert response.json() == {"data": {"sent": 1}}


def test_delivery_days_handles_microsecond_timestamps(client, get_db):
    with get_db() as connection:
        connection.execute(
            "INSERT INTO notification_deliveries (alert_id, event_state, channel, dedupe_key, "
            "retry_key, message, status, created_at) VALUES "
            "(1, 'opened', 'line', 'a', 'k', 'm', 'failed', '2026-10-03T17:30:00.123456+00:00')"
        )
    utc = client.get("/api/notifications/days?offset=0").json()["data"]
    bangkok = client.get("/api/notifications/days?offset=25200").json()["data"]
    assert utc == [{"day": "2026-10-03", "total": 1, "failed": 1}]
    assert bangkok == [{"day": "2026-10-04", "total": 1, "failed": 1}]


def test_days_offset_is_clamped(client, get_db):
    assert client.get("/api/notifications/days?offset=999999999").status_code == 200


# --- webhook ------------------------------------------------------------------------

def test_webhook_rejects_when_no_secret_configured(new_client, get_db, monkeypatch):
    monkeypatch.setattr(line_client, "channel_secret", "")
    response = new_client().post("/api/line/webhook", content=b"{}", headers={"X-Line-Signature": "x"})
    assert response.status_code == 403


# --- storage --------------------------------------------------------------------------

def test_cleanup_is_skipped_while_another_is_running(get_db, disk):
    disk.used_percent = 99
    storage.storage_cleanup_lock.acquire()
    try:
        assert storage.cleanup_storage_if_needed() == 0
    finally:
        storage.storage_cleanup_lock.release()


def test_retention_is_skipped_while_another_is_running(get_db):
    storage.retention_cleanup_lock.acquire()
    try:
        assert storage.cleanup_expired_readings(force=True) == 0
    finally:
        storage.retention_cleanup_lock.release()


def test_retention_boundary(get_db, add_reading, monkeypatch):
    monkeypatch.setattr(config, "sensor_retention_days", 1)
    old = (datetime.now(timezone.utc) - timedelta(days=1, minutes=1)).isoformat()
    fresh = (datetime.now(timezone.utc) - timedelta(hours=23)).isoformat()
    add_reading(received_at=old)
    add_reading(received_at=fresh)
    assert storage.cleanup_expired_readings(force=True) == 1
    assert count(get_db, "sensor_readings") == 1


def test_disk_full_for_other_reasons_cuts_history_to_the_minimum(get_db, add_reading, disk, monkeypatch):
    """Characterisation (see report, 'risky areas'): if something else fills the disk,
    deleting readings never brings usage down, so cleanup removes all but the newest
    STORAGE_MIN_READINGS rows."""
    monkeypatch.setattr(config, "storage_min_readings", 5)
    monkeypatch.setattr(config, "storage_cleanup_batch_size", 4)
    for _ in range(20):
        add_reading()
    disk.used_percent = 95  # never drops: the space is not ours
    assert storage.cleanup_storage_if_needed() == 15
    assert count(get_db, "sensor_readings") == 5


# --- app lifespan ------------------------------------------------------------------------

def test_lifespan_wires_everything(get_db, monkeypatch):
    from fastapi.testclient import TestClient

    import app

    started = []
    monkeypatch.setattr(app.line_client, "start_worker", lambda: started.append("line"))
    monkeypatch.setattr(app.alerts, "start_offline_watcher", lambda s: started.append(("offline", s)))
    monkeypatch.setattr(app.mqtt_client, "start", lambda: started.append("mqtt"))
    with TestClient(app.app) as browser:
        assert browser.get("/api/health").status_code == 200
    assert started == ["line", ("offline", config.device_offline_seconds), "mqtt"]


def test_mqtt_start_survives_os_error(monkeypatch, capsys):
    from mqtt_client import SensorMqttClient

    client = SensorMqttClient(on_reading=lambda payload: None)

    def refuse(*args, **kwargs):
        raise OSError("no route")

    monkeypatch.setattr(client.client, "connect_async", refuse)
    client.start()
    assert "MQTT could not start: no route" in capsys.readouterr().out


# --- google ---------------------------------------------------------------------------------

from test_google import google_on, sign_in_with_google  # noqa: E402,F401
from routers import google  # noqa: E402


def test_malformed_id_token_is_rejected():
    assert google._decode_payload("only-one-part") is None
    assert google._decode_payload("a.!!!notbase64json.c") is None


def test_token_endpoint_network_error(new_client, google_on, monkeypatch):
    def down(*args, **kwargs):
        raise google.requests.ConnectionError("down")

    monkeypatch.setattr(google.requests, "post", down)
    response = sign_in_with_google(new_client(), google_on)
    assert response.headers["location"] == "/signin?error=google_failed"


def test_mqtt_credentials_are_used_when_set(monkeypatch):
    from mqtt_client import SensorMqttClient

    monkeypatch.setenv("MQTT_USERNAME", "sensor")
    monkeypatch.setenv("MQTT_PASSWORD", "pw")
    client = SensorMqttClient(on_reading=lambda payload: None)
    assert client.client._username == b"sensor"


def test_unknown_timezone_falls_back_to_utc(monkeypatch, capsys):
    import importlib

    monkeypatch.setenv("ALERT_TIMEZONE", "Nowhere/Bogus")
    try:
        importlib.reload(line_client)
        assert line_client.display_timezone is timezone.utc
        assert "Unknown ALERT_TIMEZONE" in capsys.readouterr().out
    finally:
        monkeypatch.setenv("ALERT_TIMEZONE", "Asia/Bangkok")
        importlib.reload(line_client)
    assert line_client.channel_access_token == ""
