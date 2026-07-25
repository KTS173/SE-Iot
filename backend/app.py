import os
import threading
from collections import deque
from datetime import datetime, timezone

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

from mqtt_client import SensorMqttClient

load_dotenv()

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": os.getenv("CORS_ORIGIN", "http://localhost:5173")}})

history = deque(maxlen=int(os.getenv("SENSOR_HISTORY_LIMIT", "100")))
data_lock = threading.Lock()


def save_reading(payload):
    reading = {
        "temperature": payload.get("temperature"),
        "humidity": payload.get("humidity"),
        "pressure": payload.get("pressure"),
        "device_id": payload.get("device_id", "unknown"),
        "received_at": datetime.now(timezone.utc).isoformat(),
    }
    with data_lock:
        history.append(reading)
    return reading


mqtt_client = SensorMqttClient(on_reading=save_reading)


@app.get("/api/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "mqtt_connected": mqtt_client.connected,
            "mqtt_topic": mqtt_client.topic,
        }
    )


@app.get("/api/sensors/latest")
def latest_sensor():
    with data_lock:
        latest = history[-1] if history else None
    return jsonify({"data": latest})


@app.get("/api/sensors")
def sensor_history():
    requested_limit = request.args.get("limit", default=20, type=int)
    limit = max(1, min(requested_limit, 100))
    with data_lock:
        readings = list(history)[-limit:]
    return jsonify({"data": readings})


@app.post("/api/sensors")
def create_sensor_reading():
    """Convenient endpoint for testing without an MQTT broker."""
    payload = request.get_json(silent=True) or {}
    if payload.get("temperature") is None or payload.get("humidity") is None:
        return jsonify({"error": "temperature and humidity are required"}), 400
    return jsonify({"data": save_reading(payload)}), 201


if __name__ == "__main__":
    mqtt_client.start()
    app.run(
        host=os.getenv("FLASK_HOST", "0.0.0.0"),
        port=int(os.getenv("FLASK_PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
        use_reloader=False,
    )
