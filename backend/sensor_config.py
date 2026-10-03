"""Per-device display settings and alert thresholds."""

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
