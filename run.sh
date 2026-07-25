#!/usr/bin/env bash
# Build and run the full SE-IoT stack (MQTT broker + Flask backend + React frontend).
set -euo pipefail

cd "$(dirname "$0")"

# Pick docker compose v2 (plugin) or legacy docker-compose.
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "Error: docker compose not found. Install Docker Desktop or the compose plugin." >&2
  exit 1
fi

ACTION="${1:-up}"

case "$ACTION" in
  up)
    $COMPOSE up --build -d
    echo
    echo "Stack running:"
    echo "  Frontend : http://localhost:5174"
    echo "  Backend  : http://localhost:5001/api/health"
    echo "  MQTT     : localhost:1883  (topic sensors/+/data)"
    ;;
  logs)
    $COMPOSE logs -f
    ;;
  down)
    $COMPOSE down
    ;;
  *)
    echo "Usage: $0 [up|logs|down]" >&2
    exit 1
    ;;
esac
