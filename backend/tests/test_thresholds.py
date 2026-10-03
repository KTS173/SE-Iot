import pytest

import alerts
import ingest


def test_defaults_until_an_admin_changes_them(client):
    assert client.get("/api/thresholds").json()["data"] == {
        "min_temp": 18.0, "max_temp": 30.0, "min_humidity": 35.0, "max_humidity": 65.0,
    }


def test_range_applies_to_every_sensor_and_new_ones(client, add_config, add_reading):
    add_config("001", max_temp=30)
    add_config("002", max_temp=25)
    add_reading("003")  # reported but never configured

    response = client.put("/api/thresholds", json={"metric": "temperature", "min": 2, "max": 8})
    assert response.status_code == 200
    assert response.json()["updated_sensors"] == 2

    devices = {d["device_id"]: d for d in client.get("/api/devices").json()["data"]}
    assert {(d["min_temp"], d["max_temp"]) for d in devices.values()} == {(2.0, 8.0)}
    # Humidity untouched.
    assert devices["001"]["max_humidity"] == 65.0


def test_new_range_drives_alerts_for_unconfigured_sensors(client):
    client.put("/api/thresholds", json={"metric": "humidity", "min": 40, "max": 50})
    ingest.save_reading({"device_id": "new", "temperature": 22, "humidity": 55})
    active = alerts.list_alerts()
    assert [(a["kind"], a["threshold"]) for a in active] == [("humidity_high", 50.0)]


@pytest.mark.parametrize(
    "body, message",
    [
        ({"metric": "pressure", "min": 1, "max": 2}, "metric must be temperature or humidity"),
        ({"metric": "temperature", "min": "x", "max": 2}, "min and max must be numbers"),
        ({"metric": "temperature", "max": 2}, "min and max must be numbers"),
        ({"metric": "temperature", "min": 30, "max": 30}, "min must be lower than max"),
        ({"metric": "humidity", "min": -5, "max": 50}, "humidity range must be between 0 and 100"),
        ({"metric": "humidity", "min": 10, "max": 120}, "humidity range must be between 0 and 100"),
    ],
)
def test_invalid_range_is_rejected(client, body, message):
    response = client.put("/api/thresholds", json=body)
    assert response.status_code == 400
    assert response.json() == {"error": message}


def test_only_admins_can_change_the_range(make_user, new_client):
    make_user("member")
    member = new_client("member")
    assert member.get("/api/thresholds").status_code == 200
    response = member.put("/api/thresholds", json={"metric": "temperature", "min": 1, "max": 2})
    assert response.status_code == 403
