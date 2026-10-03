import base64
import hashlib
import hmac
import json

import pytest

import alerts
import ingest
import line_client


def sign(body):
    digest = hmac.new(b"test-secret", body, hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


def test_signature_accepts_only_matching_body():
    body = b'{"events": []}'
    assert line_client.verify_signature(body, sign(body)) is True
    assert line_client.verify_signature(b"tampered", sign(body)) is False
    assert line_client.verify_signature(body, "") is False


@pytest.fixture
def no_profile_lookup(monkeypatch):
    monkeypatch.setattr(line_client, "fetch_display_name", lambda user_id: "Tester")


def test_follow_and_unfollow_update_recipients(get_db, no_profile_lookup):
    line_client.handle_webhook_events([{"type": "follow", "source": {"userId": "U1234567890"}}])
    assert line_client.active_recipients() == ["U1234567890"]

    line_client.handle_webhook_events([{"type": "unfollow", "source": {"userId": "U1234567890"}}])
    assert line_client.active_recipients() == []
    # Kept for history, but the full user id is never exposed.
    assert line_client.list_recipients() == [
        {"line_user_id": "U1234567...", "display_name": "Tester",
         "added_at": line_client.list_recipients()[0]["added_at"], "active": False}
    ]


def test_message_from_unknown_user_registers_them(get_db, no_profile_lookup):
    line_client.handle_webhook_events([
        {"type": "message", "source": {"userId": "U9"}},
        {"type": "follow", "source": {}},  # no userId: ignored
    ])
    assert line_client.active_recipients() == ["U9"]


def test_send_text_without_credentials_reports_error(get_db):
    sent, error = line_client.send_text("hello")
    assert sent == 0
    assert error == "LINE credentials are not configured"


# --- delivery with a fake LINE API -------------------------------------------

class FakeLine:
    """Replaces requests.post; answers with the queued status codes in order."""

    def __init__(self, *statuses):
        self.statuses = list(statuses)
        self.calls = []

    def post(self, url, headers, data, timeout):
        self.calls.append({"url": url, "headers": headers, "body": json.loads(data)})
        status = self.statuses.pop(0) if self.statuses else 200
        if isinstance(status, Exception):
            raise status
        return FakeResponse(status)


class FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code
        self.ok = 200 <= status_code < 300

    def json(self):
        return {"message": "fake error"}


@pytest.fixture
def line_api(monkeypatch, get_db):
    monkeypatch.setattr(line_client, "channel_access_token", "token")
    monkeypatch.setattr(line_client, "max_attempts", 3)

    def install(*statuses):
        fake = FakeLine(*statuses)
        monkeypatch.setattr(line_client.requests, "post", fake.post)
        return fake

    return install


def queue_alert(get_db, users=("U1",)):
    for user in users:
        line_client.add_recipient(user)
    ingest.save_reading({"device_id": "001", "temperature": 99, "humidity": 50})
    return line_client.list_deliveries()[0]


def delivery(delivery_id):
    return next(d for d in line_client.list_deliveries() if d["id"] == delivery_id)


def test_alert_is_delivered_and_marks_alert_notified(line_api, get_db):
    fake = line_api(200)
    queued = queue_alert(get_db)
    assert queued["status"] == "pending"

    line_client._attempt(queued["id"])

    assert delivery(queued["id"])["status"] == "sent"
    assert fake.calls[0]["url"] == line_client.PUSH_URL
    assert "X-Line-Retry-Key" in fake.calls[0]["headers"]
    assert alerts.list_alerts()[0]["notified_at"] is not None


def test_many_recipients_use_multicast(line_api, get_db):
    fake = line_api(200)
    queued = queue_alert(get_db, users=("U1", "U2"))
    line_client._attempt(queued["id"])
    assert fake.calls[0]["url"] == line_client.MULTICAST_URL
    assert sorted(fake.calls[0]["body"]["to"]) == ["U1", "U2"]


@pytest.mark.parametrize("failure", [500, 429, line_client.requests.ConnectionError()])
def test_temporary_failure_is_retried_with_backoff(line_api, get_db, failure):
    line_api(failure)
    queued = queue_alert(get_db)

    line_client._attempt(queued["id"])
    after = delivery(queued["id"])
    assert after["status"] == "pending"
    assert after["attempts"] == 1
    assert after["next_attempt_at"] > after["last_attempt_at"]
    assert alerts.list_alerts()[0]["notified_at"] is None


def test_gives_up_after_max_attempts(line_api, get_db):
    line_api(500, 500, 500)
    queued = queue_alert(get_db)
    for _ in range(3):
        line_client._attempt(queued["id"])
    assert delivery(queued["id"])["status"] == "failed"
    assert delivery(queued["id"])["attempts"] == 3


def test_permanent_error_fails_immediately(line_api, get_db):
    line_api(400)
    queued = queue_alert(get_db)
    line_client._attempt(queued["id"])
    after = delivery(queued["id"])
    assert after["status"] == "failed"
    assert after["last_error"] == "LINE responded 400: fake error"


def test_409_means_an_earlier_attempt_already_delivered(line_api, get_db):
    line_api(409)
    queued = queue_alert(get_db)
    line_client._attempt(queued["id"])
    assert delivery(queued["id"])["status"] == "sent"


def test_only_due_pending_deliveries_are_picked_up(line_api, get_db):
    line_api(500)
    queued = queue_alert(get_db)
    assert line_client._due_deliveries() == [queued["id"]]

    line_client._attempt(queued["id"])  # now scheduled for later
    assert line_client._due_deliveries() == []
    assert line_client.delivery_counts() == {"pending": 1}
