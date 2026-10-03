"""
Accounts, password hashing, sessions, and the permission checks routes depend on.

Anyone can sign up, but a new account is `pending` and can reach nothing except
its own profile until an admin approves it. Roles are `admin` (manages sensors
and people) and `member` (sees everything else).
"""
import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request

import config
from db import get_db

SESSION_COOKIE = "seiot_session"
ROLES = ("admin", "member")
STATUSES = ("pending", "active", "disabled")
MIN_PASSWORD_LENGTH = 8

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

# Stored for accounts created through Google: matches no password.
NO_PASSWORD = "!"

# scrypt: ~16 MB and a fraction of a second per hash, even on the Pi.
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1


def _now():
    return datetime.now(timezone.utc)


# --- passwords ----------------------------------------------------------------

def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P
    )
    encode = lambda raw: base64.b64encode(raw).decode("ascii")  # noqa: E731
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${encode(salt)}${encode(digest)}"


def verify_password(password, stored):
    try:
        _, n, r, p, salt, expected = stored.split("$")
        digest = hashlib.scrypt(
            password.encode("utf-8"), salt=base64.b64decode(salt),
            n=int(n), r=int(r), p=int(p),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, base64.b64decode(expected))


# Checked against when the username does not exist, so a wrong username takes
# as long as a wrong password and response time does not reveal which it was.
_DUMMY_HASH = hash_password(secrets.token_hex(8))


# --- accounts -----------------------------------------------------------------

def public_user(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "username": row["username"],
        "email": row["email"],
        "role": row["role"],
        "status": row["status"],
        "created_at": row["created_at"],
        "approved_at": row["approved_at"],
        "has_password": row["password_hash"] != NO_PASSWORD,
        "google_linked": row["google_id"] is not None,
    }


def read_profile(payload):
    """Validate name/username/email. Returns (values, error)."""
    values = {
        "name": str(payload.get("name") or "").strip(),
        "username": str(payload.get("username") or "").strip(),
        "email": str(payload.get("email") or "").strip().lower(),
    }
    if not values["name"]:
        return None, "Name is required"
    if not USERNAME_PATTERN.match(values["username"]):
        return None, "Username must be 3-32 letters, numbers, dots, dashes or underscores"
    if not EMAIL_PATTERN.match(values["email"]):
        return None, "Enter a valid email address"
    return values, None


def password_error(password):
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
    return None


def taken_error(connection, username, email, exclude_id=None):
    """Clear duplicate message for signup and profile edits."""
    row = connection.execute(
        "SELECT username, email FROM users "
        "WHERE (username = ? OR email = ?) AND id IS NOT ?",
        (username, email, exclude_id),
    ).fetchone()
    if row is None:
        return None
    if row["username"].lower() == username.lower():
        return "This username is already taken"
    return "This email is already registered"


def create_user(name, username, email, password, role="member", status="pending", google_id=None):
    """Insert a user; password None means Google-only. Returns (user, error)."""
    now = _now().isoformat()
    with get_db() as connection:
        error = taken_error(connection, username, email)
        if error:
            return None, error
        cursor = connection.execute(
            "INSERT INTO users (name, username, email, password_hash, role, status, "
            "created_at, approved_at, google_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (name, username, email, hash_password(password) if password else NO_PASSWORD,
             role, status, now, now if status == "active" else None, google_id),
        )
        row = connection.execute(
            "SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return public_user(row), None


def authenticate(identifier, password):
    """The user row for a correct username/email + password, else None."""
    with get_db() as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE username = ? OR email = ?",
            (identifier, identifier.lower()),
        ).fetchone()
    if row is None:
        verify_password(password, _DUMMY_HASH)
        return None
    return row if verify_password(password, row["password_hash"]) else None


# --- sessions -----------------------------------------------------------------

def _token_hash(token):
    # Only the hash is stored: a copy of the database cannot be used to log in.
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(user_id, remember=False):
    """Returns (token, max_age_seconds or None for a browser-session cookie)."""
    lifetime = (
        timedelta(days=config.remember_days) if remember
        else timedelta(hours=config.session_hours)
    )
    token = secrets.token_urlsafe(32)
    now = _now()
    with get_db() as connection:
        connection.execute("DELETE FROM sessions WHERE expires_at < ?", (now.isoformat(),))
        connection.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) "
            "VALUES (?, ?, ?, ?)",
            (_token_hash(token), user_id, now.isoformat(), (now + lifetime).isoformat()),
        )
    return token, int(lifetime.total_seconds()) if remember else None


def user_for_token(token):
    if not token:
        return None
    with get_db() as connection:
        return connection.execute(
            "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id "
            "WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
            (_token_hash(token), _now().isoformat()),
        ).fetchone()


def revoke_session(token):
    if token:
        with get_db() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


def revoke_user_sessions(user_id, keep_token=None):
    with get_db() as connection:
        connection.execute(
            "DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?",
            (user_id, _token_hash(keep_token) if keep_token else None),
        )


# --- sign-in throttling ---------------------------------------------------------

MAX_FAILED_LOGINS = 5
LOCKOUT_SECONDS = 15 * 60
_failed_logins = {}
_failed_lock = threading.Lock()


def login_locked_for(key):
    """Seconds until this username+address may try again; 0 when allowed."""
    with _failed_lock:
        recent = [t for t in _failed_logins.get(key, []) if time.monotonic() - t < LOCKOUT_SECONDS]
        _failed_logins[key] = recent
        if len(recent) < MAX_FAILED_LOGINS:
            return 0
        return int(LOCKOUT_SECONDS - (time.monotonic() - recent[0])) + 1


def record_failed_login(key):
    with _failed_lock:
        _failed_logins.setdefault(key, []).append(time.monotonic())


def clear_failed_logins(key):
    with _failed_lock:
        _failed_logins.pop(key, None)


# --- route dependencies ---------------------------------------------------------

def current_user(request: Request):
    """Any signed-in account, including one still waiting for approval."""
    row = user_for_token(request.cookies.get(SESSION_COOKIE))
    if row is None or row["status"] == "disabled":
        raise HTTPException(status_code=401, detail="Please sign in")
    return row


def approved_user(user=Depends(current_user)):
    if user["status"] != "active":
        raise HTTPException(status_code=403, detail="Your account is waiting for admin approval")
    return user


def admin_user(user=Depends(approved_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can do this")
    return user
