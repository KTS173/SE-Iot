"""
Sign in with Google (OpenID Connect, authorization-code flow).

A Google account with a verified email signs in to the user with that email,
or becomes a new pending member waiting for admin approval like any sign-up.
"""
import base64
import hmac
import json
import re
import secrets
import time
from urllib.parse import urlencode

import requests
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

import auth
import config
from db import get_db
from routers.auth import _is_https, _start_session

router = APIRouter(prefix="/api/auth")

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ISSUERS = {"https://accounts.google.com", "accounts.google.com"}
STATE_COOKIE = "seiot_google"
STATE_PATH = "/api/auth/google"


def enabled():
    return bool(config.google_client_id and config.google_client_secret)


def _redirect_uri(request):
    base = config.public_url or (
        f"{'https' if _is_https(request) else 'http'}://{request.headers.get('host', '')}"
    )
    return f"{base}/api/auth/google/callback"


def _back_to_signin(error):
    """Errors go back to the sign-in page, which explains them."""
    response = RedirectResponse(f"/signin?error={error}", status_code=303)
    response.delete_cookie(STATE_COOKIE, path=STATE_PATH)
    return response


def _decode_payload(id_token):
    try:
        payload = id_token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        return None


def _exchange_code(request, code):
    """Trade the one-time code for the user's verified identity claims."""
    try:
        response = requests.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": config.google_client_id,
                "client_secret": config.google_client_secret,
                "redirect_uri": _redirect_uri(request),
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
    except requests.RequestException:
        return None
    if not response.ok:
        return None
    # The token came straight from Google's token endpoint over TLS, in exchange
    # for our client secret, so its signature need not be checked again
    # (OpenID Connect Core 3.1.3.7). Issuer, audience and expiry still are.
    claims = _decode_payload(response.json().get("id_token", ""))
    if (
        not claims
        or claims.get("iss") not in ISSUERS
        or claims.get("aud") != config.google_client_id
        or claims.get("exp", 0) < time.time()
    ):
        return None
    return claims


def _free_username(connection, email):
    base = re.sub(r"[^A-Za-z0-9_.-]", "", email.split("@")[0])[:28] or "user"
    base = base.ljust(3, "0")
    candidate, number = base, 1
    while connection.execute("SELECT 1 FROM users WHERE username = ?", (candidate,)).fetchone():
        number += 1
        candidate = f"{base}{number}"
    return candidate


def _find_or_create(google_id, email, name):
    with get_db() as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE google_id = ?", (google_id,)
        ).fetchone()
        if row is not None:
            return row
        row = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if row is not None:
            # Google has verified the address, but local sign-up never did: someone
            # else may have registered it first. The Google user takes the account
            # over, so drop its password and sessions; they can set a new password.
            connection.execute(
                "UPDATE users SET google_id = ?, password_hash = ? WHERE id = ?",
                (google_id, auth.NO_PASSWORD, row["id"]),
            )
            connection.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
            return row
        username = _free_username(connection, email)
    user, _ = auth.create_user(
        name=name, username=username, email=email, password=None, google_id=google_id
    )
    return user


@router.get("/providers")
def providers():
    """Which extra sign-in buttons the sign-in page should show."""
    return {"data": {"google": enabled()}}


@router.get("/google/start")
def google_start(request: Request, remember: bool = False):
    if not enabled():
        return _back_to_signin("google_unavailable")
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    query = urlencode({
        "client_id": config.google_client_id,
        "redirect_uri": _redirect_uri(request),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        "prompt": "select_account",
    })
    response = RedirectResponse(f"{AUTH_URL}?{query}", status_code=303)
    # Ties the callback to this browser (CSRF) and to this request (replay).
    response.set_cookie(
        STATE_COOKIE, f"{state}.{nonce}.{int(remember)}", max_age=600, httponly=True,
        samesite="lax", secure=_is_https(request), path=STATE_PATH,
    )
    return response


@router.get("/google/callback")
def google_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    if error:
        return _back_to_signin("google_cancelled")
    saved = request.cookies.get(STATE_COOKIE, "").split(".")
    if len(saved) != 3 or not code or not hmac.compare_digest(saved[0].encode("utf-8"), state.encode("utf-8")):
        return _back_to_signin("google_state")
    _, nonce, remember = saved

    claims = _exchange_code(request, code)
    if claims is None or claims.get("nonce") != nonce:
        return _back_to_signin("google_failed")
    if not claims.get("email_verified") or not claims.get("email"):
        return _back_to_signin("google_email")
    email = claims["email"].lower()
    domain = email.rsplit("@", 1)[-1]
    if config.google_allowed_domains and domain not in config.google_allowed_domains:
        return _back_to_signin("google_domain")

    user = _find_or_create(claims["sub"], email, claims.get("name") or email.split("@")[0])
    if user["status"] == "disabled":
        return _back_to_signin("account_disabled")

    response = RedirectResponse("/", status_code=303)
    response.delete_cookie(STATE_COOKIE, path=STATE_PATH)
    _start_session(request, response, user["id"], remember == "1")
    return response
