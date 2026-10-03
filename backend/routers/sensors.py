"""Health check and sensor reading history."""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

import auth
import config
from db import get_db, row_to_reading
from ingest import mqtt_client
from storage import get_storage_status

router = APIRouter()


@router.get("/api/health")
def health():
    with get_db() as connection:
        reading_count = connection.execute(
            "SELECT COUNT(*) FROM sensor_readings"
        ).fetchone()[0]
    return {
        "status": "ok",
        "mqtt_connected": mqtt_client.connected,
        "mqtt_topic": mqtt_client.topic,
        "stored_readings": reading_count,
        "storage": get_storage_status(),
        "storage_retention": {
            "cleanup_target_percent": config.storage_cleanup_target_percent,
            "minimum_readings": config.storage_min_readings,
            "retention_days": config.sensor_retention_days,
        },
    }


@router.get("/api/sensors/latest", dependencies=[Depends(auth.approved_user)])
def latest_sensor():
    with get_db() as connection:
        row = connection.execute(
            "SELECT * FROM sensor_readings ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return {"data": row_to_reading(row)}


@router.get("/api/sensors", dependencies=[Depends(auth.approved_user)])
def sensor_history(
    limit: int = 20,
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    device_id: str | None = None,
):
    limit = max(1, min(limit, 5000))

    # received_at is stored as an ISO-8601 UTC string, so lexicographic
    # comparison is chronological and the index on it still applies.
    filters, params = [], []
    for value, operator in ((from_, ">="), (to, "<=")):
        if value:
            filters.append(f"received_at {operator} ?")
            params.append(value)
    if device_id:
        filters.append("device_id = ?")
        params.append(device_id)
    where = f"WHERE {' AND '.join(filters)}" if filters else ""

    with get_db() as connection:
        rows = connection.execute(
            f"""
            SELECT * FROM (
                SELECT * FROM sensor_readings {where} ORDER BY id DESC LIMIT ?
            ) ORDER BY id ASC
            """,
            (*params, limit),
        ).fetchall()
    readings = [row_to_reading(row) for row in rows]
    # Up to 5000 plain dicts: JSONResponse skips FastAPI's per-field encoder.
    return JSONResponse({"data": readings})
