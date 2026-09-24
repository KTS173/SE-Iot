"""
LINE Messaging API delivery.

Note for anyone following an older tutorial: LINE Notify was shut down on
2025-03-31, so its one-token-one-group flow no longer exists. This uses the
Messaging API, where the bot can only push to users who added it as a friend
and whose userId arrived through a verified webhook.

Sending happens on a worker thread. An MQTT reading must never wait on LINE's
API, and a failed push must never drop the reading that triggered it.
"""

import base64
import hashlib
import hmac
import json
import os
import queue
import threading
from datetime import datetime, timezone

import requests

PUSH_URL = "https://api.line.me/v2/bot/message/push"
MULTICAST_URL = "https://api.line.me/v2/bot/message/multicast"
PROFILE_URL = "https://api.line.me/v2/bot/profile/{user_id}"
MULTICAST_LIMIT = 500
REQUEST_TIMEOUT = 10

channel_access_token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
channel_secret = os.getenv("LINE_CHANNEL_SECRET", "").strip()

_get_db = None
_send_queue = queue.Queue(maxsize=1000)
_worker = None
_disabled_logged = False


def configure(get_db):
    global _get_db
    _get_db = get_db


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
        print(f"LINE profile lookup failed: {error}")
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

def format_alert(event):
    name = event["name"]
    location = event["location"]
    value = event.get("value")
    threshold = event.get("threshold")
    unit = "%RH" if event["kind"].startswith("humidity") else "°C"

    if event["state"] == "closed":
        head = f"Recovered: {name}"
        detail = f"{event['label']} cleared"
        if value is not None:
            detail += f" at {value:.1f}{unit}"
    elif event["kind"] == "offline":
        head = f"Alert: {name}"
        detail = "No readings received"
        if event.get("last_seen"):
            detail += f" since {event['last_seen']}"
    else:
        head = f"Alert: {name}"
        detail = f"{event['label']}: {value:.1f}{unit} (limit {threshold:.1f}{unit})"

    return f"{head}\n{detail}\nLocation: {location}\nDevice: {event['device_id']}"


def notify(event):
    """Queue one alert. Returns immediately so ingestion is never blocked."""
    global _disabled_logged
    if not enabled():
        if not _disabled_logged:
            print("LINE notifications disabled: set LINE_CHANNEL_ACCESS_TOKEN "
                  "and LINE_CHANNEL_SECRET to enable them")
            _disabled_logged = True
        return
    try:
        _send_queue.put_nowait(format_alert(event))
    except queue.Full:
        print("LINE send queue full, dropping alert notification")


def send_text(text, recipients=None):
    """Deliver one message to every active recipient. Returns (sent, error)."""
    if not enabled():
        return 0, "LINE credentials are not configured"

    targets = recipients if recipients is not None else active_recipients()
    if not targets:
        return 0, "No LINE recipients have added the bot yet"

    message = {"type": "text", "text": text[:5000]}
    sent = 0
    for index in range(0, len(targets), MULTICAST_LIMIT):
        batch = targets[index:index + MULTICAST_LIMIT]
        if len(batch) == 1:
            url, payload = PUSH_URL, {"to": batch[0], "messages": [message]}
        else:
            url, payload = MULTICAST_URL, {"to": batch, "messages": [message]}
        try:
            response = requests.post(
                url, headers=_headers(), data=json.dumps(payload),
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as error:
            return sent, f"LINE request failed: {error}"
        if response.status_code == 403:
            # Usually the monthly free-tier quota, which silently drops pushes.
            return sent, f"LINE rejected the push (quota or permissions): {response.text}"
        if not response.ok:
            return sent, f"LINE responded {response.status_code}: {response.text}"
        sent += len(batch)
    return sent, None


def _run_worker():
    while True:
        text = _send_queue.get()
        try:
            sent, error = send_text(text)
            if error:
                print(f"LINE notification not delivered: {error}")
            else:
                print(f"LINE notification delivered to {sent} recipient(s)")
        except Exception as error:
            print(f"LINE worker error: {error}")
        finally:
            _send_queue.task_done()


def start_worker():
    global _worker
    if _worker is not None:
        return
    _worker = threading.Thread(target=_run_worker, daemon=True)
    _worker.start()
