#!/usr/bin/env bash
# Starts an isolated backend for the E2E suite: fresh seeded SQLite DB, no LINE,
# no Google, no MQTT broker. Used as a Playwright webServer.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
DB="${E2E_DB_PATH:?E2E_DB_PATH must be set}"
PORT="${E2E_API_PORT:-5011}"

# Mandatory: the repo-root .env holds real LINE credentials and config.py calls
# load_dotenv(). Exported empty values win over .env (python-dotenv never
# overrides existing variables), so nothing can be sent to LINE.
export LINE_CHANNEL_ACCESS_TOKEN="" LINE_CHANNEL_SECRET=""
export GOOGLE_CLIENT_ID="" GOOGLE_CLIENT_SECRET="" PUBLIC_URL=""
# Port 1: never connect to a real (or local docker) broker.
export MQTT_HOST=127.0.0.1 MQTT_PORT=1
export CORS_ORIGIN="${E2E_WEB_ORIGIN:-http://localhost:5199}"
export DATABASE_PATH="$DB"
# Seeded "live" readings stay online for the whole run; the offline watcher and
# LINE worker stay quiet so the delivery log is deterministic.
export DEVICE_OFFLINE_SECONDS=86400 ALERT_CHECK_SECONDS=86400 LINE_POLL_SECONDS=3600
export SENSOR_RETENTION_DAYS=60
export PYTHONDONTWRITEBYTECODE=1

mkdir -p "$(dirname "$DB")"
rm -f "$DB" "$DB-wal" "$DB-shm"

cd "$REPO/backend"
UV=(uv run --quiet --python 3.12 --with-requirements requirements.txt)
"${UV[@]}" python "$HERE/seed.py"
exec "${UV[@]}" python -m uvicorn app:app --host 127.0.0.1 --port "$PORT"
