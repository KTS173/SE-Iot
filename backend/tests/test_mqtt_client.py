from types import SimpleNamespace

import pytest

from mqtt_client import SensorMqttClient


@pytest.fixture
def received():
    return []


@pytest.fixture
def mqtt(received):
    return SensorMqttClient(on_reading=received.append)


def message(topic, payload):
    return SimpleNamespace(topic=topic, payload=payload.encode("utf-8"))


def test_device_id_comes_from_topic(mqtt, received):
    mqtt._on_message(None, None, message("Test sensor/002", '{"temperature": 25, "humidity": 50}'))
    assert received == [{"temperature": 25, "humidity": 50, "device_id": "002"}]


def test_payload_device_id_wins_over_topic(mqtt, received):
    mqtt._on_message(
        None, None,
        message("Test sensor/002", '{"device_id": "abc", "temperature": 25, "humidity": 50}'),
    )
    assert received[0]["device_id"] == "abc"


@pytest.mark.parametrize(
    "payload",
    ["not json", '{"temperature": 25}', '{"humidity": 50}', '{"temperature": null, "humidity": 1}'],
)
def test_invalid_payload_is_ignored(mqtt, received, payload, capsys):
    mqtt._on_message(None, None, message("Test sensor/002", payload))
    assert received == []
    assert "Ignored invalid MQTT message" in capsys.readouterr().out


@pytest.mark.parametrize(
    "topic, device",
    [("Test sensor/001", "001"), ("sensors/sensor-01/data", "sensor-01"), ("lonely", "unknown")],
)
def test_device_from_topic(topic, device):
    assert SensorMqttClient._device_from_topic(topic) == device


def test_connect_and_disconnect_track_state(mqtt):
    subscribed = []
    fake_client = SimpleNamespace(subscribe=subscribed.append)

    mqtt._on_connect(fake_client, None, None, 0, None)
    assert mqtt.connected is True
    assert subscribed == [mqtt.topic]

    mqtt._on_disconnect(fake_client, None, None, 0, None)
    assert mqtt.connected is False

    mqtt._on_connect(fake_client, None, None, 5, None)
    assert mqtt.connected is False
