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


@router.get("/api/sensors/chart", dependencies=[Depends(auth.approved_user)])
def sensor_chart(
    from_: str = Query(alias="from"),
    to: str = Query(),
    bucket: int = 60,
    offset: int = 0,
):
    """
    Per-device averages over `bucket`-second windows, for the dashboard charts.
    `offset` is the viewer's UTC offset in seconds, so day buckets start at
    local midnight. Averaging here keeps a 30-day range to a few hundred rows
    instead of every reading.
    """
    bucket = max(60, min(bucket, 86_400))
    offset = max(-14 * 3600, min(offset, 14 * 3600))
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT device_id,
                   (CAST(strftime('%s', received_at) AS INTEGER) + :offset)
                       / :bucket * :bucket - :offset AS start,
                   ROUND(AVG(temperature), 1) AS temperature,
                   ROUND(AVG(humidity), 1) AS humidity
            FROM sensor_readings
            WHERE received_at >= :from AND received_at <= :to
            GROUP BY device_id, start
            ORDER BY start, device_id
            """,
            {"from": from_, "to": to, "bucket": bucket, "offset": offset},
        ).fetchall()
    return JSONResponse({"data": [
        {
            "device_id": row["device_id"],
            "start": row["start"] * 1000,
            "temperature": row["temperature"],
            "humidity": row["humidity"],
        }
        for row in rows
    ]})
