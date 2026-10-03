"""Sensor roster with latest readings, and per-device settings."""
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends

import auth
import config
from db import get_db, row_to_reading
from routers import error_response
from sensor_config import read_config_payload, row_to_config

router = APIRouter()


@router.get("/api/devices", dependencies=[Depends(auth.approved_user)])
def devices():
    """
    Every known sensor: those that have reported, those registered but silent,
    each with its stored settings and most recent reading.
    """
    with get_db() as connection:
        readings = {
            row["device_id"]: row
            for row in connection.execute(
                """
                SELECT reading.* FROM sensor_readings AS reading
                JOIN (
                    SELECT device_id, MAX(id) AS latest_id
                    FROM sensor_readings GROUP BY device_id
                ) AS latest ON reading.id = latest.latest_id
                """
            ).fetchall()
        }
        configs = {
            row["device_id"]: row
            for row in connection.execute("SELECT * FROM sensor_config").fetchall()
        }

    now = datetime.now(timezone.utc)
    payload = []
    for device_id in sorted(set(readings) | set(configs)):
        row = readings.get(device_id)
        reading = row_to_reading(row) or {
            "device_id": device_id,
            "temperature": None,
            "humidity": None,
            "pressure": None,
            "received_at": None,
        }
        age = None
        if reading["received_at"]:
            try:
                age = (now - datetime.fromisoformat(reading["received_at"])).total_seconds()
            except ValueError:
                age = None
        reading["online"] = age is not None and age <= config.device_offline_seconds
        reading["seconds_since_reading"] = None if age is None else round(age)
        reading.update(row_to_config(configs.get(device_id), device_id))
        payload.append(reading)
    return {"data": payload, "offline_after_seconds": config.device_offline_seconds}


@router.put("/api/devices/{device_id}", dependencies=[Depends(auth.admin_user)])
def upsert_device(device_id: str, payload: dict[str, Any] | None = Body(None)):
    """Create or update a sensor's display settings and alert thresholds."""
    values, error = read_config_payload(payload or {})
    if error:
        return error_response(error, 400)

    with get_db() as connection:
        connection.execute(
            """
            INSERT INTO sensor_config
                (device_id, name, location, x, y,
                 min_temp, max_temp, min_humidity, max_humidity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id) DO UPDATE SET
                name=excluded.name, location=excluded.location,
                x=excluded.x, y=excluded.y,
                min_temp=excluded.min_temp, max_temp=excluded.max_temp,
                min_humidity=excluded.min_humidity,
                max_humidity=excluded.max_humidity
            """,
            (
                device_id, values["name"], values["location"],
                values["x"], values["y"], values["min_temp"], values["max_temp"],
                values["min_humidity"], values["max_humidity"],
            ),
        )
    return {"data": {"device_id": device_id, **values, "configured": True}}


@router.delete("/api/devices/{device_id}", dependencies=[Depends(auth.admin_user)])
def delete_device(device_id: str, purge: bool = False):
    """
    Remove a sensor's settings. Readings are kept unless ?purge=true, so
    deleting a mis-typed entry never destroys measurement history.
    """
    with get_db() as connection:
        connection.execute("DELETE FROM sensor_config WHERE device_id = ?", (device_id,))
        if purge:
            connection.execute(
                "DELETE FROM sensor_readings WHERE device_id = ?", (device_id,)
            )
    return {"data": {"device_id": device_id, "purged_readings": purge}}
