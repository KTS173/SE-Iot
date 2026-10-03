import alerts
import ingest
from conftest import count, iso


def test_save_reading_stores_row(get_db):
    reading = ingest.save_reading({"device_id": "001", "temperature": 24.5, "humidity": 51})
    with get_db() as connection:
        row = connection.execute("SELECT * FROM sensor_readings").fetchone()
    assert row["device_id"] == "001"
    assert row["temperature"] == 24.5
    assert row["pressure"] is None
    assert row["received_at"] == reading["received_at"]


def test_save_reading_without_device_id_uses_unknown(get_db):
    assert ingest.save_reading({"temperature": 20, "humidity": 40})["device_id"] == "unknown"


def test_breach_opens_one_alert_and_queues_one_message(get_db, add_config):
    add_config("001", max_temp=30)
    ingest.save_reading({"device_id": "001", "temperature": 35, "humidity": 50})
    ingest.save_reading({"device_id": "001", "temperature": 36, "humidity": 50})

    active = alerts.list_alerts()
    assert [(a["kind"], a["value"], a["threshold"]) for a in active] == [("temp_high", 35, 30)]
    assert active[0]["name"] == "Bench"
    # LINE is not configured in tests, so the message is recorded as skipped.
    assert count(get_db, "notification_deliveries", "status = 'skipped'") == 1


def test_alert_holds_inside_hysteresis_and_closes_after(get_db, add_config):
    add_config("001", max_temp=30)
    ingest.save_reading({"device_id": "001", "temperature": 35, "humidity": 50})

    ingest.save_reading({"device_id": "001", "temperature": 29.8, "humidity": 50})
    assert len(alerts.list_alerts()) == 1

    ingest.save_reading({"device_id": "001", "temperature": 29.0, "humidity": 50})
    assert alerts.list_alerts() == []
    history = alerts.list_alerts(status="all")
    assert history[0]["active"] is False


def test_each_threshold_kind_is_detected(get_db, add_config):
    add_config("lo", min_temp=18, min_humidity=35)
    add_config("hi", max_temp=30, max_humidity=65)
    ingest.save_reading({"device_id": "lo", "temperature": 10, "humidity": 20})
    ingest.save_reading({"device_id": "hi", "temperature": 40, "humidity": 90})

    kinds = {(a["device_id"], a["kind"]) for a in alerts.list_alerts()}
    assert kinds == {
        ("lo", "temp_low"), ("lo", "humidity_low"),
        ("hi", "temp_high"), ("hi", "humidity_high"),
    }


def test_alert_rule_failure_keeps_the_reading(get_db, monkeypatch, capsys):
    def broken(*args):
        raise RuntimeError("bug in rule")
    monkeypatch.setattr(alerts, "evaluate_reading", broken)

    ingest.save_reading({"device_id": "001", "temperature": 20, "humidity": 40})
    assert count(get_db, "sensor_readings") == 1
    assert "Alert evaluation failed" in capsys.readouterr().out


def test_silent_device_goes_offline_and_recovers_on_next_reading(get_db, add_reading):
    add_reading("001", received_at=iso(minutes_ago=10))
    add_reading("002")

    events = alerts.evaluate_offline(offline_seconds=120)
    assert [(e["device_id"], e["kind"]) for e in events] == [("001", "offline")]
    assert alerts.list_alerts()[0]["severity"] == "critical"
    assert alerts.evaluate_offline(offline_seconds=120) == []  # no duplicate

    ingest.save_reading({"device_id": "001", "temperature": 25, "humidity": 50})
    assert alerts.list_alerts() == []


def test_mark_notified_stamps_once(get_db, add_config):
    add_config("001", max_temp=30)
    ingest.save_reading({"device_id": "001", "temperature": 35, "humidity": 50})
    alert_id = alerts.list_alerts()[0]["id"]

    alerts.mark_notified(alert_id)
    first = alerts.list_alerts()[0]["notified_at"]
    alerts.mark_notified(alert_id)
    assert alerts.list_alerts()[0]["notified_at"] == first is not None
