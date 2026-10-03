"""
FastAPI entry point: wires startup, middleware and routers.

Layout:
  config.py         environment settings (loads .env)
  db.py             SQLite connection and schema
  sensor_config.py  per-device settings and validation
  auth.py           accounts, passwords, sessions, permission checks
  storage.py        disk guard and retention cleanup
  ingest.py         MQTT reading -> database -> alerts
  alerts.py         threshold rules and offline watcher
  line_client.py    LINE webhook, recipients and delivery worker
  routers/          HTTP endpoints, one file per area
"""
import config  # first: loads .env before other modules read settings

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware

import alerts
import line_client
import storage
from db import get_db, init_db
from ingest import mqtt_client
from routers import auth as auth_routes
from routers import devices, error_response, line, notifications, sensors, users


@asynccontextmanager
async def lifespan(_app):
    init_db()
    storage.cleanup_expired_readings(force=True)
    line_client.configure(get_db, on_delivered=alerts.mark_notified)
    alerts.configure(get_db, notifier=line_client.notify)
    line_client.start_worker()
    alerts.start_offline_watcher(config.device_offline_seconds)
    mqtt_client.start()
    yield


app = FastAPI(title="SE-IoT API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.cors_origin],
    allow_credentials=True,  # the session cookie in dev, where ports differ
    allow_methods=["*"],
    allow_headers=["*"],
)
for module in (auth_routes, users, sensors, devices, notifications, line):
    app.include_router(module.router)


@app.exception_handler(HTTPException)
async def http_error(_request, exc):
    """401/403/404 use the same {"error": "..."} shape as every other error."""
    return error_response(exc.detail, exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_request, exc):
    """Turn FastAPI's 422 details into a 400 with a single readable message."""
    first = exc.errors()[0]
    field = first["loc"][-1] if first["loc"] else "request"
    if first["type"] == "json_invalid":
        return error_response("request body must be valid JSON", 400)
    if first["type"] == "dict_type":
        return error_response("request body must be a JSON object", 400)
    if first["type"] == "int_parsing":
        return error_response(f"{field} must be a number", 400)
    return error_response(f"{field}: {first['msg']}", 400)


if __name__ == "__main__":
    # One process only: the MQTT subscriber, alert watcher and LINE worker are
    # threads inside it, so multiple workers would duplicate them.
    uvicorn.run(app, host=config.api_host, port=config.api_port)
