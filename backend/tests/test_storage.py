import config
import storage
from conftest import count, iso


def test_retention_deletes_only_expired_readings(get_db, add_reading, monkeypatch):
    monkeypatch.setattr(config, "sensor_retention_days", 7)
    add_reading(received_at=iso(minutes_ago=8 * 24 * 60))
    add_reading(received_at=iso(minutes_ago=6 * 24 * 60))
    add_reading()

    assert storage.cleanup_expired_readings(force=True) == 1
    assert count(get_db, "sensor_readings") == 2


def test_retention_runs_at_most_hourly(get_db, add_reading, monkeypatch):
    monkeypatch.setattr(config, "sensor_retention_days", 7)
    storage.cleanup_expired_readings(force=True)
    add_reading(received_at=iso(minutes_ago=8 * 24 * 60))

    assert storage.cleanup_expired_readings() == 0
    assert count(get_db, "sensor_readings") == 1


def test_disk_cleanup_does_nothing_below_warning(get_db, add_reading, disk):
    add_reading()
    disk.used_percent = 50
    assert storage.cleanup_storage_if_needed() == 0
    assert count(get_db, "sensor_readings") == 1


def _disk_tracks_row_count(get_db, disk, monkeypatch):
    """Make 'disk usage %' equal the number of stored readings."""
    def status():
        disk.used_percent = count(get_db, "sensor_readings")
        return disk.status()
    monkeypatch.setattr(storage, "get_storage_status", status)


def test_disk_cleanup_removes_oldest_until_target(get_db, add_reading, disk, monkeypatch):
    monkeypatch.setattr(config, "storage_cleanup_batch_size", 3)
    monkeypatch.setattr(config, "storage_min_readings", 5)
    ids = [add_reading() for _ in range(90)]
    _disk_tracks_row_count(get_db, disk, monkeypatch)

    # 90 -> 87 -> 84 -> 81 -> 78: stops once at or under the 80% target.
    assert storage.cleanup_storage_if_needed() == 12
    with get_db() as connection:
        remaining = [row[0] for row in connection.execute("SELECT id FROM sensor_readings ORDER BY id")]
    assert remaining == ids[12:]


def test_disk_cleanup_protects_newest_readings(get_db, add_reading, disk, monkeypatch, capsys):
    monkeypatch.setattr(config, "storage_min_readings", 95)
    for _ in range(90):
        add_reading()
    _disk_tracks_row_count(get_db, disk, monkeypatch)

    assert storage.cleanup_storage_if_needed() == 0
    assert count(get_db, "sensor_readings") == 90
    assert "protected" in capsys.readouterr().out


def test_almost_full_warning_is_logged_once(get_db, disk, capsys):
    disk.used_percent = 90
    storage.warn_if_almost_full()
    storage.warn_if_almost_full()
    assert capsys.readouterr().out.count("almost full") == 1

    disk.used_percent = 10
    storage.warn_if_almost_full()
    disk.used_percent = 90
    storage.warn_if_almost_full()
    assert capsys.readouterr().out.count("almost full") == 1


def test_real_storage_status_reports_disk(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "database_path", str(tmp_path / "x.db"))
    result = storage.get_storage_status()  # no `disk` fixture: the real check
    assert result["total_bytes"] > 0
    assert 0 <= result["used_percent"] <= 100
