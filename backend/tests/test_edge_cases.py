"""
Edge cases that expose confirmed bugs.

Every test here states the behaviour the app *should* have and is marked
xfail(strict=True): the suite stays green today, and the moment a bug is fixed
the test starts passing, strict xfail turns that into a failure, and the marker
should simply be removed.
"""
import base64
import hashlib
import hmac
import json
import shutil
import socket
import subprocess
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import alerts
import config
import ingest
import line_client
from conftest import PASSWORD, count
from mqtt_client import SensorMqttClient


def bug(reason):
    return pytest.mark.xfail(strict=True, reason=f"BUG: {reason}")


@pytest.fixture
def raw_client(get_db):
    """Like new_client, but a server exception becomes a 500 response, as in production."""
    import app

    def make(username=None, **headers):
        browser = TestClient(app.app, raise_server_exceptions=False)
        if username:
            response = browser.post(
                "/api/auth/login", json={"identifier": username, "password": PASSWORD},
                headers=headers,
            )
            assert response.status_code == 200, response.text
        return browser

    return make


@pytest.fixture
def admin(make_user, raw_client):
    make_user("admin", role="admin")
    return raw_client("admin")


def mqtt_message(payload, topic="Test sensor/001"):
    return SimpleNamespace(topic=topic, payload=payload.encode("utf-8"))


def sign(body):
    return base64.b64encode(hmac.new(b"test-secret", body, hashlib.sha256).digest()).decode()


# --- MQTT ingestion -----------------------------------------------------------

@bug("mqtt_client.py:39 calls payload.get() on any JSON value; a JSON array/number/string "
     "raises AttributeError, which is not in the except tuple and escapes into paho")
@pytest.mark.parametrize("payload", ["[1, 2]", "42", '"hello"', "null"])
def test_non_object_json_payload_is_ignored(get_db, payload):
    client = SensorMqttClient(on_reading=ingest.save_reading)
    client._on_message(None, None, mqtt_message(payload))  # must not raise
    assert count(get_db, "sensor_readings") == 0


@bug("NaN is valid Python JSON; SQLite stores NaN as NULL so the NOT NULL insert raises "
     "sqlite3.IntegrityError, which escapes mqtt_client._on_message into paho")
def test_nan_reading_is_rejected_quietly(get_db):
    client = SensorMqttClient(on_reading=ingest.save_reading)
    client._on_message(None, None, mqtt_message('{"temperature": NaN, "humidity": 50}'))
    assert count(get_db, "sensor_readings") == 0


@bug("a non-scalar field (dict/list) makes sqlite3 raise ProgrammingError, which escapes "
     "mqtt_client._on_message into paho")
def test_nested_value_reading_is_rejected_quietly(get_db):
    client = SensorMqttClient(on_reading=ingest.save_reading)
    client._on_message(
        None, None, mqtt_message('{"temperature": {"v": 25}, "humidity": 50}')
    )
    assert count(get_db, "sensor_readings") == 0


def test_paho_reraises_callback_exceptions():
    """Why the three bugs above matter: paho 2.x re-raises on_message errors by default,
    and loop_forever() does not catch them, so the network thread dies."""
    client = SensorMqttClient(on_reading=lambda payload: None)
    assert client.client.suppress_exceptions is False


def _free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture
def broker(tmp_path):
    binary = shutil.which("mosquitto") or "/opt/homebrew/sbin/mosquitto"
    if not shutil.which(binary):
        pytest.skip("mosquitto is not installed")
    port = _free_port()
    conf = tmp_path / "mosquitto.conf"
    conf.write_text(f"listener {port} 127.0.0.1\nallow_anonymous true\n")
    process = subprocess.Popen(
        [binary, "-c", str(conf)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.05)
    yield port
    process.terminate()
    process.wait(timeout=5)


def _wait_for(condition, seconds=4.0):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if condition():
            return True
        time.sleep(0.05)
    return condition()


def _run_broker_session(get_db, broker, payloads):
    """Publish payloads through a real broker to a real subscriber; return it afterwards."""
    import paho.mqtt.client as mqtt

    subscriber = SensorMqttClient(on_reading=ingest.save_reading)
    subscriber.host, subscriber.port = "127.0.0.1", broker
    subscriber.start()
    publisher = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    try:
        assert _wait_for(lambda: subscriber.connected), "subscriber never connected"
        time.sleep(0.2)  # let the SUBSCRIBE land
        publisher.connect("127.0.0.1", broker)
        publisher.loop_start()
        for payload in payloads:
            publisher.publish("Test sensor/001", payload, qos=1).wait_for_publish(2)
        _wait_for(lambda: count(get_db, "sensor_readings") >= 1, seconds=2)
        thread_alive = subscriber.client._thread is not None
    finally:
        publisher.loop_stop()
        publisher.disconnect()
        subscriber.client.disconnect()
        subscriber.client.loop_stop()
    return thread_alive


def test_broker_round_trip_control(get_db, broker):
    """Control for the test below: with only good messages, ingestion works end to end."""
    alive = _run_broker_session(get_db, broker, ['{"temperature": 25, "humidity": 50}'])
    assert count(get_db, "sensor_readings") == 1
    assert alive


@bug("one malformed MQTT message kills the paho network thread, so every later reading "
     "from every sensor is silently dropped until the backend restarts")
def test_one_bad_message_does_not_stop_ingestion(get_db, broker):
    alive = _run_broker_session(
        get_db, broker, ["[1]", '{"temperature": 25, "humidity": 50}']
    )
    assert alive, "paho network thread died"
    assert count(get_db, "sensor_readings") == 1


@bug("ingest.py:31-37 keeps the raw payload values; a numeric string such as \"35\" is "
     "stored as 35.0 by SQLite but alerts compare the string, raise TypeError (swallowed at "
     "ingest.py:24) and no alert is ever opened")
def test_numeric_string_reading_still_raises_an_alert(get_db):
    ingest.save_reading({"device_id": "001", "temperature": "35", "humidity": "50"})
    assert count(get_db, "sensor_readings") == 1
    assert [a["kind"] for a in alerts.list_alerts()] == ["temp_high"]


@bug("a reading of 1e999 parses to float('inf'), is stored, and then every endpoint that "
     "returns it fails with 500 (Starlette JSON rejects inf) until the row is purged")
@pytest.mark.parametrize("path", ["/api/sensors", "/api/sensors/latest", "/api/devices", "/api/alerts"])
def test_infinite_reading_does_not_break_the_dashboard(admin, get_db, path):
    client = SensorMqttClient(on_reading=ingest.save_reading)
    client._on_message(None, None, mqtt_message('{"temperature": 1e999, "humidity": 50}'))
    assert admin.get(path).status_code == 200


# --- sensor settings / thresholds -----------------------------------------------

@bug("sensor_config.read_config_payload accepts float('inf'); once stored, GET /api/devices "
     "returns 500 for every user")
def test_infinite_device_threshold_is_rejected(admin):
    response = admin.put(
        "/api/devices/001", json={"name": "Bench", "location": "Lab", "max_temp": "Infinity"}
    )
    assert response.status_code == 400
    assert admin.get("/api/devices").status_code == 200


@bug("sensor_config.read_config_payload accepts 'nan' (comparisons with NaN are False); "
     "SQLite turns it into NULL and the NOT NULL insert gives a 500 instead of a 400")
def test_nan_device_threshold_is_a_400(admin):
    response = admin.put(
        "/api/devices/001", json={"name": "Bench", "location": "Lab", "min_temp": "nan"}
    )
    assert response.status_code == 400


@bug("routers/thresholds.py:33 accepts -inf/inf for temperature; afterwards GET /api/thresholds "
     "and GET /api/devices return 500")
def test_infinite_default_thresholds_are_rejected(admin):
    response = admin.put(
        "/api/thresholds", json={"metric": "temperature", "min": "-inf", "max": "inf"}
    )
    assert response.status_code == 400
    assert admin.get("/api/thresholds").status_code == 200


@bug("routers/thresholds.py:36 'low >= high' is False for NaN, so a NaN temperature range "
     "passes validation and the UPDATE fails with a 500")
def test_nan_default_threshold_is_a_400(admin, add_config):
    add_config("001")
    response = admin.put(
        "/api/thresholds", json={"metric": "temperature", "min": "nan", "max": 30}
    )
    assert response.status_code == 400


# --- list limits -----------------------------------------------------------------

def _many_alerts(get_db, total):
    with get_db() as connection:
        connection.executemany(
            "INSERT INTO alerts (device_id, kind, opened_at, closed_at) VALUES (?, 'temp_high', ?, ?)",
            [(f"d{i}", "2026-01-01T00:00:00+00:00", "2026-01-01T01:00:00+00:00") for i in range(total)],
        )


@bug("routers/notifications.py:13 only caps the top (min(limit, 500)); limit=-1 reaches "
     "SQLite as LIMIT -1, i.e. no limit")
def test_alert_limit_cannot_be_bypassed_with_a_negative_number(client, get_db):
    _many_alerts(get_db, 501)
    assert len(client.get("/api/alerts?status=all&limit=-1").json()["data"]) <= 500


def _delivery(get_db, created_at, number=1):
    with get_db() as connection:
        connection.execute(
            "INSERT INTO notification_deliveries (alert_id, event_state, channel, dedupe_key, "
            "retry_key, message, status, created_at) VALUES (?, 'opened', 'line', ?, 'k', 'm', 'sent', ?)",
            (number, f"line:{number}:opened", created_at),
        )


@bug("routers/notifications.py:23 same negative-limit bypass for the delivery log")
def test_notification_limit_cannot_be_bypassed_with_a_negative_number(client, get_db):
    for number in range(501):
        _delivery(get_db, "2026-10-01T00:00:00+00:00", number)
    assert len(client.get("/api/notifications?limit=-1").json()["data"]) <= 500


# --- date filters: '+00:00' in the database vs 'Z' from the browser ---------------

# The browser sends startOfDay(...).toISOString() => '2026-10-03T17:00:00.000Z' for
# Bangkok midnight on 4 Oct. created_at is datetime.isoformat() => microseconds and
# '+00:00', and no fraction at all when microsecond == 0. The filter compares strings.
DAY = {"from": "2026-10-03T17:00:00.000Z", "to": "2026-10-04T16:59:59.999Z"}


@bug("line_client.list_deliveries compares ISO strings: '...17:00:00.000300+00:00' < "
     "'...17:00:00.000Z' because '3' < 'Z', so a message from the first millisecond of the "
     "local day is missing from that day")
def test_message_in_first_millisecond_of_day_is_listed(client, get_db):
    _delivery(get_db, "2026-10-03T17:00:00.000300+00:00")
    assert len(client.get("/api/notifications", params=DAY).json()["data"]) == 1


@bug("line_client.list_deliveries: isoformat() drops the fraction when microsecond == 0, "
     "and '...17:00:00+00:00' < '...17:00:00.000Z' because '+' < '.'")
def test_message_exactly_at_midnight_is_listed(client, get_db):
    _delivery(get_db, "2026-10-03T17:00:00+00:00")
    assert len(client.get("/api/notifications", params=DAY).json()["data"]) == 1


@bug("routers/sensors.py:55-58 has the same string comparison for readings: a reading at "
     "the exact 'from' instant is dropped")
def test_reading_at_from_boundary_is_included(client, add_reading):
    add_reading(received_at="2026-10-03T17:00:00+00:00")
    response = client.get("/api/sensors", params=DAY)
    assert len(response.json()["data"]) == 1


@bug("a message 0.5 ms after the 'to' instant is still returned: '...59.999500+00:00' <= "
     "'...59.999Z' because '5' < 'Z'")
def test_message_after_to_boundary_is_excluded(client, get_db):
    _delivery(get_db, "2026-10-04T16:59:59.999500+00:00")
    assert client.get("/api/notifications", params=DAY).json()["data"] == []


# --- LINE webhook ------------------------------------------------------------------

@bug("line_client.verify_signature passes a non-ASCII header to hmac.compare_digest, which "
     "raises TypeError: an unauthenticated request gets a 500 instead of 403")
def test_non_ascii_signature_is_a_403(raw_client):
    response = raw_client().post(
        "/api/line/webhook", content=b'{"events": []}',
        headers={"X-Line-Signature": "é".encode("latin-1")},
    )
    assert response.status_code == 403


@bug("routers/line.py:28-32 only catches decode/JSON/KeyError; a signed body that is a JSON "
     "array, or an event whose source is null, raises AttributeError -> 500, and LINE retries")
@pytest.mark.parametrize("body", [
    b"[]",
    b'{"events": [{"type": "follow", "source": null}]}',
    b'{"events": ["oops"]}',
    b'{"events": 5}',
])
def test_odd_but_signed_webhook_body_still_gets_200(raw_client, body):
    response = raw_client().post(
        "/api/line/webhook", content=body, headers={"X-Line-Signature": sign(body)}
    )
    assert response.status_code == 200


# --- Google sign-in / sign-in throttle -----------------------------------------------

from test_google import CLIENT_ID, google_on, sign_in_with_google  # noqa: E402,F401


@bug("routers/google.py:153 hmac.compare_digest(saved, state) raises TypeError for a "
     "non-ASCII ?state=, giving a 500 instead of the sign-in error page")
def test_non_ascii_state_returns_to_signin(get_db, google_on, monkeypatch):
    import app

    browser = TestClient(app.app, raise_server_exceptions=False)
    browser.get("/api/auth/google/start", follow_redirects=False)
    response = browser.get(
        "/api/auth/google/callback?code=x&state=%C3%A9", follow_redirects=False
    )
    assert response.status_code == 303


@bug("routers/google.py:107-111 links a Google login to any account with the same email, "
     "but local sign-up never verifies email: an attacker who signs up first with the "
     "victim's address gets the victim's Google logins into an account the attacker "
     "controls by password (pre-account takeover)")
def test_google_does_not_adopt_an_unverified_local_account(new_client, google_on):
    attacker = new_client()
    signup = attacker.post("/api/auth/signup", json={
        "name": "Mallory", "username": "mallory", "email": "victim@gmail.com",
        "password": PASSWORD,
    })
    assert signup.status_code == 201

    victim = new_client()
    sign_in_with_google(victim, google_on, email="victim@gmail.com", sub="google-victim")
    victim_account = victim.get("/api/auth/me").json()["data"]
    assert victim_account["id"] != signup.json()["data"]["id"]


@bug("routers/auth.py:27 trusts the client-supplied X-Real-IP header for the lockout key; "
     "the backend port (5001) is published directly in docker-compose, so rotating the "
     "header gives unlimited password guesses")
def test_lockout_cannot_be_dodged_by_changing_x_real_ip(new_client, make_user):
    make_user("jane")
    browser = new_client()
    for attempt in range(5):
        browser.post("/api/auth/login", json={"identifier": "jane", "password": "wrong-pass"},
                     headers={"X-Real-IP": "10.0.0.1"})
    locked = browser.post("/api/auth/login", json={"identifier": "jane", "password": "wrong-pass"},
                          headers={"X-Real-IP": "10.0.0.1"})
    assert locked.status_code == 429
    dodge = browser.post("/api/auth/login", json={"identifier": "jane", "password": "wrong-pass"},
                         headers={"X-Real-IP": "10.0.0.2"})
    assert dodge.status_code == 429


# --- removed sensors --------------------------------------------------------------------

@bug("routers/devices.py:115-119 closes a removed sensor's alerts 'quietly' but leaves its "
     "queued LINE deliveries pending, so the worker still sends the alert afterwards")
def test_removed_sensor_alert_is_not_sent_later(client, get_db, monkeypatch):
    sent = []

    def fake_post(url, headers, data, timeout):
        sent.append(json.loads(data))
        return SimpleNamespace(status_code=200, ok=True)

    monkeypatch.setattr(line_client, "channel_access_token", "token")
    monkeypatch.setattr(line_client.requests, "post", fake_post)
    line_client.add_recipient("U1")
    ingest.save_reading({"device_id": "001", "temperature": 99, "humidity": 50})
    pending = line_client.list_deliveries()[0]
    assert pending["status"] == "pending"

    assert client.delete("/api/devices/001").status_code == 200
    line_client._attempt(pending["id"])
    assert sent == []
