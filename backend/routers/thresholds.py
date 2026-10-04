"""One alert range for every sensor, set by an admin from the dashboard chart."""
import math
from typing import Any

from fastapi import APIRouter, Body, Depends

import auth
from db import get_db
from routers import error_response
from sensor_config import METRIC_KEYS, default_thresholds

router = APIRouter(prefix="/api/thresholds")


@router.get("", dependencies=[Depends(auth.approved_user)])
def get_thresholds():
    """The range new sensors start with (each sensor's own values are on /api/devices)."""
    with get_db() as connection:
        return {"data": default_thresholds(connection)}


@router.put("", dependencies=[Depends(auth.admin_user)])
def set_thresholds(payload: dict[str, Any] | None = Body(None)):
    """
    Body: {"metric": "temperature" | "humidity", "min": number, "max": number}.
    Applies to every sensor now and becomes the default for new ones; per-sensor
    values can still be changed afterwards on the Sensors page.
    """
    payload = payload or {}
    metric = payload.get("metric")
    if metric not in METRIC_KEYS:
        return error_response("metric must be temperature or humidity", 400)
    try:
        low, high = float(payload.get("min")), float(payload.get("max"))
    except (TypeError, ValueError):
        return error_response("min and max must be numbers", 400)
    if not (math.isfinite(low) and math.isfinite(high)):
        return error_response("min and max must be finite numbers", 400)
    if low >= high:
        return error_response("min must be lower than max", 400)
    if metric == "humidity" and not (0 <= low and high <= 100):
        return error_response("humidity range must be between 0 and 100", 400)

    min_key, max_key = METRIC_KEYS[metric]
    with get_db() as connection:
        connection.executemany(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [(min_key, str(low)), (max_key, str(high))],
        )
        # Column names come from METRIC_KEYS, never from the request.
        updated = connection.execute(
            f"UPDATE sensor_config SET {min_key} = ?, {max_key} = ?", (low, high)
        ).rowcount
        defaults = default_thresholds(connection)
    return {"data": defaults, "updated_sensors": updated}
