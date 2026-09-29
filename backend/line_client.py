"""
LINE Messaging API delivery.

Note for anyone following an older tutorial: LINE Notify was shut down on
2025-03-31, so its one-token-one-group flow no longer exists. This uses the
Messaging API, where the bot can only push to users who added it as a friend
and whose userId arrived through a verified webhook.

Sending happens on a worker thread. An MQTT reading must never wait on LINE's
API, and a failed push must never drop the reading that triggered it.

Every alert message becomes a row in notification_deliveries before anything is
sent. The worker drains due rows, so a temporary failure is retried with
backoff and a restart picks up whatever was still pending. Each row carries a
LINE retry key, so a retry after a lost response is ignored by LINE instead of
reaching people twice.
"""

import base64
import hashlib
import hmac
import json
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests

PUSH_URL = "https://api.line.me/v2/bot/message/push"
MULTICAST_URL = "https://api.line.me/v2/bot/message/multicast"
PROFILE_URL = "https://api.line.me/v2/bot/profile/{user_id}"
MULTICAST_LIMIT = 500
REQUEST_TIMEOUT = 10
ERROR_TEXT_LIMIT = 200

channel_access_token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
channel_secret = os.getenv("LINE_CHANNEL_SECRET", "").strip()

max_attempts = int(os.getenv("LINE_MAX_ATTEMPTS", "5"))
retry_base_seconds = int(os.getenv("LINE_RETRY_BASE_SECONDS", "30"))
poll_seconds = int(os.getenv("LINE_POLL_SECONDS", "5"))

try:
    display_timezone = ZoneInfo(os.getenv("ALERT_TIMEZONE", "Asia/Bangkok"))
except ZoneInfoNotFoundError:
    print("Unknown ALERT_TIMEZONE, alert times will be shown in UTC")
    display_timezone = timezone.utc

_get_db = None
_on_delivered = None
_wake = threading.Event()
_worker = None
_disabled_logged = False


def configure(get_db, on_delivered=None):
    """`on_delivered(alert_id)` runs once LINE has accepted an alert message."""
    global _get_db, _on_delivered
    _get_db = get_db
    _on_delivered = on_delivered


def init_line_tables(connection):
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS line_recipients (
            line_user_id TEXT PRIMARY KEY,
            display_name TEXT,
            added_at TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    # status: pending (waiting for its next attempt), sent, failed (gave up),
    # skipped (LINE not configured when the alert fired).
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS notification_deliveries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alert_id INTEGER NOT NULL,
            event_state TEXT NOT NULL,
            channel TEXT NOT NULL,
            dedupe_key TEXT NOT NULL UNIQUE,
            retry_key TEXT NOT NULL,
            message TEXT NOT NULL,
            status TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            recipient_count INTEGER,
            last_error TEXT,
            created_at TEXT NOT NULL,
            next_attempt_at TEXT,
            last_attempt_at TEXT,
            delivered_at TEXT
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_deliveries_due "
        "ON notification_deliveries(status, next_attempt_at)"
    )


def enabled():
    return bool(channel_access_token and channel_secret)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _headers():
    return {
        "Authorization": f"Bearer {channel_access_token}",
        "Content-Type": "application/json",
    }


# --- recipients -------------------------------------------------------------

def add_recipient(user_id, display_name=None):
    with _get_db() as connection:
        connection.execute(
            """
            INSERT INTO line_recipients (line_user_id, display_name, added_at, active)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(line_user_id) DO UPDATE SET
                active = 1,
                display_name = COALESCE(excluded.display_name, line_recipients.display_name)
            """,
            (user_id, display_name, _now()),
        )


def deactivate_recipient(user_id):
    """Blocking the bot is not a delete: keep the row so history stays readable."""
    with _get_db() as connection:
        connection.execute(
            "UPDATE line_recipients SET active = 0 WHERE line_user_id = ?", (user_id,)
        )


def active_recipients():
    if _get_db is None:
        return []
    with _get_db() as connection:
        rows = connection.execute(
            "SELECT line_user_id FROM line_recipients WHERE active = 1"
        ).fetchall()
    return [row["line_user_id"] for row in rows]


def list_recipients():
    if _get_db is None:
        return []
    with _get_db() as connection:
        rows = connection.execute(
            "SELECT line_user_id, display_name, added_at, active "
            "FROM line_recipients ORDER BY added_at"
        ).fetchall()
    return [
        {
            # The full userId is a push credential for this bot, so the API only
            # ever reports enough of it to tell two recipients apart.
            "line_user_id": f"{row['line_user_id'][:8]}...",
            "display_name": row["display_name"],
            "added_at": row["added_at"],
            "active": bool(row["active"]),
        }
        for row in rows
    ]


def fetch_display_name(user_id):
    try:
        response = requests.get(
            PROFILE_URL.format(user_id=user_id),
            headers=_headers(),
            timeout=REQUEST_TIMEOUT,
        )
        if response.ok:
            return response.json().get("displayName")
    except requests.RequestException as error:
        # The exception text contains the profile URL, i.e. the full userId.
        print(f"LINE profile lookup failed: {type(error).__name__}")
    return None


# --- webhook ----------------------------------------------------------------

def verify_signature(body, signature):
    """
    Confirm LINE sent this request.

    The endpoint is public, so without this check anyone could post a follow
    event and register themselves as an alert recipient.
    """
    if not channel_secret or not signature:
        return False
    digest = hmac.new(
        channel_secret.encode("utf-8"), body, hashlib.sha256
    ).digest()
    expected = base64.b64encode(digest).decode("utf-8")
    return hmac.compare_digest(expected, signature)


def handle_webhook_events(events):
    """Keep the recipient list in step with who has the bot added."""
    for event in events:
        source = event.get("source", {})
        user_id = source.get("userId")
        if not user_id:
            continue
        event_type = event.get("type")
        if event_type == "follow":
            add_recipient(user_id, fetch_display_name(user_id))
            print(f"LINE recipient added: {user_id[:8]}...")
        elif event_type == "unfollow":
            deactivate_recipient(user_id)
            print(f"LINE recipient removed: {user_id[:8]}...")
        elif event_type == "message":
            # Someone messaging the bot is already a follower; this covers users
            # who added it before the webhook was configured.
            add_recipient(user_id, fetch_display_name(user_id))


# --- sending ----------------------------------------------------------------

def _format_time(value):
    try:
        moment = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return value
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(display_timezone).strftime("%Y-%m-%d %H:%M:%S %Z")


def format_alert(event):
    name = event["name"]
    location = event["location"]
    value = event.get("value")
    threshold = event.get("threshold")
    unit = "%RH" if event["kind"].startswith("humidity") else "°C"
    severity = event.get("severity", "warning").upper()

    if event["state"] == "closed":
        head = f"[RESOLVED] {name}"
        detail = f"{event['label']} cleared"
        if value is not None:
            detail += f" at {value:.1f}{unit}"
    elif event["kind"] == "offline":
        head = f"[{severity}] {name}"
        detail = "No readings received"
        if event.get("last_seen"):
            detail += f" since {_format_time(event['last_seen'])}"
    else:
        head = f"[{severity}] {name}"
        detail = f"{event['label']}: {value:.1f}{unit} (limit {threshold:.1f}{unit})"

    return (
        f"{head}\n{detail}\nLocation: {location}\nDevice: {event['device_id']}"
        f"\nTime: {_format_time(event['at'])}"
    )


def notify(event):
    """
    Record one alert message for delivery. Returns immediately so ingestion is
    never blocked; the worker does the sending.
    """
    global _disabled_logged
    configured = enabled()
    if not configured and not _disabled_logged:
        print("LINE notifications disabled: set LINE_CHANNEL_ACCESS_TOKEN "
              "and LINE_CHANNEL_SECRET to enable them")
        _disabled_logged = True

    now = _now()
    with _get_db() as connection:
        # The dedupe key makes a second notify() for the same transition a no-op.
        connection.execute(
            """
            INSERT OR IGNORE INTO notification_deliveries
                (alert_id, event_state, channel, dedupe_key, retry_key, message,
                 status, last_error, created_at, next_attempt_at)
            VALUES (?, ?, 'line', ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event["alert_id"], event["state"],
                f"line:{event['alert_id']}:{event['state']}",
                str(uuid.uuid4()), format_alert(event),
                "pending" if configured else "skipped",
                None if configured else "LINE credentials are not configured",
                now, now if configured else None,
            ),
        )
    if configured:
        _wake.set()


def _error_text(response):
    """LINE's own error message only; the raw body is not worth logging."""
    try:
        message = response.json().get("message", "")
    except ValueError:
        message = ""
    return f"LINE responded {response.status_code}: {message}"[:ERROR_TEXT_LIMIT]


def _push(text, recipients=None, retry_key=None):
    """
    Deliver one message to every active recipient.

    Returns (sent, error, retryable). With a retry_key, repeating a call that
    already reached LINE is answered 409 and not delivered again, which is what
    makes retrying safe.
    """
    if not enabled():
        return 0, "LINE credentials are not configured", False

    targets = recipients if recipients is not None else active_recipients()
    if not targets:
        return 0, "No LINE recipients have added the bot yet", False

    message = {"type": "text", "text": text[:5000]}
    sent = 0
    for index in range(0, len(targets), MULTICAST_LIMIT):
        batch = targets[index:index + MULTICAST_LIMIT]
        if len(batch) == 1:
            url, payload = PUSH_URL, {"to": batch[0], "messages": [message]}
        else:
            url, payload = MULTICAST_URL, {"to": batch, "messages": [message]}
        headers = _headers()
        if retry_key:
            # One key per batch so each request is deduplicated on its own.
            headers["X-Line-Retry-Key"] = str(
                uuid.uuid5(uuid.UUID(retry_key), str(index))
            )
        try:
            response = requests.post(
                url, headers=headers, data=json.dumps(payload),
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as error:
            return sent, f"LINE request failed: {type(error).__name__}", True
        if response.status_code == 409 and retry_key:
            sent += len(batch)  # accepted by an earlier attempt
            continue
        if not response.ok:
            # 429 is rate limit or the monthly free-tier quota; 5xx is LINE's
            # side. Anything else (bad token, bad request) will not fix itself.
            retryable = response.status_code == 429 or response.status_code >= 500
            return sent, _error_text(response), retryable
        sent += len(batch)
    return sent, None, False


def send_text(text, recipients=None):
    """One-off send, used by the test endpoint. Returns (sent, error)."""
    sent, error, _ = _push(text, recipients)
    return sent, error


def _attempt(delivery_id):
    with _get_db() as connection:
        row = connection.execute(
            "SELECT * FROM notification_deliveries WHERE id = ?", (delivery_id,)
        ).fetchone()
    if row is None or row["status"] != "pending":
        return

    attempts = row["attempts"] + 1
    sent, error, retryable = _push(row["message"], retry_key=row["retry_key"])
    now = datetime.now(timezone.utc)
    next_attempt_at = None
    if error is None:
        status = "sent"
    elif retryable and attempts < max_attempts:
        status = "pending"
        delay = retry_base_seconds * 2 ** (attempts - 1)
        next_attempt_at = (now + timedelta(seconds=delay)).isoformat()
    else:
        status = "failed"

    with _get_db() as connection:
        connection.execute(
            """
            UPDATE notification_deliveries
            SET status = ?, attempts = ?, recipient_count = ?, last_error = ?,
                last_attempt_at = ?, next_attempt_at = ?, delivered_at = ?
            WHERE id = ?
            """,
            (
                status, attempts, sent, error, now.isoformat(), next_attempt_at,
                now.isoformat() if status == "sent" else None, delivery_id,
            ),
        )

    if status == "sent":
        print(f"LINE notification {delivery_id} delivered to {sent} recipient(s)")
        if row["event_state"] == "opened" and _on_delivered is not None:
            _on_delivered(row["alert_id"])
    elif status == "pending":
        print(f"LINE notification {delivery_id} attempt {attempts} failed, "
              f"retrying at {next_attempt_at}: {error}")
    else:
        print(f"LINE notification {delivery_id} not delivered after "
              f"{attempts} attempt(s): {error}")


def _due_deliveries():
    with _get_db() as connection:
        rows = connection.execute(
            """
            SELECT id FROM notification_deliveries
            WHERE status = 'pending' AND next_attempt_at <= ?
            ORDER BY id
            """,
            (_now(),),
        ).fetchall()
    return [row["id"] for row in rows]


def _run_worker():
    # Polling the table rather than holding ids in memory means retries and
    # anything pending across a restart are picked up the same way.
    while True:
        _wake.wait(timeout=poll_seconds)
        _wake.clear()
        try:
            for delivery_id in _due_deliveries():
                _attempt(delivery_id)
        except Exception as error:
            print(f"LINE worker error: {error}")


def start_worker():
    global _worker
    if _worker is not None:
        return
    _worker = threading.Thread(target=_run_worker, daemon=True)
    _worker.start()


def list_deliveries(limit=50):
    if _get_db is None:
        return []
    with _get_db() as connection:
        rows = connection.execute(
            """
            SELECT id, alert_id, event_state, channel, status, attempts,
                   recipient_count, last_error, created_at, last_attempt_at,
                   next_attempt_at, delivered_at
            FROM notification_deliveries
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def delivery_counts():
    if _get_db is None:
        return {}
    with _get_db() as connection:
        rows = connection.execute(
            "SELECT status, COUNT(*) AS total FROM notification_deliveries "
            "GROUP BY status"
        ).fetchall()
    return {row["status"]: row["total"] for row in rows}
