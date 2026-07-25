import json
import os

import paho.mqtt.client as mqtt


class SensorMqttClient:
    def __init__(self, on_reading):
        self.on_reading = on_reading
        self.host = os.getenv("MQTT_HOST", "localhost")
        self.port = int(os.getenv("MQTT_PORT", "1883"))
        self.topic = os.getenv("MQTT_TOPIC", "sensors/+/data")
        self.username = os.getenv("MQTT_USERNAME")
        self.password = os.getenv("MQTT_PASSWORD")
        self.connected = False
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

        if self.username:
            self.client.username_pw_set(self.username, self.password)

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        self.connected = reason_code == 0
        if self.connected:
            client.subscribe(self.topic)
            print(f"MQTT connected: {self.host}:{self.port}, topic={self.topic}")
        else:
            print(f"MQTT connection failed: {reason_code}")

    def _on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties):
        self.connected = False
        print(f"MQTT disconnected: {reason_code}")

    def _on_message(self, client, userdata, message):
        try:
            payload = json.loads(message.payload.decode("utf-8"))
            if payload.get("temperature") is None or payload.get("humidity") is None:
                raise ValueError("temperature and humidity are required")
            payload.setdefault("device_id", self._device_from_topic(message.topic))
            self.on_reading(payload)
            print(f"Sensor data received from {message.topic}: {payload}")
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            print(f"Ignored invalid MQTT message on {message.topic}: {error}")

    @staticmethod
    def _device_from_topic(topic):
        parts = topic.split("/")
        return parts[1] if len(parts) > 2 else "unknown"

    def start(self):
        try:
            self.client.connect_async(self.host, self.port, keepalive=60)
            self.client.loop_start()
        except OSError as error:
            print(f"MQTT could not start: {error}")
