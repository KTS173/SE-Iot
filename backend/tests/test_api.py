import json

import pytest

import line_client
from conftest import count, iso
from test_line_client import sign


def test_health(client, add_reading):
    add_reading()
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["stored_readings"] == 1
    assert body["mqtt_connected"] is False
    assert body["mqtt_topic"] == "Test sensor/+"


def test_latest_reading(client, add_reading):
    assert client.get("/api/sensors/latest").json() == {"data": None}
    add_reading("001", temperature=21)
    add_reading("002", temperature=22)
    assert client.get("/api/sensors/latest").json()["data"]["device_id"] == "002"


class TestHistory:
    @pytest.fixture(autouse=True)
    def readings(self, add_reading):
        for minutes_ago in (50, 40, 30, 20, 10):
            add_reading("001", received_at=iso(minutes_ago))
            add_reading("002", received_at=iso(minutes_ago))

    def get(self, client, **params):
        response = client.get("/api/sensors", params=params)
        assert response.status_code == 200
        return response.json()["data"]

    def test_returns_newest_rows_oldest_first(self, client):
        data = self.get(client, limit=3)
        assert len(data) == 3
        times = [row["received_at"] for row in data]
        assert times == sorted(times)

    @pytest.mark.parametrize("limit, expected", [(0, 1), (-5, 1), (99999, 10)])
    def test_limit_is_clamped(self, client, limit, expected):
        assert len(self.get(client, limit=limit)) == expected

    def test_filters_by_time_range_and_device(self, client):
        data = self.get(client, **{"from": iso(35), "to": iso(15), "device_id": "002", "limit": 100})
        assert len(data) == 2
        assert {row["device_id"] for row in data} == {"002"}

    def test_non_numeric_limit_is_rejected(self, client):
        response = client.get("/api/sensors", params={"limit": "abc"})
        assert response.status_code == 400
        assert response.json() == {"error": "limit must be a number"}


class TestChart:
    START = "2026-10-01T00:00:00+00:00"
    END = "2026-10-03T00:00:00+00:00"

    def get(self, client, **params):
        response = client.get("/api/sensors/chart", params={"from": self.START, "to": self.END, **params})
        assert response.status_code == 200
        return response.json()["data"]

    def test_averages_each_device_per_bucket(self, client, add_reading):
        add_reading("001", temperature=20, humidity=40, received_at="2026-10-01T10:00:10.123456+00:00")
        add_reading("001", temperature=22, humidity=42, received_at="2026-10-01T10:00:50+00:00")
        add_reading("002", temperature=30, humidity=60, received_at="2026-10-01T10:00:30+00:00")
        add_reading("001", temperature=24, humidity=44, received_at="2026-10-01T10:01:05+00:00")
        add_reading("001", temperature=99, received_at="2026-10-04T00:00:00+00:00")  # outside range

        data = self.get(client, bucket=60)
        minute = 1_790_848_800_000  # 2026-10-01T10:00:00Z in ms
        assert data == [
            {"device_id": "001", "start": minute, "temperature": 21.0, "humidity": 41.0},
            {"device_id": "002", "start": minute, "temperature": 30.0, "humidity": 60.0},
            {"device_id": "001", "start": minute + 60_000, "temperature": 24.0, "humidity": 44.0},
        ]

    def test_day_buckets_start_at_local_midnight(self, client, add_reading):
        # 23:30 UTC on the 1st is 06:30 on the 2nd in Bangkok (UTC+7).
        add_reading("001", received_at="2026-10-01T23:30:00+00:00")
        utc = self.get(client, bucket=86_400)
        bangkok = self.get(client, bucket=86_400, offset=7 * 3600)
        assert utc[0]["start"] == 1_790_812_800_000  # 2026-10-01T00:00Z
        assert bangkok[0]["start"] == 1_790_874_000_000  # 2026-10-02T00:00+07:00

    def test_bucket_is_clamped(self, client, add_reading):
        add_reading("001", received_at="2026-10-01T10:00:10+00:00")
        add_reading("001", received_at="2026-10-01T10:00:50+00:00")
        assert len(self.get(client, bucket=1)) == 1

    def test_range_is_required(self, client):
        assert client.get("/api/sensors/chart").status_code == 400


def test_devices_lists_online_offline_and_configured_only(client, add_reading, add_config):
    add_reading("001")
    add_reading("002", received_at=iso(minutes_ago=10))
    add_config("009", name="Silent")

    devices = {d["device_id"]: d for d in client.get("/api/devices").json()["data"]}
    assert devices["001"]["online"] is True
    assert devices["001"]["configured"] is False
    assert devices["002"]["online"] is False
    assert devices["002"]["seconds_since_reading"] >= 600
    assert devices["009"]["name"] == "Silent"
    assert devices["009"]["temperature"] is None
    assert devices["009"]["online"] is False


def test_put_device_saves_settings(client):
    response = client.put("/api/devices/001", json={"name": "Fridge", "location": "Room 2", "min_temp": 2, "max_temp": 8})
    assert response.status_code == 200
    assert response.json()["data"]["configured"] is True

    device = client.get("/api/devices").json()["data"][0]
    assert (device["name"], device["location"], device["max_temp"]) == ("Fridge", "Room 2", 8.0)

    client.put("/api/devices/001", json={"name": "Freezer", "location": "Room 2"})
    assert client.get("/api/devices").json()["data"][0]["name"] == "Freezer"


@pytest.mark.parametrize(
    "kwargs, message",
    [
        ({"json": {"location": "Lab"}}, "name is required"),
        ({"json": {"name": "A", "location": "B", "x": "abc"}}, "x must be a number"),
        ({"content": "not json", "headers": {"Content-Type": "application/json"}},
         "request body must be valid JSON"),
        ({"json": [1, 2]}, "request body must be a JSON object"),
    ],
)
def test_put_device_rejects_bad_input(client, kwargs, message):
    response = client.put("/api/devices/001", **kwargs)
    assert response.status_code == 400
    assert response.json() == {"error": message}


def test_delete_device_keeps_readings_unless_purged(client, get_db, add_reading, add_config):
    add_config("001")
    add_reading("001")

    assert client.delete("/api/devices/001").json()["data"]["purged_readings"] is False
    assert count(get_db, "sensor_config") == 0
    assert count(get_db, "sensor_readings") == 1

    client.delete("/api/devices/001", params={"purge": "true"})
    assert count(get_db, "sensor_readings") == 0


def test_alerts_and_notifications_endpoints(client, add_config):
    import ingest
    add_config("001", max_temp=30)
    ingest.save_reading({"device_id": "001", "temperature": 35, "humidity": 50})

    active = client.get("/api/alerts").json()["data"]
    assert [a["kind"] for a in active] == ["temp_high"]
    assert len(client.get("/api/alerts", params={"status": "all", "limit": 1}).json()["data"]) == 1
    assert client.get("/api/notifications").json()["data"][0]["status"] == "skipped"


@pytest.mark.parametrize("path", ["/api/alerts", "/api/notifications"])
def test_list_limit_must_be_numeric(client, path):
    response = client.get(path, params={"limit": "abc"})
    assert response.status_code == 400
    assert response.json() == {"error": "limit must be a number"}


def test_webhook_rejects_unsigned_requests(client):
    response = client.post("/api/line/webhook", content=b'{"events": []}')
    assert response.status_code == 403
    assert line_client.active_recipients() == []


def test_webhook_registers_follower(client, monkeypatch):
    monkeypatch.setattr(line_client, "fetch_display_name", lambda user_id: None)
    body = json.dumps({"events": [{"type": "follow", "source": {"userId": "U1"}}]}).encode()

    response = client.post("/api/line/webhook", content=body, headers={"X-Line-Signature": sign(body)})
    assert response.json() == {"status": "ok"}
    assert line_client.active_recipients() == ["U1"]


def test_webhook_ignores_malformed_body_but_answers_ok(client):
    body = b"not json"
    response = client.post("/api/line/webhook", content=body, headers={"X-Line-Signature": sign(body)})
    assert response.status_code == 200


def test_line_status_and_test_push_without_credentials(client):
    status = client.get("/api/line/status").json()["data"]
    assert status == {"configured": False, "recipients": [], "active_alerts": 0, "deliveries": {}}

    response = client.post("/api/line/test")
    assert response.status_code == 502
    assert response.json()["error"] == "LINE credentials are not configured"


def test_cors_allows_configured_origin_only(client):
    headers = {"Access-Control-Request-Method": "PUT"}
    allowed = client.options("/api/devices/1", headers={**headers, "Origin": "http://frontend.test"})
    assert allowed.headers["access-control-allow-origin"] == "http://frontend.test"

    blocked = client.options("/api/devices/1", headers={**headers, "Origin": "http://evil.test"})
    assert "access-control-allow-origin" not in blocked.headers


def device_ids(client):
    return [d["device_id"] for d in client.get("/api/devices").json()["data"]]


def test_deleted_sensor_stays_gone_even_with_old_readings(client, add_reading, add_config):
    add_config("001")
    add_reading("001")
    add_reading("002")

    client.delete("/api/devices/001")
    assert device_ids(client) == ["002"]


def test_deleted_sensor_returns_when_it_reports_again(client, add_reading):
    import ingest
    add_reading("001")
    client.delete("/api/devices/001")
    assert device_ids(client) == []

    ingest.save_reading({"device_id": "001", "temperature": 25, "humidity": 50})
    assert device_ids(client) == ["001"]


def test_re_adding_a_deleted_sensor_brings_it_back(client, add_reading):
    add_reading("001")
    client.delete("/api/devices/001")
    client.put("/api/devices/001", json={"name": "Back", "location": "Lab"})
    assert device_ids(client) == ["001"]


def test_deleting_closes_its_alerts_and_stops_offline_alerts(client, add_reading, add_config):
    import alerts
    import ingest
    from conftest import iso
    add_config("001", max_temp=30)
    ingest.save_reading({"device_id": "001", "temperature": 40, "humidity": 50})
    add_reading("002", received_at=iso(minutes_ago=10))
    assert {a["device_id"] for a in alerts.list_alerts()} == {"001"}

    client.delete("/api/devices/001")
    client.delete("/api/devices/002")
    assert alerts.list_alerts() == []
    assert alerts.evaluate_offline(offline_seconds=120) == []
