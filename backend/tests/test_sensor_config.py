import pytest

from sensor_config import CONFIG_DEFAULTS, read_config_payload, row_to_config


def test_unknown_device_gets_defaults():
    config = row_to_config(None, "007")
    assert config["name"] == "Sensor 007"
    assert config["location"] == "Unassigned"
    assert config["configured"] is False
    assert config["max_temp"] == CONFIG_DEFAULTS["max_temp"]


def test_stored_row_is_marked_configured():
    row = {"name": "Fridge", "location": "Room 2", **CONFIG_DEFAULTS, "max_temp": 8.0}
    config = row_to_config(row, "001")
    assert config["configured"] is True
    assert config["name"] == "Fridge"
    assert config["max_temp"] == 8.0


def test_valid_payload_is_trimmed_and_coerced():
    values, error = read_config_payload(
        {"name": "  Bench  ", "location": "Lab", "x": "12", "max_temp": 40}
    )
    assert error is None
    assert values["name"] == "Bench"
    assert values["x"] == 12.0
    assert values["max_temp"] == 40.0
    assert values["min_humidity"] == CONFIG_DEFAULTS["min_humidity"]


@pytest.mark.parametrize(
    "payload, message",
    [
        ({"location": "Lab"}, "name is required"),
        ({"name": "   ", "location": "Lab"}, "name is required"),
        ({"name": "A"}, "location is required"),
        ({"name": "A", "location": "B", "y": "abc"}, "y must be a number"),
        ({"name": "A", "location": "B", "x": None}, "x must be a number"),
        ({"name": "A", "location": "B", "min_temp": 31, "max_temp": 30},
         "min_temp cannot exceed max_temp"),
        ({"name": "A", "location": "B", "min_humidity": 70, "max_humidity": 60},
         "min_humidity cannot exceed max_humidity"),
    ],
)
def test_invalid_payload_is_rejected(payload, message):
    values, error = read_config_payload(payload)
    assert values is None
    assert error == message
